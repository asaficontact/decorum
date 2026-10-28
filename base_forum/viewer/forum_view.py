#!/usr/bin/env python3
"""Decorum forum viewer: a live page over Pier job folders, for every running and finished decorum trial.

    python3 base_forum/viewer/forum_view.py                      # base_forum/jobs, http://127.0.0.1:8479/
    python3 base_forum/viewer/forum_view.py --open               # and open it in the browser
    python3 base_forum/viewer/forum_view.py --jobs path/to/jobs --jobs other/jobs --port 8480

Reads what the decorum runtime writes while a trial runs (agent/decorum/forum.jsonl, sessions/*/*.jsonl,
summary.json) and what Pier writes after it (result.json, verifier/reward.json, or regrade/reward.json).
Standard library only. Files are read incrementally (byte offsets), and a file that is rewritten or replaced is
read again from the start, so a long trial stays cheap to poll. Binds to 127.0.0.1 only.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import time
import webbrowser
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
DEFAULT_JOBS = HERE.parent / "jobs"
FORUM_TOOLS = {
    "open_thread",
    "assign_workers",
    "post",
    "finish",
    "close_thread",
    "read_thread",
    "list_threads",
    "wait",
    "merge_worker",
}
STALE_SEC = (
    600  # a trial with no new bytes for this long and no summary is shown as "stalled"
)


def _read_json(p: Path) -> dict | None:
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _short(v: object, n: int) -> str:
    s = " ".join(str(v).split())
    return s if len(s) <= n else s[: n - 1] + "…"


class SessionState:
    """One agent's pi session file, folded incrementally into what the page shows."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.offset = 0
        self.buf = ""
        self.cost = 0.0
        self.calls = 0
        self.actions: list[dict] = []  # recent tool calls, newest last
        self.pending: dict[str, dict] = {}
        self.waiting = False
        self.last_at: str | None = None
        self.model: str | None = None
        self.last_text = ""
        self.first_at: str | None = None
        self.ino: int | None = None

    def update(self) -> None:
        try:
            st = self.path.stat()
            size = st.st_size
            if size < self.offset or (
                self.ino is not None and st.st_ino != self.ino
            ):  # rewritten or replaced
                self.__init__(self.path)
            self.ino = st.st_ino
            if size == self.offset:
                return
            with self.path.open("r", encoding="utf-8", errors="replace") as f:
                f.seek(self.offset)
                chunk = f.read()
                self.offset = f.tell()
        except OSError:
            return
        self.buf += chunk
        *lines, self.buf = self.buf.split("\n")
        for line in lines:
            if line.strip():
                try:
                    self._fold(json.loads(line))
                except json.JSONDecodeError:
                    pass

    def _fold(self, e: dict) -> None:
        if e.get("type") == "model_change":
            self.model = f"{e.get('provider')}/{e.get('modelId')}"
        if e.get("type") != "message":
            return
        m = e.get("message") or {}
        self.last_at = e.get("timestamp") or self.last_at
        self.first_at = self.first_at or self.last_at
        if m.get("role") == "assistant":
            self.calls += 1
            self.cost += ((m.get("usage") or {}).get("cost") or {}).get("total") or 0.0
            text = " ".join(
                c.get("text", "")
                for c in m.get("content") or []
                if c.get("type") == "text"
            ).strip()
            if text:
                self.last_text = _short(text, 300)
            tools = [c for c in m.get("content") or [] if c.get("type") == "toolCall"]
            self.waiting = any(c.get("name") == "wait" for c in tools)
            for c in tools:
                args = c.get("arguments") or {}
                detail = (
                    args.get("command")
                    or args.get("path")
                    or args.get("pattern")
                    or args.get("thread")
                    or ""
                )
                act = {
                    "tool": c.get("name"),
                    "detail": _short(detail, 160),
                    "at": e.get("timestamp"),
                    "forum": c.get("name") in FORUM_TOOLS,
                    "result": None,
                    "error": False,
                }
                self.actions.append(act)
                self.pending[str(c.get("id"))] = act
            del self.actions[:-400]
        elif m.get("role") == "toolResult":
            act = self.pending.pop(str(m.get("toolCallId")), None)
            if act is not None:
                text = " ".join(
                    c.get("text", "")
                    for c in m.get("content") or []
                    if isinstance(c, dict) and c.get("type") == "text"
                )
                act["result"] = _short(text, 220)
                act["error"] = bool(m.get("isError"))
            if m.get("toolName") == "wait":
                self.waiting = False


