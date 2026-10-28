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
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
try:  # one definition of "failed" for the Retry button and the command line
    import retry_failed
except ImportError:  # the viewer copied away from base_forum: no retry
    retry_failed = None
ATTEMPTS = ".attempts"
DEFAULT_JOBS = HERE.parent / "jobs"
CATALOG_DIR = HERE.parent / "tasks" / "catalog"
RUN_LISTS = (
    HERE.parent / "tasks" / "runs"
)  # the task list of each run started from the page
RUN_BASELINE = SCRIPTS / "run_baseline.sh"
THINKING = ("off", "minimal", "low", "medium", "high", "xhigh", "max")
# provider/model or provider/vendor/model, ASCII only and matched whole (no trailing newline slips through)
MODEL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]*(/[A-Za-z0-9._:+-]+)+", re.ASCII)
# run_baseline.sh reads these from its environment: a run started from the page sets them, never inherits them.
# DEEPSWE_DIR and SWEPRO_DIR are passed on: they say where this computer keeps the benchmarks, not how a run runs.
RUN_SETTINGS = (
    "BENCHMARK",
    "MODE",
    "TASKS",
    "N_TASKS",
    "RULEBOOK",
    "AUTHORITY_MODEL",
    "WORKER_MODEL",
    "AUTHORITY_THINKING",
    "WORKER_THINKING",
    "CONCURRENCY",
    "CPUS",
    "MEMORY_MB",
    "ENV_FILE",
    "JOBS_DIR",
    "JOB_NAME",
    "DRY_RUN",
    "FAUX",
    "RETRIES",
    "MIN_WORKERS",
    "MAX_WORKERS",
    "MAX_LIVE_WORKERS",
    "BUDGET_USD",
)
PRESET_FILES = {
    "deepswe": [
        ("Baseline 10", "baseline-10.tsv", "the 10 tasks of the first baseline")
    ],
    "swebenchpro": [
        (
            "Collaborator's 10",
            "swebenchpro-10.tsv",
            "the 10 tasks your collaborator runs",
        )
    ],
}
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
        self.retry_enabled = retry_failed is not None
        self.retries: dict[
            str, subprocess.Popen
        ] = {}  # job -> the retry this server started, while it runs
        self.launch = launch_retry
        self.start_enabled = True
        self.start_launch = launch_run
        self.starting: dict[str, dict] = {}
        self._catalog: dict | None = None
        self.launch_grace = 2.0  # seconds to watch a new retry for an immediate refusal

    def scan(self) -> list[dict]:
        with self.lock:
            return [t for t in self._scan() if not t["superseded"]]

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
                earlier = job / ATTEMPTS
                for trial in sorted(
                    p
                    for p in [
                        *job.iterdir(),
                        *(earlier.iterdir() if earlier.is_dir() else []),
                    ]
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
                    st = self.trials.get(key)
                    if st is None or st.path != trial:  # new, or moved aside by a retry
                        st = self.trials[key] = TrialState(trial)
                    ov = st.overview(job.name)
                    ov["superseded"] = trial.parent.name == ATTEMPTS
                    out.append(ov)
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

    def _set_name(self, root: Path, job: str, text: str) -> None:
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

    def rename(self, job: str, name: object) -> str:
        """Give a run a display name (stored beside the jobs, in NAMES_FILE); an empty name restores the default."""
        text = clean_name(name)
        with self.lock:
            for root, j in self._job_dirs():
                if j.name == job:
                    self._set_name(root, job, text)
                    return text
        raise KeyError(job)

    # ---------- starting a run ----------

    def catalog(self) -> dict:
        """The benchmarks the New run page chooses from, with their tasks and saved lists (read once)."""
        if self._catalog is None:
            cats = {}
            for key in ("swebenchpro", "deepswe"):
                cat = _read_json(CATALOG_DIR / f"{key}.json")
                if not cat:
                    continue
                known = {t["id"] for t in cat["tasks"]}
                presets = []
                for name, file, about in PRESET_FILES.get(key, []):
                    f = HERE.parent / "tasks" / file
                    if f.exists():
                        ids = [
                            ln.split("\t")[0]
                            for ln in f.read_text().splitlines()
                            if ln
                            and not ln.startswith("#")
                            and not ln.startswith("task\t")
                        ]
                        presets.append(
                            {
                                "name": name,
                                "about": about,
                                "ids": [i for i in ids if i in known],
                            }
                        )
                hard = [t["id"] for t in cat["tasks"] if t.get("hard51")]
                if hard:
                    presets.append(
                        {
                            "name": "HARD-51",
                            "about": "Scale's hard subset of V2",
                            "ids": hard,
                        }
                    )
                cats[key] = {**cat, "presets": presets}
            self._catalog = cats
        return {"benchmarks": self._catalog, "start": self.start_enabled}

    def start(self, body: dict) -> dict:
        """Check a New run request, write its task list, and start run_baseline.sh with it in the background."""
        if not self.start_enabled:
            raise PermissionError(
                "starting runs is switched off in this viewer (--no-start)"
            )
        cats = self.catalog()["benchmarks"]
        key = body.get("benchmark")
        if key not in cats:
            raise ValueError(f"benchmark must be one of {', '.join(cats)}")
        tasks = body.get("tasks")
        if (
            not isinstance(tasks, list)
            or not tasks
            or not all(isinstance(t, str) for t in tasks)
        ):
            raise ValueError("tasks must be a non-empty list of task ids")
        tasks = list(dict.fromkeys(tasks))
        known = {t["id"] for t in cats[key]["tasks"]}
        unknown = [t for t in tasks if t not in known]
        if unknown:
            raise ValueError(f"not in {cats[key]['name']}: {', '.join(unknown[:5])}")

        def whole(name: str, lo: int, hi: int, default: int) -> int:
            v = body.get(name, default)
            if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
                raise ValueError(f"{name} must be a whole number from {lo} to {hi}")
            return v

        mode = body.get("mode", "forum")
        if mode not in ("forum", "single"):
            raise ValueError("mode must be forum or single")
        scripted = body.get("scripted") is True
        models = {
            "authority_model": body.get("authority_model"),
            "worker_model": body.get("worker_model") if mode == "forum" else None,
        }
        for name, m in models.items():
            if m is not None and (not isinstance(m, str) or not MODEL_RE.fullmatch(m)):
                raise ValueError(f"{name} must look like provider/model, got {m!r}")
        if models["authority_model"] is None or (
            mode == "forum" and models["worker_model"] is None
        ):
            raise ValueError(
                "authority_model is required, and worker_model in forum mode"
            )
        for name in ("authority_thinking", "worker_thinking"):
            if body.get(name, "high") not in THINKING:
                raise ValueError(f"{name} must be one of {', '.join(THINKING)}")
        lo, hi = whole("min_workers", 0, 8, 3), whole("max_workers", 1, 8, 6)
        if lo > hi:
            raise ValueError(f"min_workers ({lo}) is more than max_workers ({hi})")
        live, conc, retries = (
            whole("max_live_workers", 1, 8, 4),
            whole("concurrency", 1, 12, 2),
            whole("retries", 0, 3, 0),
        )
        budget = body.get("budget_usd", 10)
        if (
            not isinstance(budget, (int, float))
            or isinstance(budget, bool)
            or not 1 <= budget <= 1000
        ):
            raise ValueError("budget_usd must be from 1 to 1000 dollars")
        name = clean_name(body.get("name", "") or "")
        # the keys the models need, from base_forum/.env, where run_baseline.sh reads them (scripted agents need none)
        if not scripted:
            env_file = HERE.parent / ".env"
            have = (
                retry_failed.read_env_file(env_file)
                if retry_failed and env_file.is_file()
                else {}
            )
            for m in filter(None, models.values()):
                need = retry_failed.KEYS.get(m.split("/")[0]) if retry_failed else None
                if need and not have.get(need):
                    raise ValueError(
                        f"{need} is not set: put it in {env_file} (it is never sent to the page)"
                    )
        root = self.roots[0]
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        job = f"{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:40] or f'{key}-{mode}'}-{stamp}"
        with self.lock:
            if (root / job).exists() or job in self.starting:
                raise RuntimeError(
                    "a run with this name was started this second; try again"
                )
            RUN_LISTS.mkdir(parents=True, exist_ok=True)
            tsv = RUN_LISTS / f"{job}.tsv"
            tsv.write_text("task\n" + "\n".join(tasks) + "\n")
            env = {
                "BENCHMARK": key,
                "TASKS": str(tsv),
                "MODE": mode,
                "JOB_NAME": job,
                "JOBS_DIR": str(root),
                "AUTHORITY_MODEL": models["authority_model"],
                "AUTHORITY_THINKING": body.get("authority_thinking", "high"),
                "CONCURRENCY": str(conc),
                "RETRIES": str(retries),
                "BUDGET_USD": f"{budget:g}",
            }
            if mode == "forum":
                env.update(
                    {
                        "WORKER_MODEL": models["worker_model"],
                        "WORKER_THINKING": body.get("worker_thinking", "high"),
                        "MIN_WORKERS": str(lo),
                        "MAX_WORKERS": str(hi),
                        "MAX_LIVE_WORKERS": str(live),
                    }
                )
            if scripted:
                env["FAUX"] = "smoke"
            if name:
                self._set_name(root, job, name)
            (root / ".decorum-start").mkdir(parents=True, exist_ok=True)
            log = root / ".decorum-start" / f"{job}.log"
            proc = self.start_launch(env, log)
            self.starting[job] = {
                "proc": proc,
                "log": log,
                "benchmark": key,
                "mode": mode,
                "tasks": tasks,
                "name": name or None,
                "authority_model": models["authority_model"],
                "worker_model": models["worker_model"],
                "scripted": scripted,
                "at": datetime.now(UTC).isoformat(),
            }
        deadline = time.time() + self.launch_grace
        while time.time() < deadline and proc.poll() is None:
            time.sleep(0.1)
        if proc.poll() not in (None, 0):
            lines = [
                x for x in log.read_text(errors="replace").splitlines() if x.strip()
            ]
            # refused at once: leave nothing behind (no listed run, no name, no task list); the log stays
            with self.lock:
                self.starting.pop(job, None)
                if name:
                    self._set_name(root, job, "")
                tsv.unlink(missing_ok=True)
            raise RuntimeError(
                f"the run did not start: {lines[-1] if lines else 'see ' + str(log)}"
            )
        return {"job": job, "tasks": len(tasks), "log": str(log)}

    def _starting_runs(self, present: set[str]) -> list[dict]:
        """Runs started from the page whose job folder Pier has not made yet (or that stopped before it could)."""
        out = []
        bench_word = {"swebenchpro": "SWE-bench Pro", "deepswe": "DeepSWE"}
        for job, s in list(self.starting.items()):
            if job in present:
                if s["proc"].poll() is not None:
                    del self.starting[job]
                continue
            code = s["proc"].poll()
            problem = None
            if code not in (None, 0):
                lines = (
                    [
                        x
                        for x in s["log"].read_text(errors="replace").splitlines()
                        if x.strip()
                    ]
                    if s["log"].exists()
                    else []
                )
                problem = f"The run stopped before Pier made its folder: {lines[-1] if lines else 'see ' + str(s['log'])}"
            n = len(s["tasks"])
            out.append(
                {
                    "job": job,
                    "name": s["name"],
                    "benchmark": bench_word.get(s["benchmark"], s["benchmark"]),
                    "mode": s["mode"],
                    "rulebook": "base-0",
                    "authority_model": s["authority_model"],
                    "worker_model": s["worker_model"],
                    "faux": s["scripted"],
                    "started_at": s["at"],
                    "finished_at": None,
                    "status": "starting" if problem is None else "stopped",
                    "planned": n,
                    "pending": n,
                    "counts": {
                        "running": 0,
                        "passed": 0,
                        "not_passed": 0,
                        "ungraded": 0,
                        "failed": 0,
                    },
                    "cost_usd": 0.0,
                    "trials": [],
                    "earlier": [],
                    "retry": None,
                    "task_ids": s["tasks"],
                    "problem": problem,
                }
            )
        return out

    # ---------- retrying failed tasks ----------

    def _earlier(self, job: Path, earlier: list[dict]) -> list[dict]:
        """Attempts a retry moved aside, with why (from .attempts/attempts.jsonl), oldest first."""
        why = {}
        log = job / ATTEMPTS / "attempts.jsonl"
        if log.exists():
            for line in log.read_text().splitlines():
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("moved_to"):
                    why[Path(row["moved_to"]).name] = row
        out = []
        for t in earlier:
            row = why.get(t["trial"], {})
            out.append(
                {
                    **t,
                    "reason": row.get("reason") or t.get("problem"),
                    "retried_at": row.get("at"),
                }
            )
        return sorted(out, key=lambda t: t.get("retried_at") or "")

    def _retry_state(self, job: Path) -> dict | None:
        """What the Retry button would run again, and whether a retry is running now."""
        if not self.retry_enabled or not (job / "config.json").exists():
            return None
        proc = self.retries.get(job.name)
        if proc is not None and proc.poll() is not None:
            del self.retries[job.name]
            proc = None
        try:
            todo = retry_failed.retryable(
                retry_failed.classify(job), graded_errors=True
            )
        except (SystemExit, OSError, ValueError):
            todo = []
        logs = (
            sorted((job / ATTEMPTS).glob("retry-*.log"))
            if (job / ATTEMPTS).is_dir()
            else []
        )
        return {
            "tasks": [
                {
                    **{k: r.get(k) for k in ("task", "state", "reason", "trial")},
                    "default": r["state"]
                    in retry_failed.RETRIED,  # ticked unless the reader unticks it
                    "always": r["state"]
                    in retry_failed.ALWAYS,  # Pier runs it on any resume
                }
                for r in todo
            ],
            "in_progress": proc is not None
            or retry_failed.lock_holder(job) is not None,
            "log": f"{ATTEMPTS}/{logs[-1].name}" if logs else None,
            "command": f"python3 {SCRIPTS / 'retry_failed.py'} {job}",
        }

    def retry_log(self, job: str, lines: int = 60) -> dict | None:
        """The end of the newest retry's log (what retry_failed.py and Pier printed)."""
        with self.lock:
            found = next((j for _, j in self._job_dirs() if j.name == job), None)
        if found is None:
            return None
        logs = (
            sorted((found / ATTEMPTS).glob("retry-*.log"))
            if (found / ATTEMPTS).is_dir()
            else []
        )
        if not logs:
            return {"job": job, "log": None, "text": ""}
        text = logs[-1].read_text(errors="replace").splitlines()[-lines:]
        return {
            "job": job,
            "log": f"{ATTEMPTS}/{logs[-1].name}",
            "text": "\n".join(text),
        }

    def retry(self, job: str, tasks: object) -> dict:
        """Start retry_failed.py on a run's failed tasks (the default ones, or the ones named)."""
        if not self.retry_enabled:
            raise PermissionError(
                "retrying is switched off in this viewer (--no-retry)"
            )
        if tasks is not None and (
            not isinstance(tasks, list) or not all(isinstance(t, str) for t in tasks)
        ):
            raise TypeError("tasks must be a list of task ids")
        named = list(dict.fromkeys(tasks or []))
        with self.lock:
            found = next((j for _, j in self._job_dirs() if j.name == job), None)
            if found is None or not (found / "config.json").exists():
                raise KeyError(job)
            state = self._retry_state(found)
            if state["in_progress"] or retry_failed.is_running(found):
                raise RuntimeError(
                    "this run is still running; retry it when it has finished"
                )
            picked, errors = retry_failed.pick(retry_failed.classify(found), named)
            if errors:
                raise ValueError("; ".join(errors))
            if not picked:
                raise ValueError(
                    "nothing to retry: every task in this run has a graded attempt"
                )
            proc, log = self.launch(found, named or None)
            self.retries[job] = proc
        # a retry that refuses (a missing key, no pier) stops within a moment: say why instead of "started"
        deadline = time.time() + self.launch_grace
        while time.time() < deadline and proc.poll() is None:
            time.sleep(0.1)
        if proc.poll() not in (None, 0):
            lines = [
                x
                for x in (found / log).read_text(errors="replace").splitlines()
                if x.strip()
            ]
            raise RuntimeError(
                f"the retry stopped at once: {lines[-1] if lines else 'see ' + log}"
            )
        return {"job": job, "tasks": [r["task"] for r in picked], "log": log}

    def teams(self, job: str, runs: list[dict] | None = None) -> dict | None:
        """How the authority staffed each task of one run, and the run's setup."""
        with self.lock:
            run = next(
                (
                    r
                    for r in (runs if runs is not None else self.runs())
                    if r["job"] == job
                ),
                None,
            )
            if run is None:
                return None
            rows, setup = [], None
            for t in run["trials"]:
                st = self.trials.get((job, t["trial"]))
                if st is None:
                    continue
                st.update()
                summary = _read_json(st.dec / "summary.json") or {}
                if summary and setup is None:
                    setup = {
                        "rulebook": summary.get("rulebook"),
                        "models": summary.get("models"),
                        "commit_policy": summary.get("commit_policy"),
                    }
                rows.append(
                    {
                        **{
                            k: t.get(k)
                            for k in (
                                "trial",
                                "task",
                                "title",
                                "repository",
                                "status",
                                "reward",
                                "tests",
                                "cost_usd",
                                "duration_sec",
                                "problem",
                                "started_at",
                            )
                        },
                        **team_of(st),
                    }
                )
            return {
                "run": {k: v for k, v in run.items() if k != "trials"},
                "setup": setup,
                "tasks": rows,
            }

    def insights(self, jobs: list[str] | None) -> dict:
        """Every selected run with its tasks' teams and threads, for the cross-run page."""
        with self.lock:
            out = []
            runs = self.runs()
            for r in runs:
                if jobs and r["job"] not in jobs:
                    continue
                d = self.teams(r["job"], runs)
                if d:
                    out.append(d)
            return {"runs": out}

    def search(self, q: str, jobs: list[str] | None, limit: int = 120) -> dict:
        """Posts and finish reports whose text contains every word of q (case-insensitive)."""
        words = [w for w in q.lower().split() if w]
        if not words:
            return {"q": q, "hits": [], "more": False}
        hits = []
        with self.lock:
            for r in self.runs():
                if jobs and r["job"] not in jobs:
                    continue
                for t in [*r["trials"], *r["earlier"]]:
                    st = self.trials.get((r["job"], t["trial"]))
                    if st is None:
                        continue
                    titles, roles = {}, {}
                    for e in st.events:
                        k = e.get("kind")
                        if k == "thread_opened":
                            titles[e["thread"]["id"]] = e["thread"].get("title", "")
                        elif k == "assigned":
                            a = e["assignment"]
                            roles[a["worker"]] = role_of(
                                a.get("persona", ""), titles.get(a.get("thread"), "")
                            )
                        text, who, thread = None, None, None
                        if k == "post":
                            text, who, thread = (
                                e["post"].get("text", ""),
                                e["post"].get("author", ""),
                                e["post"].get("thread"),
                            )
                        elif k == "finished":
                            a = e["assignment"]
                            text, who, thread = (
                                (a.get("summary") or "")
                                + " "
                                + (a.get("evidence") or ""),
                                a.get("worker"),
                                a.get("thread"),
                            )
                        if text and all(w in text.lower() for w in words):
                            hits.append(
                                {
                                    "job": r["job"],
                                    "run": r["name"] or r["job"],
                                    "trial": t["trial"],
                                    "task": t["task"],
                                    "title": t["title"],
                                    "earlier": t.get("superseded", False),
                                    "at": e.get("at"),
                                    "kind": "finish report"
                                    if k == "finished"
                                    else "post",
                                    "author": who,
                                    "role": "authority"
                                    if who == "authority"
                                    else roles.get(who, ""),
                                    "thread": thread,
                                    "thread_title": titles.get(thread, ""),
                                    "text": text[:600],
                                }
                            )
        hits.sort(key=lambda h: h["at"] or "", reverse=True)
        return {
            "q": q,
            "hits": hits[:limit],
            "more": len(hits) > limit,
            "total": len(hits),
        }

    def runs(self) -> list[dict]:
        with self.lock:
            by_job: dict[str, list[dict]] = {}
            for t in self._scan():
                by_job.setdefault(t["job"], []).append(t)
            runs = []
            for root, job in self._job_dirs():
                everything = by_job.get(job.name, [])
                trials = [t for t in everything if not t["superseded"]]
                earlier = [t for t in everything if t["superseded"]]
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
                # the job folder's own time changes when a retry makes .attempts/; a new trial folder has its own
                touched = [
                    p.stat().st_mtime
                    for p in [job / "result.json", *job.iterdir()]
                    if p.exists() and p.name != ATTEMPTS
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
                retry = self._retry_state(job)
                if retry and retry["in_progress"]:
                    status = "running"
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
                        "earlier": self._earlier(job, earlier),
                        "retry": retry,
                        "task_ids": task_names or sorted({t["task"] for t in trials}),
                    }
                )
            runs += self._starting_runs({r["job"] for r in runs})
            runs.sort(
                key=lambda r: (r["status"] != "running", -(_ts(r["started_at"]) or 0))
            )
            return runs


