#!/usr/bin/env python3
"""Follow a running decorum job live: the forum, each agent's tool calls, and the cost, as they happen.

    python3 base_forum/scripts/watch.py base_forum/jobs/<job>          # follow every trial in the job
    python3 base_forum/scripts/watch.py base_forum/jobs/<job> --quiet  # forum only, no tool calls
    python3 base_forum/scripts/watch.py base_forum/jobs/<job> --once   # print what is there and exit

Reads the files the runtime writes while it works (<trial>/agent/decorum/forum.jsonl and sessions/*/*.jsonl);
Docker bind-mounts them to the host, so this needs nothing but python3. Ctrl-C to stop.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
PALETTE = ["36", "33", "35", "32", "34", "31", "96", "93"]


def paint(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOR else text


def short(text: str, n: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


class Tail:
    """New complete lines of a growing file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.pos = 0
        self.buf = ""

    def lines(self) -> list[str]:
        try:
            with self.path.open("r", encoding="utf-8", errors="replace") as f:
                f.seek(self.pos)
                chunk = f.read()
                self.pos = f.tell()
        except FileNotFoundError:
            return []
        self.buf += chunk
        *done, self.buf = self.buf.split("\n")
        return [line for line in done if line.strip()]


class Trial:
    def __init__(self, path: Path, label: str) -> None:
        self.path = path
        self.label = label
        self.forum = Tail(path / "agent" / "decorum" / "forum.jsonl")
        self.sessions: dict[Path, Tail] = {}
        self.cost: dict[str, float] = {}
        self.colors: dict[str, str] = {}
        self.done = False

    def who(self, agent: str) -> str:
        if agent not in self.colors:
            self.colors[agent] = PALETTE[len(self.colors) % len(PALETTE)]
        return paint(agent, self.colors[agent])

    def poll(self, quiet: bool) -> list[str]:
        out: list[str] = []
        for line in self.forum.lines():
            out.append(self.forum_line(json.loads(line)))
        sess_dir = self.path / "agent" / "decorum" / "sessions"
        if not quiet and sess_dir.exists():
            for f in sorted(sess_dir.glob("*/*.jsonl")):
                self.sessions.setdefault(f, Tail(f))
        for f, tail in self.sessions.items():
            agent = f.parent.name
            for line in tail.lines():
                out.extend(self.session_lines(agent, json.loads(line)))
        summary = self.path / "agent" / "decorum" / "summary.json"
        if not self.done and summary.exists():
            try:
                s = json.loads(summary.read_text())
            except json.JSONDecodeError:
                return out
            self.done = True
            out.append(paint(f"■ trial ended: {s.get('end_reason')}, ${s.get('cost_usd', 0):.2f}, {s.get('duration_sec', 0) / 60:.1f} min, "
                             f"{(s.get('forum') or {}).get('posts', 0)} posts, auto-commit {s.get('auto_committed')}", "1"))  # fmt: skip
        return out

    def forum_line(self, e: dict) -> str:
        k = e.get("kind")
        if k == "thread_opened":
            t = e["thread"]
            return (
                paint(f"▶ {t['id']} opened by {t['owner']}: {t['title']}", "1")
                + f" — {short(t.get('goal', ''), 120)}"
            )
        if k == "assigned":
            a = e["assignment"]
            return f"  + {self.who(a['worker'])} joins {a['thread']} as {short(a['persona'], 70)}\n      instructions: {short(a['instructions'], 160)}"
        if k == "post":
            p = e["post"]
            return f"  {p['thread']} {self.who(p['author'])}: {short(p['text'], 300)}"
        if k == "finished":
            a = e["assignment"]
            mark = "✓" if a["status"] == "finished" else "✗"
            return f"  {mark} {self.who(a['worker'])} {a['status']}: {short(a.get('summary', ''), 200)}"
        if k == "thread_closed":
            t = e["thread"]
            return paint(
                f"■ {t['id']} closed: {short(t.get('closingSummary', ''), 160)}", "1"
            )
        if k == "refusal":
            return paint(
                f"  ! refused {e['agent']} {e['tool']} ({e['rule']}): {short(e['reason'], 160)}",
                "31",
            )
        return f"  · {e.get('agent', '')}: {short(e.get('text', ''), 160)}"

    def session_lines(self, agent: str, entry: dict) -> list[str]:
        msg = entry.get("message") or {}
        if entry.get("type") != "message" or msg.get("role") != "assistant":
            return []
        cost = ((msg.get("usage") or {}).get("cost") or {}).get("total") or 0.0
        self.cost[agent] = self.cost.get(agent, 0.0) + cost
        lines = []
        for c in msg.get("content") or []:
            if c.get("type") != "toolCall" or c.get("name") in {
                "post",
                "open_thread",
                "assign_workers",
                "finish",
                "close_thread",
            }:
                continue
            args = c.get("arguments") or {}
            detail = (
                args.get("command")
                or args.get("path")
                or args.get("thread")
                or json.dumps(args)[:120]
            )
            lines.append(paint(f"    {agent} › {c['name']} {short(detail, 140)}", "2"))
        if msg.get("stopReason") == "error":
            lines.append(
                paint(
                    f"    {agent} › model error: {short(msg.get('errorMessage', ''), 160)}",
                    "31",
                )
            )
        return lines

    def total(self) -> float:
        return sum(self.cost.values())


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "job",
        type=Path,
        help="a job directory (base_forum/jobs/<job>) or one trial inside it",
    )
    ap.add_argument(
        "--quiet", action="store_true", help="forum events only, no tool calls"
    )
    ap.add_argument(
        "--once", action="store_true", help="print what is there now and exit"
    )
    ap.add_argument("--interval", type=float, default=1.0)
    a = ap.parse_args()
    trials: dict[Path, Trial] = {}
    last_cost = -1.0
    try:
        while True:
            dirs = (
                [a.job]
                if (a.job / "agent").exists()
                else sorted(p for p in a.job.iterdir() if (p / "agent").is_dir())
                if a.job.exists()
                else []
            )
            for d in dirs:
                if d not in trials:
                    trials[d] = Trial(d, d.name.split("__")[0])
                    print(paint(f"══ {trials[d].label} ({d.name})", "1;4"))
            for t in trials.values():
                lines = t.poll(a.quiet)
                if lines and len(trials) > 1:
                    print(paint(f"── {t.label}", "1"))
                for line in lines:
                    print(line)
            total = sum(t.total() for t in trials.values())
            if not a.quiet and total - last_cost >= 0.25:
                print(
                    paint(
                        f"    $ {total:.2f} spent so far across {len(trials)} trial(s)",
                        "2",
                    )
                )
                last_cost = total
            sys.stdout.flush()
            if a.once or (
                trials
                and all(t.done for t in trials.values())
                and (a.job / "result.json").exists()
            ):
                return 0
            time.sleep(a.interval)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