class TrialState:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.forum_offset = 0
        self.forum_buf = ""
        self.events: list[dict] = []
        self.epoch = 0
        self.sessions: dict[str, SessionState] = {}
        self.ino: int | None = None

    @property
    def dec(self) -> Path:
        return self.path / "agent" / "decorum"

    def update(self) -> None:
        fp = self.dec / "forum.jsonl"
        try:
            st = fp.stat()
            size, ino = st.st_size, st.st_ino
        except OSError:
            size, ino = 0, None
        if size < self.forum_offset or (
            ino is not None and self.ino is not None and ino != self.ino
        ):  # rewritten or replaced
            self.ino = ino
            self.forum_offset, self.forum_buf, self.events = 0, "", []
            self.epoch += 1
            self.sessions = {}
        self.ino = ino if ino is not None else self.ino
        if size > self.forum_offset:
            with fp.open("r", encoding="utf-8", errors="replace") as f:
                f.seek(self.forum_offset)
                chunk = f.read()
                self.forum_offset = f.tell()
            self.forum_buf += chunk
            *lines, self.forum_buf = self.forum_buf.split("\n")
            for line in lines:
                if line.strip():
                    try:
                        self.events.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        sess = self.dec / "sessions"
        for name in [n for n, st in self.sessions.items() if not st.path.exists()]:
            del self.sessions[name]
        if sess.is_dir():
            for d in sess.iterdir():
                files = sorted(d.glob("*.jsonl"))
                if files:
                    st = self.sessions.get(d.name)
                    if st is None or st.path != files[-1]:
                        st = self.sessions[d.name] = SessionState(files[-1])
                    st.update()

    def last_activity(self) -> float:
        times = []
        for p in [self.dec / "forum.jsonl", *[s.path for s in self.sessions.values()]]:
            try:
                times.append(p.stat().st_mtime)
            except OSError:
                pass
        return max(times, default=0.0)

    def reward(self) -> tuple[float | None, str | None, dict]:
        """The reward, who graded it, and the test counts behind it when the grader wrote them."""
        for p in (
            self.path / "verifier" / "reward.json",
            self.path / "regrade" / "reward.json",
        ):
            j = _read_json(p)
            if j and "reward" in j:
                tests = {
                    k: j.get(k)
                    for k in ("f2p_passed", "f2p_total", "p2p_passed", "p2p_total")
                }
                return (
                    float(j["reward"]),
                    "regrade" if "regrade" in str(p) else "pier",
                    tests,
                )
        r = _read_json(self.path / "result.json") or {}
        rewards = (r.get("verifier_result") or {}).get("rewards") or {}
        if "reward" in rewards:
            return float(rewards["reward"]), "pier", {}
        return None, None, {}

    def overview(self, job: str) -> dict:
        self.update()
        summary = _read_json(self.dec / "summary.json")
        result = _read_json(self.path / "result.json")
        reward, graded_by, tests = self.reward()
        firsts = [
            x
            for x in [
                self.events[0]["at"] if self.events else None,
                *[s.first_at for s in self.sessions.values()],
            ]
            if x
        ]
        started = min(firsts, key=lambda x: _ts(x) or 0) if firsts else None
        info = task_info(self.path)
        if summary:
            status = "finished"
        elif not self.dec.exists():
            status = "failed" if result else "starting"
        elif time.time() - self.last_activity() > STALE_SEC:
            status = "stalled"
        else:
            status = "running"
        workers = [e["assignment"] for e in self.events if e.get("kind") == "assigned"]
        cost = (
            summary.get("cost_usd")
            if summary
            else sum(s.cost for s in self.sessions.values())
        )
        task = (
            (result or {})
            .get("task_name", self.path.name.split("__")[0])
            .split("/")[-1]
        )
        ended = summary.get("ended_at") if summary else None
        problem = None
        exc = (result or {}).get("exception_info") or {}
        if exc:
            first = " ".join(str(exc.get("exception_message") or "").split())[:280]
            where = (
                "Grading failed"
                if summary
                else "The trial failed before the agents finished"
            )
            problem = f"{where}: {exc.get('exception_type', 'error')}: {first}"
        elif summary and summary.get("errors"):
            problem = (
                "The runtime reported: "
                + "; ".join(str(x) for x in summary["errors"])[:280]
            )
        return {
            "job": job,
            "trial": self.path.name,
            "task": task,
            "title": info.get("display_title"),
            "description": info.get("display_description"),
            "language": info.get("language"),
            "repository": info.get("repository_url", "").removeprefix(
                "https://github.com/"
            ),
            "status": status,
            "started_at": started or (summary or {}).get("started_at"),
            "ended_at": ended,
            "duration_sec": (summary or {}).get("duration_sec"),
            "cost_usd": round(cost or 0.0, 4),
            "reward": reward,
            "graded_by": graded_by,
            "tests": tests,
            "replay": job.startswith("replay-of-"),
            "end_reason": (summary or {}).get("end_reason"),
            "mode": (summary or {}).get("mode"),
            "rulebook": ((summary or {}).get("rulebook") or {}).get("name"),
            "models": (summary or {}).get("models"),
            "threads": sum(1 for e in self.events if e.get("kind") == "thread_opened"),
            "posts": sum(1 for e in self.events if e.get("kind") == "post"),
            "workers": len(workers),
            "epoch": self.epoch,
            "problem": problem,
        }

    def detail(self, job: str, since: int) -> dict:
        ov = self.overview(job)
        finished = {}
        assigned = {}
        for e in self.events:
            if e.get("kind") == "assigned":
                assigned[e["assignment"]["worker"]] = e["assignment"]
            if e.get("kind") == "finished":
                finished[e["assignment"]["worker"]] = e["assignment"]
        agents = []
        names = [
            "authority",
            *[n for n in assigned if n != "authority"],
            *[n for n in self.sessions if n not in assigned and n != "authority"],
        ]
        for name in names:
            s = self.sessions.get(name)
            a = assigned.get(name)
            f = finished.get(name)
            if ov["status"] != "running":
                state = (
                    "finished"
                    if (f is None or f.get("status") == "finished")
                    else "stopped"
                )
                if name == "authority":
                    state = "finished"
            elif (
                f is not None
                and f.get("status") in ("finished", "stopped")
                and (not s or not s.last_at or s.last_at <= f.get("finishedAt", ""))
            ):
                state = f["status"]
            elif s and s.waiting:
                state = "waiting"
            else:
                state = "working"
            agents.append(
                {
                    "name": name,
                    "role": "authority" if name == "authority" else "worker",
                    "model": s.model if s else None,
                    "thread": a["thread"] if a else None,
                    "persona": a["persona"] if a else None,
                    "state": state,
                    "cost_usd": round(s.cost, 4) if s else 0.0,
                    "calls": s.calls if s else 0,
                    "actions": s.actions if s else [],
                    "last_text": s.last_text if s else "",
                }
            )
        return {
            "trial": ov,
            "instruction": task_info(self.path).get("instruction"),
            "events": self.events[since:],
            "next": len(self.events),
            "epoch": self.epoch,
            "agents": agents,
        }