ROLE_WORDS = [
    ("reviewer", ("review", "audit", "critic", "verif")),
    ("tester", ("test", "qa", "quality")),
    ("investigator", ("investig", "research", "explor", "analys", "diagnos", "triage")),
]


def role_of(persona: str, title: str) -> str:
    """A worker's role, guessed from its persona and its thread's title (a keyword rule, shown as a guess)."""
    text = f"{persona} {title}".lower()
    for role, words in ROLE_WORDS:
        if any(w in text for w in words):
            return role
    return "implementer"


KIND_WORDS = [
    ("plan", ("plan", "requirement")),
    ("review", ("review", "audit", "verif", "final check")),
    ("tests", ("test", "qa")),
    ("investigation", ("investig", "research", "explor", "diagnos", "triage", "scout")),
]


def kind_of(title: str, goal: str = "") -> str:
    """What a thread was about, guessed from its title (then its goal) by keywords."""
    for text in (title.lower(), goal.lower()):
        for kind, words in KIND_WORDS:
            if any(w in text for w in words):
                return kind
    return "implementation"


def team_of(st: TrialState) -> dict:
    titles, workers, posts_by, finished_at = {}, {}, {}, {}
    threads: dict[str, dict] = {}
    edges: dict[tuple[str, str], int] = {}
    refusals = 0
    for e in st.events:
        k = e.get("kind")
        if k == "thread_opened":
            th = e["thread"]
            titles[th["id"]] = th.get("title", "")
            threads[th["id"]] = {
                "id": th["id"],
                "title": th.get("title", ""),
                "kind": kind_of(th.get("title", ""), th.get("goal", "")),
                "opened_at": e.get("at"),
                "closed_at": None,
                "last_at": e.get("at"),
                "posts": 0,
                "sent_back": 0,
                "workers": [],
            }
        elif k == "thread_closed":
            th = threads.get((e.get("thread") or {}).get("id"))
            if th:
                th["closed_at"] = e.get("at")
        elif k == "assigned":
            a = e["assignment"]
            if a.get("thread") in threads:
                threads[a["thread"]]["workers"].append(a["worker"])
            workers[a["worker"]] = {
                "worker": a["worker"],
                "persona": a.get("persona", ""),
                "thread": a.get("thread"),
                "title": titles.get(a.get("thread"), ""),
                "posts": 0,
                "sent_back": 0,
                "finished": False,
            }
        elif k == "finished":
            w = workers.get(e["assignment"]["worker"])
            if w:
                w["finished"] = True
                finished_at[w["thread"]] = w["worker"]
        elif k == "post":
            post = e["post"]
            who = post.get("author", "")
            posts_by[who] = posts_by.get(who, 0) + 1
            if who in workers:
                workers[who]["posts"] += 1
            th = threads.get(post.get("thread"))
            if th:
                th["posts"] += 1
                th["last_at"] = e.get("at")
            # the authority posting in the thread of a worker that had finished sends it back
            if who == "authority" and post.get("thread") in finished_at:
                w = workers[finished_at.pop(post["thread"])]
                w["sent_back"] += 1
                if th:
                    th["sent_back"] += 1
            for m in post.get("mentions") or []:
                edges[(who, m)] = edges.get((who, m), 0) + 1
        elif k == "refusal":
            refusals += 1
    team = list(workers.values())
    for w in team:
        w["role"] = role_of(w["persona"], w["title"])
    return {
        "team": team,
        "threads": len(titles),
        "posts_authority": posts_by.get("authority", 0),
        "posts_workers": sum(v for k, v in posts_by.items() if k != "authority"),
        "sent_back": sum(w["sent_back"] for w in team),
        "refusals": refusals,
        "mentions": [{"from": a, "to": b, "n": n} for (a, b), n in edges.items()],
        "thread_list": list(threads.values()),
        "first_at": st.events[0].get("at") if st.events else None,
    }


