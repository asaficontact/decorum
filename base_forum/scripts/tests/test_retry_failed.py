"""retry_failed.py against synthetic Pier job folders and a fake `pier` that resumes the way Pier does."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
SCRIPT = HERE / "retry_failed.py"
sys.path.insert(0, str(HERE))
import retry_failed as rf

FAKE_PIER = r'''#!/usr/bin/env python3
# Records how it was called, then does what `pier job resume` does: deletes every trial folder without a result.json,
# then runs every planned task that has no trial folder (here: writes a passing result at once).
import json, os, shutil, sys
from pathlib import Path
log = Path(os.environ["FAKE_PIER_LOG"])
job = Path(sys.argv[sys.argv.index("-p") + 1])
job = job if job.is_absolute() else Path.cwd() / job
log.write_text(json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd(), "has_key": bool(os.environ.get("MOONSHOT_API_KEY")),
                           "platform": os.environ.get("DOCKER_DEFAULT_PLATFORM"), "lock": (job / ".attempts" / "retry.lock").exists()}))
for t in list(job.iterdir()):
    if t.is_dir() and (t / "config.json").exists() and not (t / "result.json").exists():
        shutil.rmtree(t)
cfg = json.loads((job / "config.json").read_text())
planned = list(cfg["datasets"][0]["task_names"])
have = [json.loads((t / "config.json").read_text())["task"]["path"].split("/")[-1]
        for t in job.iterdir() if t.is_dir() and (t / "config.json").exists()]
for task in planned:
    if task in have:
        have.remove(task)
        continue
    t = job / f"{task}__again"
    t.mkdir()
    (t / "config.json").write_text(json.dumps({"task": {"path": f"/tasks/{task}"}}))
    (t / "result.json").write_text(json.dumps({"verifier_result": {"rewards": {"reward": 1.0}}, "exception_info": None}))
sys.exit(int(os.environ.get("FAKE_PIER_EXIT", "0")))
'''


def make_job(root: Path, *, jobs_dir: str | None = None, model: str = "moonshotai/kimi-k3", faux: bool = False) -> Path:
    job = root / "jobs" / "j1"
    job.mkdir(parents=True)
    kwargs = {"worker_model": "moonshotai/kimi-k2.7-code", **({"faux": "smoke"} if faux else {})}
    (job / "config.json").write_text(json.dumps({
        "job_name": "j1", "jobs_dir": jobs_dir or str(root / "jobs"), "n_attempts": 1,
        "datasets": [{"path": "/tasks", "task_names": ["a-pass", "b-timeout", "c-crash", "d-cut", "e-never", "f-fail"]}],
        "agents": [{"import_path": "decorum_pier:DecorumForum", "model_name": model, "kwargs": kwargs}],
    }))
    (job / "result.json").write_text(json.dumps({"started_at": "2026-10-28T09:00:00", "finished_at": "2026-10-28T10:00:00"}))

    def trial(task: str, result: dict | None) -> Path:
        t = job / f"{task}__x1"
        t.mkdir()
        (t / "config.json").write_text(json.dumps({"task": {"path": f"/tasks/{task}"}}))
        if result is not None:
            (t / "result.json").write_text(json.dumps(result))
        return t

    trial("a-pass", {"verifier_result": {"rewards": {"reward": 1.0}}, "exception_info": None})
    trial("b-timeout", {"verifier_result": {"rewards": {"reward": 0.0}},
                        "exception_info": {"exception_type": "AgentTimeoutError", "exception_message": "Agent execution timed out after 3000 seconds"}})
    trial("c-crash", {"verifier_result": None, "exception_info": {"exception_type": "RuntimeError", "exception_message": "docker compose\nfailed"}})
    trial("d-cut", None)
    trial("f-fail", {"verifier_result": {"rewards": {"reward": 0.0}}, "exception_info": None})
    old = time.time() - 3600
    for p in [job, *job.rglob("*")]:
        os.utime(p, (old, old))
    return job


@pytest.fixture
def fake_pier(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    pier = bin_dir / "pier"
    pier.write_text(FAKE_PIER.replace("#!/usr/bin/env python3", f"#!{sys.executable}"))
    pier.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    log = tmp_path / "pier.log"
    monkeypatch.setenv("FAKE_PIER_LOG", str(log))
    monkeypatch.delenv("MOONSHOT_API_KEY", raising=False)
    monkeypatch.delenv("DOCKER_DEFAULT_PLATFORM", raising=False)
    return log


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, **kw)


def test_failed_interrupted_and_unstarted_tasks_are_retried_but_graded_ones_never(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    rows = {r["task"]: r for r in rf.classify(job)}
    assert {t: r["state"] for t, r in rows.items()} == {
        "a-pass": "graded", "b-timeout": "graded, with an error", "c-crash": "failed", "d-cut": "interrupted",
        "e-never": "not started", "f-fail": "graded",
    }
    assert rows["b-timeout"]["reason"].startswith("AgentTimeoutError: Agent execution timed out")
    assert rows["c-crash"]["reason"] == "RuntimeError: docker compose failed"
    # a timeout the verifier still graded 0 is a result: retrying only the failures would raise the pass rate
    assert [r["task"] for r in rf.retryable(rf.classify(job))] == ["c-crash", "d-cut", "e-never"]
    assert [r["task"] for r in rf.retryable(rf.classify(job), graded_errors=True)] == ["b-timeout", "c-crash", "d-cut", "e-never"]


def test_a_timed_out_attempt_that_still_passed_is_kept(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    (job / "b-timeout__x1" / "result.json").write_text(json.dumps({
        "verifier_result": {"rewards": {"reward": 1.0}}, "exception_info": {"exception_type": "AgentTimeoutError", "exception_message": "t"}}))
    assert "b-timeout" not in [r["task"] for r in rf.retryable(rf.classify(job))]


def test_an_attempt_graded_by_regrade_is_graded_even_though_pier_recorded_an_error(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    (job / "c-crash__x1" / "regrade").mkdir()
    (job / "c-crash__x1" / "regrade" / "reward.json").write_text(json.dumps({"reward": 0}))
    assert "c-crash" not in [r["task"] for r in rf.retryable(rf.classify(job))]


def test_dry_run_lists_and_changes_nothing(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path)
    before = sorted(p.name for p in job.iterdir())
    p = run([str(job), "--dry-run"])
    assert p.returncode == 0, p.stderr
    assert "3 to retry" in p.stdout and "docker compose failed" in p.stdout and "pier job resume -p" in p.stdout
    assert "not retried: 1 graded after an error (b-timeout)" in p.stdout
    assert sorted(p.name for p in job.iterdir()) == before and not fake_pier.exists()


def test_retry_moves_the_failed_attempts_aside_and_resumes_with_the_keys(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path)
    env_file = tmp_path / ".env"
    env_file.write_text("# keys\nexport MOONSHOT_API_KEY='sk-test-123'\n")
    p = run([str(job), "--yes", "--graded-errors", "--env-file", str(env_file)])
    assert p.returncode == 0, p.stdout + p.stderr
    assert "sk-test-123" not in p.stdout + p.stderr  # the key is passed on, never printed
    call = json.loads(fake_pier.read_text())
    assert call["argv"][:3] == ["job", "resume", "-p"] and call["has_key"] and call["lock"]
    assert call["platform"] == "linux/amd64" and Path(call["cwd"]) == job.parent
    att = job / ".attempts"
    assert sorted(p.name for p in att.iterdir() if p.is_dir()) == ["b-timeout__x1", "c-crash__x1", "d-cut__x1"]
    log = [json.loads(line) for line in (att / "attempts.jsonl").read_text().splitlines()]
    assert [(r["task"], r["state"]) for r in log] == [("b-timeout", "graded, with an error"), ("c-crash", "failed"), ("d-cut", "interrupted"), ("e-never", "not started")]
    assert log[0]["moved_to"] == ".attempts/b-timeout__x1" and log[3]["moved_to"] is None
    assert not (att / "retry.lock").exists()
    states = {r["task"]: r["state"] for r in rf.classify(job)}
    assert set(states.values()) == {"graded"}  # every task has a graded attempt now
    assert "b-timeout: passed" in p.stdout and "e-never: passed" in p.stdout


def test_one_task_can_be_retried_and_a_graded_one_is_refused(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path, faux=True)
    p = run([str(job), "--yes", "--task", "f-fail"])
    assert p.returncode == 2 and "already graded" in p.stderr
    p = run([str(job), "--yes", "--task", "c-crash"])
    assert p.returncode == 0, p.stderr
    # Pier runs every task without a result on any resume: the interrupted attempt is kept, not deleted, and the
    # not-started task runs too, and the output says so
    assert sorted(x.name for x in (job / ".attempts").iterdir() if x.is_dir()) == ["c-crash__x1", "d-cut__x1"]
    assert "d-cut (runs on any resume)" in p.stdout and "e-never (runs on any resume)" in p.stdout
    assert (job / "b-timeout__x1").exists()  # graded after an error, not picked: left alone
    assert {r["task"]: r["state"] for r in rf.classify(job)}["b-timeout"] == "graded, with an error"


def test_a_graded_error_is_retried_when_named(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path, faux=True)
    p = run([str(job), "--yes", "--task", "b-timeout"])
    assert p.returncode == 0, p.stderr
    assert "b-timeout__x1" in [x.name for x in (job / ".attempts").iterdir()] and "b-timeout: passed" in p.stdout


def test_relative_jobs_dir_runs_pier_from_where_the_job_was_started(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path, jobs_dir="jobs", faux=True)
    p = run([str(job), "--yes"])
    assert p.returncode == 0, p.stderr
    call = json.loads(fake_pier.read_text())
    assert Path(call["cwd"]) == tmp_path and call["argv"][-1] == "jobs/j1"


def test_a_missing_key_or_a_running_job_stops_it_before_anything_moves(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path)
    p = run([str(job), "--yes", "--env-file", str(tmp_path / "none.env")])
    assert p.returncode == 2 and "MOONSHOT_API_KEY is not set" in p.stderr and not (job / ".attempts").exists()
    (job / "result.json").write_text(json.dumps({"started_at": "2026-10-28T09:00:00"}))  # no finish time, written now
    p = run([str(job), "--yes"])
    assert p.returncode == 3 and "still running" in p.stderr and not (job / ".attempts").exists()


def test_a_live_retry_lock_blocks_a_second_retry_and_a_stale_one_does_not(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    (job / ".attempts").mkdir()
    (job / ".attempts" / "retry.lock").write_text(json.dumps({"pid": os.getpid()}))
    assert rf.is_running(job)
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    (job / ".attempts" / "retry.lock").write_text(json.dumps({"pid": dead.pid}))
    assert not rf.is_running(job)


def test_without_yes_and_without_a_terminal_it_asks_for_yes(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path, faux=True)
    p = run([str(job)], stdin=subprocess.DEVNULL)
    assert p.returncode == 2 and "--yes" in p.stderr and not (job / ".attempts").exists()


def test_env_file_lines_are_read_like_dotenv(tmp_path: Path) -> None:
    f = tmp_path / ".env"
    f.write_text('A=1\nexport B="two words"\n# C=3\nD=x # note\nE=\'q\'\nF="sk-1" # the key\nnot a line\n')
    assert rf.read_env_file(f) == {"A": "1", "B": "two words", "D": "x", "E": "q", "F": "sk-1"}


def test_making_the_attempts_folder_does_not_make_a_stopped_job_look_running(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    (job / "result.json").write_text(json.dumps({"started_at": "2026-10-28T09:00:00"}))  # stopped: no finish time
    old = time.time() - 3600
    os.utime(job / "result.json", (old, old))
    os.utime(job, (old, old))
    assert not rf.is_running(job)
    (job / ".attempts").mkdir()  # what the viewer does before it starts the script
    assert not rf.is_running(job)


def test_the_lock_is_taken_once(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    assert rf.take_lock(job, ["c-crash"]) and not rf.take_lock(job, ["c-crash"])  # held by this live process
    (job / ".attempts" / "retry.lock").write_text(json.dumps({"pid": 2**22 + 12345}))  # a pid that is not running
    assert rf.take_lock(job, ["c-crash"])


def test_the_summary_names_what_to_retry_and_after_a_retry_counts_the_attempts(tmp_path: Path, fake_pier: Path) -> None:
    job = make_job(tmp_path, faux=True)
    summarize = HERE / "summarize.py"
    out = subprocess.run([sys.executable, str(summarize), str(job)], capture_output=True, text=True).stdout
    assert "3 task(s) have no graded attempt (1 failed, 1 interrupted, 1 not started)" in out and "retry_failed.py" in out
    dec = job / "b-timeout__x1" / "agent" / "decorum"
    dec.mkdir(parents=True)
    (dec / "summary.json").write_text(json.dumps({"cost_usd": 1.25}))
    assert run([str(job), "--yes", "--graded-errors"]).returncode == 0
    out = subprocess.run([sys.executable, str(summarize), str(job)], capture_output=True, text=True).stdout
    assert "attempts" in out.splitlines()[0] and "no graded attempt" not in out
    # e-never had no attempt to set aside: three tasks took a second attempt
    assert "3 task(s) were retried; their 3 earlier attempt(s) cost $1.25 more" in out