_TASK_INFO: dict[Path, dict] = {}
TASK_DIRS: list[Path] = []


def task_info(trial: Path) -> dict:
    """display_title etc. from the task's task.toml, found through the trial's config.json; {} if not found."""
    if trial in _TASK_INFO:
        return _TASK_INFO[trial]
    cfg = _read_json(trial / "config.json") or {}
    rel = Path(str((cfg.get("task") or {}).get("path") or ""))
    cands = (
        [rel]
        if rel.is_absolute()
        else [
            p / rel
            for p in (trial.parent.parent.parent, trial.parent.parent, Path.cwd())
        ]
    )
    cands += [d / rel.name for d in TASK_DIRS]
    info: dict = {}
    for c in cands:
        toml = c / "task.toml"
        if toml.is_file():
            for line in toml.read_text().splitlines():
                k, sep, v = line.partition("=")
                k = k.strip()
                if sep and k in (
                    "display_title",
                    "display_description",
                    "language",
                    "repository_url",
                ):
                    info[k] = v.strip().strip('"')
            if (c / "instruction.md").is_file():
                info["instruction"] = (c / "instruction.md").read_text()
            break
    # SWE-bench Pro tasks carry no display title: take the PR description's "## Title ..." line, and the
    # repository from the id (instance_<org>__<repo>-<sha>-v...).
    if "display_title" not in info and info.get("instruction"):
        m = re.search(
            r"^#+\s*Title:?\s*(.+)$", info["instruction"], re.MULTILINE
        ) or re.search(r"<pr_description>\s*#*\s*(.+)", info["instruction"])
        if m:
            info["display_title"] = m.group(1).strip()[:160]
    if "repository_url" not in info:
        m = re.match(r"instance_([^_]+)__([^-]+)-", rel.name)
        if m:
            info["repository_url"] = f"https://github.com/{m.group(1)}/{m.group(2)}"
    _TASK_INFO[trial] = info
    return info