def launch_run(env: dict[str, str], log: Path) -> subprocess.Popen:
    """Run run_baseline.sh on its own, detached from this server, with the run's settings in its environment."""
    base = {k: v for k, v in os.environ.items() if k not in RUN_SETTINGS}
    with log.open("w") as out:
        return subprocess.Popen(
            ["bash", str(RUN_BASELINE)],
            env={**base, **env},
            stdout=out,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )


def launch_retry(job: Path, tasks: list[str] | None) -> tuple[subprocess.Popen, str]:
    """Run retry_failed.py on its own, detached from this server; its output goes to .attempts/retry-<time>.log."""
    (job / ATTEMPTS).mkdir(exist_ok=True)
    name = f"retry-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.log"
    cmd = [sys.executable, str(SCRIPTS / "retry_failed.py"), str(job), "--yes"]
    for t in tasks or []:
        cmd += ["--task", t]
    with (job / ATTEMPTS / name).open("w") as out:
        proc = subprocess.Popen(
            cmd,
            stdout=out,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    return proc, f"{ATTEMPTS}/{name}"


def _ts(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def make_handler(store: Store, extra_hosts: tuple[str, ...] = ()):
    class H(BaseHTTPRequestHandler):
        def _host_ok(self) -> bool:
            """Answer only requests addressed to this server by name: a page that rebinds its own DNS name to
            127.0.0.1 is then refused, so it can neither read the forums nor start a retry."""
            port = self.server.server_address[1]
            host = (self.headers.get("Host") or "").lower()
            names = {
                "127.0.0.1",
                "localhost",
                "[::1]",
                *(h.lower() for h in extra_hosts),
            }
            return host in names or host in {f"{n}:{port}" for n in names}

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
            if not self._host_ok():
                return self._send(421, b'{"error":"unknown host"}', "application/json")
            u = urlparse(self.path)
            if u.path not in ("/api/runs/rename", "/api/runs/retry", "/api/runs/start"):
                return self._send(404, b'{"error":"not found"}', "application/json")
            # Only the page itself may write: a custom header forces a CORS preflight that a foreign page cannot pass.
            if self.headers.get("X-Decorum-Viewer") != "1" or not (
                self.headers.get("Content-Type") or ""
            ).startswith("application/json"):
                return self._send(403, b'{"error":"forbidden"}', "application/json")
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > (262144 if u.path == "/api/runs/start" else 4096):
                return self._send(400, b'{"error":"bad request"}', "application/json")

            def fail(code: int, msg: str) -> None:
                self._send(
                    code, json.dumps({"error": msg}).encode(), "application/json"
                )

            try:
                body = json.loads(self.rfile.read(n))
                if not isinstance(body, dict):
                    raise TypeError("the body must be a JSON object")
                if u.path == "/api/runs/start":
                    return self._json(store.start(body))
                if u.path == "/api/runs/retry":
                    return self._json(
                        store.retry(str(body.get("job", "")), body.get("tasks"))
                    )
                name = store.rename(str(body.get("job", "")), body.get("name", ""))
            except KeyError:
                return fail(404, "no such run")
            except PermissionError as e:
                return fail(403, str(e))
            except OSError as e:
                return fail(500, f"could not start: {e}")
            except RuntimeError as e:
                return fail(409, str(e))
            except (ValueError, TypeError, AttributeError) as e:
                return fail(400, str(e))
            return self._json({"job": body.get("job"), "name": name or None})

        def do_GET(self) -> None:
            if not self._host_ok():
                return self._send(
                    421,
                    b"unknown host; start the viewer with --allow-host <name>",
                    "text/plain",
                )
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == "/api/runs":
                return self._json(
                    {"now": datetime.now(UTC).isoformat(), "runs": store.runs()}
                )
            if u.path == "/api/insights":
                jobs = [j for j in q.get("jobs", "").split(",") if j] or None
                return self._json(store.insights(jobs))
            if u.path == "/api/search":
                jobs = [j for j in q.get("jobs", "").split(",") if j] or None
                return self._json(store.search(q.get("q", "")[:200], jobs))
            if u.path == "/api/catalog":
                return self._json(store.catalog())
            if u.path == "/api/runs/retry-log":
                d = store.retry_log(q.get("job", ""))
                if d is None:
                    return self._send(
                        404, b'{"error":"no such run"}', "application/json"
                    )
                return self._json(d)
            if u.path == "/api/teams":
                d = store.teams(q.get("job", ""))
                if d is None:
                    return self._send(
                        404, b'{"error":"no such run"}', "application/json"
                    )
                return self._json(d)
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
                ".woff2": "font/woff2",
                ".txt": "text/plain; charset=utf-8",
            }.get(f.suffix, "application/octet-stream")
            return self._send(200, f.read_bytes(), ctype)

        def log_message(self, format: str, *args: object) -> None:
            pass

    return H


def paid_actions(store: Store, a: argparse.Namespace) -> None:
    """Retry and New run start paid work. Served beyond this computer (--allow-host, behind a proxy such as
    tailscale serve), anyone who can reach the page could use them, so they are then off unless allowed by name."""
    remote = bool(a.allow_host) or a.host not in ("127.0.0.1", "localhost", "::1")
    store.retry_enabled = (
        store.retry_enabled and not a.no_retry and (not remote or a.allow_retry)
    )
    store.start_enabled = not a.no_start and (not remote or a.allow_start)


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
    ap.add_argument(
        "--allow-host",
        action="append",
        default=[],
        help="another name the page is reached by (behind a proxy such as tailscale serve); "
        "requests under any other name are refused",
    )
    ap.add_argument(
        "--allow-start",
        action="store_true",
        help="keep New run on when the page is served beyond this computer (--allow-host)",
    )
    ap.add_argument(
        "--allow-retry",
        action="store_true",
        help="keep Retry on when the page is served beyond this computer (--allow-host)",
    )
    ap.add_argument(
        "--no-start",
        action="store_true",
        help="hide New run (starting a run costs model calls)",
    )
    ap.add_argument(
        "--no-retry",
        action="store_true",
        help="hide the Retry button (retrying runs tasks again, which costs model calls)",
    )
    a = ap.parse_args()
    a.jobs = a.jobs or [DEFAULT_JOBS]
    a.tasks = a.tasks or [HERE.parent / ".deep-swe" / "tasks"]
    TASK_DIRS.extend(p.expanduser().resolve() for p in a.tasks)
    store = Store([p.expanduser().resolve() for p in a.jobs])
    paid_actions(store, a)
    server = ThreadingHTTPServer(
        (a.host, a.port), make_handler(store, (a.host, *a.allow_host))
    )
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
