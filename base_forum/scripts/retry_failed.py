#!/usr/bin/env python3
"""Run a job's failed tasks again, in the same job, with the same settings; keep the failed attempts.

    python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job>               # list what would be retried, ask, retry
    python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job> --dry-run     # list only
    python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job> --task <id>   # just this task (repeatable)
    python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job> --yes         # no question (the viewer's Retry button)

A task is retried when its attempt did not end in a grade of its own work:
  failed       Pier recorded an error (the agent's time limit, a Docker or network failure, a crash, a cancel), and the
               task did not pass;
  interrupted  the trial folder has no result.json and the job is not running (Pier was stopped mid-trial);
  not started  the task is in the job's plan but has no trial folder.
A task that was graded (passed or not, by Pier or by regrade.sh) is never retried: running it again until it passes would change what the
number means.

How: each failed attempt's folder is moved to <job>/.attempts/<trial>/ and logged in <job>/.attempts/attempts.jsonl
(the viewer shows it as an earlier attempt), then `pier job resume` runs the tasks that no longer have a result, with
the job's own config.json: same models, rulebook, time limit and concurrency. The keys come from the same env file as
run_baseline.sh (ENV_FILE, default base_forum/.env); they are passed to Pier and never printed.

Exit 0 when Pier finished (whatever the results), 2 on a usage error or when there is nothing to retry, 3 when the
job looks like it is still running, Pier's own code otherwise. Standard library only (macOS ships Python 3.9).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ATTEMPTS = ".attempts"
LOCK = "retry.lock"
STALE_SEC = 600  # a job with no file written for this long is not running (as in the viewer)
KEYS = {  # provider prefix of a model -> the key it needs (as in run_baseline.sh)
    "moonshotai": "MOONSHOT_API_KEY",
    "moonshotai-cn": "MOONSHOT_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "kimi-coding": "KIMI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "together": "TOGETHER_API_KEY",
}


def read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def task_of(trial: Path) -> str:
    """A trial's task id: its task folder's name (Pier's result names it with a dataset prefix)."""
    cfg = read_json(trial / "config.json") or {}
    task = cfg.get("task") or {}
    if task.get("path"):
        return Path(str(task["path"])).name
    if task.get("name"):
        return str(task["name"]).split("/")[-1]
    return trial.name.split("__")[0]


def reward_of(trial: Path, result: dict | None) -> float | None:
    vr = (result or {}).get("verifier_result") or {}
    r = (vr.get("rewards") or {}).get("reward")
    if r is None:
        r = (read_json(trial / "verifier" / "reward.json") or {}).get("reward")
    if r is None:
        r = (read_json(trial / "regrade" / "reward.json") or {}).get("reward")
    try:
        return None if r is None else float(r)
    except (TypeError, ValueError):
        return None


def planned_tasks(config: dict) -> list[str]:
    names: list[str] = []
    for ds in config.get("datasets") or []:
        names += [str(n).split("/")[-1] for n in ds.get("task_names") or []]
    names += [Path(str(t.get("path"))).name for t in config.get("tasks") or [] if t.get("path")]
    return names * max(1, int(config.get("n_attempts") or 1))


def last_write(job: Path) -> float:
    """The newest modification time among the job's files, two levels deep (cheap and enough to see a live run)."""
    times = [job.stat().st_mtime]
    for p in job.iterdir():
        if p.name == ATTEMPTS:
            continue
        try:
            times.append(p.stat().st_mtime)
            if p.is_dir():
                for q in p.iterdir():
                    times.append(q.stat().st_mtime)
                    if q.name == "agent" and (q / "decorum" / "forum.jsonl").exists():
                        times.append((q / "decorum" / "forum.jsonl").stat().st_mtime)
        except OSError:
            pass
    return max(times)


def lock_holder(job: Path) -> int | None:
    """The pid of a retry still running on this job, if any (a stale lock is ignored)."""
    data = read_json(job / ATTEMPTS / LOCK)
    pid = (data or {}).get("pid")
    if not isinstance(pid, int):
        return None
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return None
    except PermissionError:
        return pid
    return pid


def is_running(job: Path, now: float | None = None) -> bool:
    now = now or time.time()
    if lock_holder(job):
        return True
    res = read_json(job / "result.json") or {}
    if not res.get("finished_at"):
        return now - last_write(job) < STALE_SEC
    # Finished once. A resume started by hand keeps the old finished_at while it runs: look for a trial still being
    # written that has no result yet.
    for trial in job.iterdir():
        if trial.is_dir() and trial.name != ATTEMPTS and (trial / "config.json").exists() and not (trial / "result.json").exists():
            if now - last_write_of(trial) < STALE_SEC:
                return True
    return False


def last_write_of(trial: Path) -> float:
    times = [trial.stat().st_mtime]
    for p in (trial / "trial.log", trial / "agent" / "decorum" / "forum.jsonl", trial / "agent"):
        try:
            times.append(p.stat().st_mtime)
        except OSError:
            pass
    return max(times)


def classify(job: Path) -> list[dict]:
    """Every task of the job with its state: graded, failed, interrupted or not started (one row per planned attempt)."""
    config = read_json(job / "config.json")
    if config is None:
        raise SystemExit(f"retry_failed: {job} has no config.json; is it a Pier job folder?")
    rows: list[dict] = []
    for trial in sorted(p for p in job.iterdir() if p.is_dir() and p.name != ATTEMPTS and (p / "config.json").exists()):
        result = read_json(trial / "result.json")
        task = task_of(trial)
        if result is None:
            rows.append({"task": task, "trial": trial.name, "state": "interrupted", "reason": "no result.json: the trial was stopped before it finished", "reward": None})
            continue
        exc = result.get("exception_info") or None
        reward = reward_of(trial, result)
        # regrade.sh graded the agent's work after Pier's own grading step broke: that attempt counts as graded
        regraded = (trial / "regrade" / "reward.json").exists()
        if exc and not regraded and not (reward is not None and reward >= 1):
            msg = " ".join(str(exc.get("exception_message") or "").split())[:300]
            rows.append({"task": task, "trial": trial.name, "state": "failed", "reason": f"{exc.get('exception_type') or 'error'}: {msg}".rstrip(": "), "exception_type": exc.get("exception_type"), "reward": reward})
        else:
            rows.append({"task": task, "trial": trial.name, "state": "graded", "reason": "", "reward": reward})
    have: dict[str, int] = {}
    for r in rows:
        have[r["task"]] = have.get(r["task"], 0) + 1
    for task in planned_tasks(config):
        if have.get(task, 0) > 0:
            have[task] -= 1
        else:
            rows.append({"task": task, "trial": None, "state": "not started", "reason": "planned, but no trial folder", "reward": None})
    return rows


def retryable(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["state"] in ("failed", "interrupted", "not started")]


def run_dir(job: Path, config: dict) -> Path:
    """The directory Pier must run in so that config.jobs_dir / job_name is this job (jobs_dir may be relative)."""
    jobs_dir = Path(str(config.get("jobs_dir") or job.parent))
    name = str(config.get("job_name") or job.name)
    if jobs_dir.is_absolute():
        if (jobs_dir / name).resolve() != job.resolve():
            raise SystemExit(f"retry_failed: the job's config says it lives in {jobs_dir / name}, not {job}; move it back or run Pier by hand")
        return job.parent
    base = job.resolve()
    for _ in range(len(Path(name).parts) + len(jobs_dir.parts)):
        base = base.parent
    if (base / jobs_dir / name).resolve() != job.resolve():
        raise SystemExit(f"retry_failed: cannot place {jobs_dir / name} relative to {job}")
    return base


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines (an optional 'export ', quotes, # comments), as python-dotenv reads them for Pier."""
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        if s.startswith("export "):
            s = s[7:].lstrip()
        k, v = s.split("=", 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        elif " #" in v:
            v = v.split(" #", 1)[0].rstrip()
        if k:
            env[k] = v
    return env


def needed_keys(config: dict) -> list[str]:
    agent = (config.get("agents") or [{}])[0] or {}
    kw = agent.get("kwargs") or {}
    if kw.get("faux"):
        return []
    models = [agent.get("model_name"), kw.get("worker_model")]
    return sorted({KEYS[m.split("/")[0]] for m in models if isinstance(m, str) and m.split("/")[0] in KEYS})


def archive(job: Path, picked: list[dict]) -> list[dict]:
    """Move each picked attempt's folder to .attempts/ and log it; returns the log rows."""
    att = job / ATTEMPTS
    att.mkdir(exist_ok=True)
    rows = []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for r in picked:
        row = {"at": now, "task": r["task"], "state": r["state"], "reason": r["reason"], "trial": r["trial"], "moved_to": None}
        if r["trial"]:
            dest = att / r["trial"]
            n = 2
            while dest.exists():
                dest = att / f"{r['trial']}.{n}"
                n += 1
            shutil.move(str(job / r["trial"]), str(dest))
            row["moved_to"] = str(dest.relative_to(job))
        rows.append(row)
    with (att / "attempts.jsonl").open("a") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
    return rows


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job", type=Path, help="the job folder, e.g. base_forum/jobs/swebenchpro-forum-base-0-20261028T101500Z")
    ap.add_argument("--task", action="append", default=[], help="retry only this task id (repeatable); it must be one that failed")
    ap.add_argument("--dry-run", action="store_true", help="list what would be retried and the command, and stop")
    ap.add_argument("--yes", "-y", action="store_true", help="do not ask before starting")
    ap.add_argument("--force", action="store_true", help="retry even if the job looks like it is still running")
    ap.add_argument("--env-file", type=Path, default=Path(os.environ.get("ENV_FILE", BASE / ".env")))
    a = ap.parse_args(argv)

    job = a.job.resolve()
    if not job.is_dir():
        print(f"retry_failed: no job folder at {a.job}", file=sys.stderr)
        return 2
    config = read_json(job / "config.json")
    if config is None:
        print(f"retry_failed: {a.job} has no config.json; is it a Pier job folder?", file=sys.stderr)
        return 2
    rows = classify(job)
    todo = retryable(rows)
    if a.task:
        unknown = [t for t in a.task if t not in {r["task"] for r in rows}]
        if unknown:
            print(f"retry_failed: not in this job: {', '.join(unknown)}", file=sys.stderr)
            return 2
        graded = [t for t in a.task if t not in {r["task"] for r in todo}]
        if graded:
            print(f"retry_failed: already graded, not retried: {', '.join(graded)}", file=sys.stderr)
            return 2
        todo = [r for r in todo if r["task"] in a.task]
    graded_n = sum(r["state"] == "graded" for r in rows)
    print(f"job {job.name}: {len(rows)} tasks, {graded_n} graded, {len(retryable(rows))} to retry")
    for r in todo:
        print(f"  {r['state']:<12} {r['task']}" + (f"\n               {r['reason']}" if r["reason"] and r["state"] == "failed" else ""))
    if not todo:
        print("nothing to retry")
        return 2
    if not a.force and is_running(job):
        holder = lock_holder(job)
        print(f"retry_failed: the job looks like it is still running{f' (a retry, pid {holder})' if holder else ''}; wait for it, or pass --force", file=sys.stderr)
        return 3

    cwd = run_dir(job, config)
    cmd = ["pier", "job", "resume", "-p", str(job.relative_to(cwd) if job.is_relative_to(cwd) else job)]
    print(f"command: (cd {cwd} && {' '.join(cmd)})")
    if a.dry_run:
        return 0
    if shutil.which("pier") is None:
        print('retry_failed: pier is not installed: uv tool install datacurve-pier --with-editable "base_forum/pier_adapter"', file=sys.stderr)
        return 2
    env = dict(os.environ)
    if a.env_file.is_file():
        env.update(read_env_file(a.env_file))
    missing = [k for k in needed_keys(config) if not env.get(k)]
    if missing:
        print(f"retry_failed: {', '.join(missing)} is not set; put it in {a.env_file} (as for run_baseline.sh)", file=sys.stderr)
        return 2
    env.setdefault("DOCKER_DEFAULT_PLATFORM", "linux/amd64")  # as run_baseline.sh: the task images are linux/amd64
    if not a.yes:
        if not sys.stdin.isatty():
            print("retry_failed: pass --yes to retry without a question", file=sys.stderr)
            return 2
        if input(f"Retry {len(todo)} task{'s' if len(todo) != 1 else ''}? This runs them again with the same models. [y/N] ").strip().lower() not in ("y", "yes"):
            print("not retried")
            return 2

    moved = archive(job, todo)
    lock = job / ATTEMPTS / LOCK
    lock.write_text(json.dumps({"pid": os.getpid(), "started_at": moved[0]["at"], "tasks": [r["task"] for r in todo]}))
    try:
        code = subprocess.call(cmd, cwd=cwd, env=env)
    finally:
        lock.unlink(missing_ok=True)
    after = {r["task"]: r for r in classify(job)}
    print("\nafter the retry:")
    for r in todo:
        now = after.get(r["task"])
        word = "not run" if now is None else now["state"] if now["state"] != "graded" else ("passed" if (now["reward"] or 0) >= 1 else "did not pass")
        print(f"  {r['task']}: {word}" + (f" ({now['reason']})" if now and now["state"] == "failed" else ""))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