NAMES_FILE = ".decorum-viewer.json"
NAME_MAX = 80


def benchmark_of(dataset_path: str) -> str:
    p = dataset_path.lower()
    if "swebench-pro" in p or "swe-bench_pro" in p or "swebenchpro" in p:
        return "SWE-bench Pro"
    if "deep-swe" in p or "deepswe" in p:
        return "DeepSWE"
    return ""


def _local_iso(stamp: str | None) -> str | None:
    """Pier writes job times without a zone, in the local time of the machine that ran it (this one)."""
    if not stamp:
        return None
    try:
        dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.astimezone()).isoformat()


def clean_name(name: object) -> str:
    """A run's display name: one line, no control characters, at most NAME_MAX characters. Empty clears it."""
    if not isinstance(name, str):
        raise TypeError("name must be a string")
    text = " ".join("".join(ch if ch.isprintable() else " " for ch in name).split())
    if len(text) > NAME_MAX:
        raise ValueError(f"a run name is at most {NAME_MAX} characters")
    return text


class Store:
    def __init__(self, roots: list[Path]) -> None:
        self.roots = roots
        self.trials: dict[tuple[str, str], TrialState] = {}
        # The server answers requests on several threads, and every read advances shared offsets: one at a time.
        self.lock = threading.RLock()

    def scan(self) -> list[dict]:
        with self.lock:
            return self._scan()

    def detail(self, job: str, trial: str, since: int) -> dict | None:
        with self.lock:
            st = self.get(job, trial)
            return None if st is None else st.detail(job, since)

    def _scan(self) -> list[dict]:
        out = []
        for root in self.roots:
            if not root.is_dir():
                continue
            for job in sorted(p for p in root.iterdir() if p.is_dir()):
                for trial in sorted(
                    p
                    for p in job.iterdir()
                    if p.is_dir() and (p / "config.json").exists()
                ):
                    agent_cfg = (_read_json(trial / "config.json") or {}).get(
                        "agent"
                    ) or {}
                    if not (
                        trial / "agent" / "decorum"
                    ).exists() and "decorum" not in str(
                        agent_cfg.get("import_path") or ""
                    ):
                        continue
                    key = (job.name, trial.name)
                    st = self.trials.setdefault(key, TrialState(trial))
                    out.append(st.overview(job.name))
        order = {"running": 0, "starting": 1, "stalled": 2, "finished": 3, "failed": 4}
        out.sort(
            key=lambda t: (
                order.get(t["status"], 9),
                "" if t["status"] == "running" else "~",
                -(_ts(t["started_at"]) or 0),
            )
        )
        return out

    def get(self, job: str, trial: str) -> TrialState | None:
        with self.lock:
            if (job, trial) not in self.trials:
                self._scan()
            return self.trials.get((job, trial))

    # ---------- runs: one Pier job each ----------

    def _job_dirs(self) -> list[tuple[Path, Path]]:
        out = []
        for root in self.roots:
            if root.is_dir():
                out += [
                    (root, j)
                    for j in sorted(p for p in root.iterdir() if p.is_dir())
                    if (j / "config.json").exists()
                    or any(
                        (t / "config.json").exists() for t in j.iterdir() if t.is_dir()
                    )
                ]
        return out

    def _names(self, root: Path) -> dict[str, str]:
        data = _read_json(root / NAMES_FILE) or {}
        names = data.get("names")
        return names if isinstance(names, dict) else {}

    def rename(self, job: str, name: object) -> str:
        """Give a run a display name (stored beside the jobs, in NAMES_FILE); an empty name restores the default."""
        text = clean_name(name)
        with self.lock:
            for root, j in self._job_dirs():
                if j.name != job:
                    continue
                path = root / NAMES_FILE
                data = _read_json(path) or {}
                names = data.get("names") if isinstance(data.get("names"), dict) else {}
                if text:
                    names[job] = text
                else:
                    names.pop(job, None)
                data["names"] = names
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
                tmp.replace(path)
                return text
        raise KeyError(job)

    def runs(self) -> list[dict]:
        with self.lock:
            by_job: dict[str, list[dict]] = {}
            for t in self._scan():
                by_job.setdefault(t["job"], []).append(t)
            runs = []
            for root, job in self._job_dirs():
                trials = by_job.get(job.name, [])
                cfg = _read_json(job / "config.json") or {}
                agent = (cfg.get("agents") or [{}])[0] or {}
                if not trials and "decorum" not in str(agent.get("import_path") or ""):
                    continue
                res = _read_json(job / "result.json") or {}
                stats = res.get("stats") or {}
                kw = agent.get("kwargs") or {}
                ds = (cfg.get("datasets") or [{}])[0] or {}
                single_tasks = cfg.get("tasks") or []
                paths = [str(ds.get("path") or "")] + [
                    str((t or {}).get("path") or "") for t in single_tasks
                ]
                task_names = list(ds.get("task_names") or []) + [
                    Path(p).name for p in paths[1:] if p
                ]
                planned = len(task_names) or res.get("n_total_trials") or len(trials)
                counts = {
                    "running": 0,
                    "passed": 0,
                    "not_passed": 0,
                    "ungraded": 0,
                    "failed": 0,
                }
                for t in trials:
                    if t["status"] in ("running", "starting"):
                        counts["running"] += 1
                    elif t["reward"] is not None:
                        counts["passed" if t["reward"] >= 1 else "not_passed"] += 1
                    elif t["status"] == "failed" or t["problem"]:
                        counts["failed"] += 1
                    else:
                        counts["ungraded"] += 1
                pending = max(0, planned - len(trials))
                finished_at = _local_iso(res.get("finished_at"))
                # A job with no finish time is running only while something in it still moves: a crashed pier
                # never writes finished_at, and must not look alive forever.
                touched = [
                    p.stat().st_mtime for p in (job, job / "result.json") if p.exists()
                ]
                touched += [
                    self.trials[(job.name, t["trial"])].last_activity()
                    for t in trials
                    if (job.name, t["trial"]) in self.trials
                ]
                alive = time.time() - max(touched, default=0) < STALE_SEC
                if counts["running"]:
                    status = "running"
                elif finished_at:
                    status = (
                        "stopped"
                        if (stats.get("n_cancelled_trials") or pending)
                        else "finished"
                    )
                elif alive and (
                    stats.get("n_running_trials")
                    or stats.get("n_pending_trials")
                    or pending
                ):
                    status = "running"
                elif (
                    trials
                    and not pending
                    and all(t["status"] == "finished" for t in trials)
                ):
                    status = "finished"
                else:
                    status = "stopped"
                import_path = str(agent.get("import_path") or "")
                bench = (
                    next((b for b in map(benchmark_of, paths) if b), "")
                    or (
                        "SWE-bench Pro"
                        if task_names
                        and all(n.startswith("instance_") for n in task_names)
                        else ""
                    )
                    or ("Replay" if job.name.startswith("replay-of-") else "")
                )
                order = {
                    "running": 0,
                    "starting": 1,
                    "stalled": 2,
                    "finished": 3,
                    "failed": 4,
                }
                trials.sort(key=lambda t: (order.get(t["status"], 9), t["task"]))
                runs.append(
                    {
                        "job": job.name,
                        "name": self._names(root).get(job.name) or None,
                        "benchmark": bench,
                        "mode": "single" if "Single" in import_path else "forum",
                        "rulebook": kw.get("rulebook")
                        or (trials[0]["rulebook"] if trials else None),
                        "authority_model": agent.get("model_name"),
                        "worker_model": kw.get("worker_model"),
                        "faux": bool(kw.get("faux")),
                        "started_at": _local_iso(res.get("started_at"))
                        or min(
                            (t["started_at"] for t in trials if t["started_at"]),
                            default=None,
                        ),
                        "finished_at": finished_at,
                        "status": status,
                        "planned": planned,
                        "pending": pending,
                        "counts": counts,
                        "cost_usd": round(sum(t["cost_usd"] or 0 for t in trials), 4),
                        "trials": trials,
                    }
                )
            runs.sort(
                key=lambda r: (r["status"] != "running", -(_ts(r["started_at"]) or 0))
            )
            return runs


