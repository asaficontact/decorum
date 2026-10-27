#!/usr/bin/env python3
"""One line per trial of a Pier job run with decorum_pier, beside the leaderboard reference for its task.

    python3 base_forum/scripts/summarize.py base_forum/jobs/<job> [--reference base_forum/tasks/baseline-10.tsv] [--csv out.csv]

Reads <job>/<trial>/result.json (Pier) and <job>/<trial>/agent/decorum/summary.json (the runtime). Standard
library only, so it runs with any python3.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path


def _seconds(timing: dict | None) -> float | None:
    if not timing or not timing.get("started_at") or not timing.get("finished_at"):
        return None
    a = datetime.fromisoformat(timing["started_at"].replace("Z", "+00:00"))
    b = datetime.fromisoformat(timing["finished_at"].replace("Z", "+00:00"))
    return (b - a).total_seconds()


def _reward(result: dict, trial: Path) -> tuple[float | None, str | None]:
    """Pier's verifier reward, or the one regrade.sh wrote when Pier's verifier step failed."""
    rewards = (result.get("verifier_result") or {}).get("rewards") or {}
    if "reward" in rewards:
        return float(rewards["reward"]), "pier"
    if rewards:
        return float(next(iter(rewards.values()))), "pier"
    regraded = trial / "regrade" / "reward.json"
    if regraded.exists():
        return float(json.loads(regraded.read_text())["reward"]), "regrade"
    return None, None


def load(job: Path) -> list[dict]:
    rows = []
    for rfile in sorted(job.glob("*/result.json")):
        trial = rfile.parent
        result = json.loads(rfile.read_text())
        s_path = trial / "agent" / "decorum" / "summary.json"
        s = json.loads(s_path.read_text()) if s_path.exists() else {}
        workers = [a for a in s.get("agents", []) if a.get("role") == "worker"]
        exc = result.get("exception_info") or {}
        reward, graded_by = _reward(result, trial)
        rows.append(
            {
                "task": result.get("task_name", trial.name).split("/")[-1],
                "trial": trial.name,
                "reward": reward,
                "graded_by": graded_by,
                "cost_usd": s.get(
                    "cost_usd", (result.get("agent_result") or {}).get("cost_usd")
                ),
                "agent_minutes": round(
                    (_seconds(result.get("agent_execution")) or 0) / 60, 1
                ),
                "mode": s.get("mode"),
                "rulebook": (s.get("rulebook") or {}).get("name"),
                "end_reason": s.get("end_reason") or ("no summary" if not s else None),
                "workers": len(workers),
                "threads": (s.get("forum") or {}).get("threads"),
                "posts": (s.get("forum") or {}).get("posts"),
                "refusals": (s.get("forum") or {}).get("refusals"),
                "auto_committed": s.get("auto_committed"),
                "exception": None
                if graded_by == "regrade"
                else exc.get("exception_type"),
            }
        )
    return rows


def reference(path: Path | None) -> dict[str, dict]:
    if not path or not path.exists():
        return {}
    lines = path.read_text().splitlines()
    head = lines[0].split("\t")
    return {
        r[0]: dict(zip(head, r))
        for r in (line.split("\t") for line in lines[1:] if line.strip())
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("job", type=Path)
    ap.add_argument("--reference", type=Path)
    ap.add_argument("--csv", type=Path)
    a = ap.parse_args()
    rows = load(a.job)
    if not rows:
        print(f"no trials with result.json under {a.job}", file=sys.stderr)
        return 1
    ref = reference(a.reference)
    for r in rows:
        r["k3_reference"] = ref.get(r["task"], {}).get("k3_max_pass_rate")
    cols = [
        "task",
        "reward",
        "graded_by",
        "k3_reference",
        "cost_usd",
        "agent_minutes",
        "workers",
        "threads",
        "posts",
        "refusals",
        "end_reason",
        "exception",
    ]
    fmt = lambda v: (
        "-" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))
    )
    widths = [max(len(c), *(len(fmt(r[c])) for r in rows)) for c in cols]
    print("  ".join(c.ljust(w) for c, w in zip(cols, widths)))
    for r in rows:
        print("  ".join(fmt(r[c]).ljust(w) for c, w in zip(cols, widths)))
    graded = [r for r in rows if r["reward"] is not None]
    passed = sum(1 for r in graded if r["reward"] >= 1)
    cost = sum(r["cost_usd"] or 0 for r in rows)
    refs = [float(r["k3_reference"]) for r in rows if r["k3_reference"]]
    print()
    print(
        f"{len(rows)} trials, {len(graded)} graded, {passed} passed ({passed / len(graded):.0%})"
        if graded
        else f"{len(rows)} trials, none graded"
    )
    if refs:
        print(
            f"leaderboard Kimi K3 (max, mini-swe-agent, 4 runs) on the same tasks: mean pass rate {sum(refs) / len(refs):.2f}"
        )
    print(
        f"cost ${cost:.2f} total, ${cost / len(rows):.2f} per trial; workers used in {sum(1 for r in rows if r['workers'])} of {len(rows)} trials"
    )
    if a.csv:
        with a.csv.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {a.csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