def _ts(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def make_handler(store: Store):
    class H(BaseHTTPRequestHandler):
        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj: object) -> None:
            self._send(200, json.dumps(obj).encode(), "application/json")

        def do_POST(self) -> None:
            u = urlparse(self.path)
            if u.path != "/api/runs/rename":
                return self._send(404, b'{"error":"not found"}', "application/json")
            # Only the page itself may write: a custom header forces a CORS preflight that a foreign page cannot pass.
            if self.headers.get("X-Decorum-Viewer") != "1" or not (
                self.headers.get("Content-Type") or ""
            ).startswith("application/json"):
                return self._send(403, b'{"error":"forbidden"}', "application/json")
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 4096:
                return self._send(400, b'{"error":"bad request"}', "application/json")
            try:
                body = json.loads(self.rfile.read(n))
                name = store.rename(str(body.get("job", "")), body.get("name", ""))
            except KeyError:
                return self._send(404, b'{"error":"no such run"}', "application/json")
            except (ValueError, TypeError, AttributeError) as e:
                return self._send(
                    400, json.dumps({"error": str(e)}).encode(), "application/json"
                )
            return self._json({"job": body.get("job"), "name": name or None})

        def do_GET(self) -> None:
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == "/api/runs":
                return self._json(
                    {"now": datetime.now(UTC).isoformat(), "runs": store.runs()}
                )
            if u.path == "/api/trials":
                return self._json(
                    {"now": datetime.now(UTC).isoformat(), "trials": store.scan()}
                )
            if u.path == "/api/trial":
                try:
                    since = int(q.get("since", "0") or 0)
                except ValueError:
                    since = 0
                d = store.detail(q.get("job", ""), q.get("trial", ""), since)
                if d is None:
                    return self._send(
                        404, b'{"error":"no such trial"}', "application/json"
                    )
                return self._json(d)
            name = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
            f = (STATIC / name).resolve()
            if not str(f).startswith(str(STATIC)) or not f.is_file():
                return self._send(404, b"not found", "text/plain")
            ctype = {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
            }.get(f.suffix, "application/octet-stream")
            return self._send(200, f.read_bytes(), ctype)

        def log_message(self, format: str, *args: object) -> None:
            pass

    return H


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--jobs",
        action="append",
        type=Path,
        help=f"a Pier jobs directory (default {DEFAULT_JOBS}); repeat for several",
    )
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8479)
    ap.add_argument(
        "--tasks",
        action="append",
        type=Path,
        default=[],
        help="DeepSWE tasks dir(s), for task titles (found from each trial's config when it can)",
    )
    ap.add_argument(
        "--open", action="store_true", help="open the page in the default browser"
    )
    a = ap.parse_args()
    a.jobs = a.jobs or [DEFAULT_JOBS]
    a.tasks = a.tasks or [HERE.parent / ".deep-swe" / "tasks"]
    TASK_DIRS.extend(p.expanduser().resolve() for p in a.tasks)
    store = Store([p.expanduser().resolve() for p in a.jobs])
    server = ThreadingHTTPServer((a.host, a.port), make_handler(store))
    url = f"http://{a.host}:{a.port}/"
    print(
        f"decorum forum viewer: {url}  (jobs: {', '.join(map(str, store.roots))}; Ctrl-C to stop)",
        flush=True,
    )
    if a.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
