"""The viewer's server against synthetic Pier job folders: what it lists, reads incrementally, and serves."""

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import forum_view as fv


def iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".000Z"


def make_trial(
    root: Path,
    job: str = "job1",
    task: str = "demo-task",
    agent: str = "decorum_pier:DecorumForum",
) -> Path:
    trial = root / job / f"{task}__abc"
    (trial / "agent" / "decorum" / "sessions" / "authority").mkdir(parents=True)
    tdir = root / "tasks" / task
    tdir.mkdir(parents=True)
    (tdir / "task.toml").write_text(
        'display_title = "Add the demo feature"\nlanguage = "python"\nrepository_url = "https://github.com/acme/demo"\n'
    )
    (tdir / "instruction.md").write_text("Please add the demo feature.")
    (trial / "config.json").write_text(
        json.dumps({"task": {"path": str(tdir)}, "agent": {"import_path": agent}})
    )
    return trial


def append(path: Path, *objs: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        for o in objs:
            f.write(json.dumps(o) + "\n")


def assistant(t: float, *calls: tuple[str, str, dict], cost: float = 0.01) -> dict:
    return {
        "type": "message",
        "timestamp": iso(t),
        "message": {
            "role": "assistant",
            "content": [
                {"type": "toolCall", "id": cid, "name": name, "arguments": args}
                for cid, name, args in calls
            ],
            "usage": {"cost": {"total": cost}},
        },
    }


def result(t: float, call_id: str, text: str, tool: str = "bash") -> dict:
    return {
        "type": "message",
        "timestamp": iso(t),
        "message": {
            "role": "toolResult",
            "toolCallId": call_id,
            "toolName": tool,
            "content": [{"type": "text", "text": text}],
        },
    }


@pytest.fixture
def jobs(tmp_path: Path) -> Path:
    return tmp_path


def test_a_running_trial_is_listed_with_its_task_title_and_read_incrementally(
    jobs: Path,
) -> None:
    trial = make_trial(jobs)
    dec = trial / "agent" / "decorum"
    t0 = time.time()
    append(
        dec / "sessions" / "authority" / "s.jsonl",
        {"type": "model_change", "provider": "moonshotai", "modelId": "kimi-k3"},
        assistant(t0, ("c1", "bash", {"command": "ls"})),
    )
    store = fv.Store([jobs])
    [ov] = store.scan()
    assert (ov["status"], ov["title"], ov["language"], ov["repository"]) == (
        "running",
        "Add the demo feature",
        "python",
        "acme/demo",
    )
    assert ov["threads"] == 0 and ov["cost_usd"] == pytest.approx(0.01)

    append(
        dec / "forum.jsonl",
        {
            "seq": 1,
            "at": iso(t0 + 1),
            "kind": "thread_opened",
            "thread": {
                "id": "T1",
                "title": "Plan",
                "goal": "R1",
                "owner": "authority",
                "participants": ["authority"],
            },
        },
        {
            "seq": 2,
            "at": iso(t0 + 2),
            "kind": "assigned",
            "assignment": {
                "id": "A1",
                "thread": "T1",
                "worker": "w1",
                "persona": "tester",
                "instructions": "do R1",
                "status": "working",
            },
        },
    )
    append(
        dec / "sessions" / "w1" / "w.jsonl",
        assistant(t0 + 3, ("c2", "wait", {"timeout_sec": 30})),
    )
    st = store.get("job1", trial.name)
    d = st.detail("job1", 0)
    assert [e["kind"] for e in d["events"]] == ["thread_opened", "assigned"]
    assert d["instruction"] == "Please add the demo feature."
    agents = {a["name"]: a for a in d["agents"]}
    assert agents["authority"]["model"] == "moonshotai/kimi-k3"
    assert (
        agents["w1"]["state"] == "waiting"
        and agents["w1"]["persona"] == "tester"
        and agents["w1"]["thread"] == "T1"
    )

    # only what is new comes back, and a finish moves the worker on
    append(
        dec / "forum.jsonl",
        {
            "seq": 3,
            "at": iso(t0 + 4),
            "kind": "finished",
            "assignment": {
                "id": "A1",
                "thread": "T1",
                "worker": "w1",
                "status": "finished",
                "summary": "done",
                "finishedAt": iso(t0 + 4),
            },
        },
    )
    append(
        dec / "sessions" / "w1" / "w.jsonl",
        result(t0 + 3.5, "c2", "[forum] ...", tool="wait"),
    )
    d2 = st.detail("job1", d["next"])
    assert [e["kind"] for e in d2["events"]] == ["finished"]
    assert {a["name"]: a["state"] for a in d2["agents"]}["w1"] == "finished"


def test_a_finished_trial_shows_its_reward_tests_and_a_grading_problem(
    jobs: Path,
) -> None:
    trial = make_trial(jobs)
    dec = trial / "agent" / "decorum"
    append(
        dec / "forum.jsonl",
        {
            "seq": 1,
            "at": iso(time.time()),
            "kind": "note",
            "agent": "runtime",
            "text": "x",
        },
    )
    (dec / "summary.json").write_text(
        json.dumps(
            {
                "cost_usd": 1.5,
                "duration_sec": 61,
                "end_reason": "authority_done",
                "mode": "forum",
                "rulebook": {"name": "base-0"},
                "models": {"authority": "a/b"},
            }
        )
    )
    (trial / "verifier").mkdir()
    (trial / "verifier" / "reward.json").write_text(
        json.dumps({"reward": 0, "f2p_passed": 23, "f2p_total": 24})
    )
    (trial / "result.json").write_text(
        json.dumps(
            {
                "task_name": "datacurve/demo-task",
                "exception_info": {
                    "exception_type": "RuntimeError",
                    "exception_message": "docker cp failed\n  on lchown",
                },
            }
        )
    )
    [ov] = fv.Store([jobs]).scan()
    assert ov["status"] == "finished"
    assert (ov["reward"], ov["graded_by"], ov["tests"]["f2p_passed"]) == (
        0.0,
        "pier",
        23,
    )
    assert ov["cost_usd"] == 1.5 and ov["rulebook"] == "base-0"
    assert ov["problem"].startswith(
        "Grading failed: RuntimeError: docker cp failed on lchown"
    )


def test_a_trial_that_failed_before_the_agents_ran_says_so(jobs: Path) -> None:
    trial = make_trial(jobs)
    shutil.rmtree(trial / "agent" / "decorum")
    (trial / "result.json").write_text(
        json.dumps(
            {
                "exception_info": {
                    "exception_type": "NonZeroAgentExitCodeError",
                    "exception_message": "decorum runtime failed: No credentials for provider moonshotai: set MOONSHOT_API_KEY",
                }
            }
        )
    )
    [ov] = fv.Store([jobs]).scan()
    assert ov["status"] == "failed"
    assert (
        "before the agents finished" in ov["problem"]
        and "MOONSHOT_API_KEY" in ov["problem"]
    )


def test_a_replaced_file_is_read_again_from_the_start(jobs: Path) -> None:
    trial = make_trial(jobs)
    fp = trial / "agent" / "decorum" / "forum.jsonl"
    append(
        fp,
        *[
            {
                "seq": i,
                "at": iso(time.time()),
                "kind": "note",
                "agent": "a",
                "text": "old",
            }
            for i in range(1, 4)
        ],
    )
    store = fv.Store([jobs])
    store.scan()
    st = store.get("job1", trial.name)
    assert len(st.detail("job1", 0)["events"]) == 3
    # replaced by a longer file with a new inode: a size check alone would miss it
    tmp = fp.with_suffix(".new")
    append(
        tmp,
        *[
            {
                "seq": i,
                "at": iso(time.time()),
                "kind": "note",
                "agent": "a",
                "text": "new, and longer",
            }
            for i in range(1, 5)
        ],
    )
    os.replace(tmp, fp)
    d = st.detail("job1", 0)
    assert d["epoch"] == 1
    assert [e["text"] for e in d["events"]] == ["new, and longer"] * 4


def test_a_silent_trial_is_stalled_and_other_agents_trials_are_ignored(
    jobs: Path,
) -> None:
    trial = make_trial(jobs)
    fp = trial / "agent" / "decorum" / "forum.jsonl"
    append(
        fp,
        {"seq": 1, "at": iso(time.time()), "kind": "note", "agent": "a", "text": "x"},
    )
    old = time.time() - fv.STALE_SEC - 60
    os.utime(fp, (old, old))
    other = jobs / "job2" / "x__1"
    other.mkdir(parents=True)
    (other / "config.json").write_text(
        json.dumps({"agent": {"name": "oracle", "import_path": None}})
    )
    trials = fv.Store([jobs]).scan()
    assert [(t["job"], t["status"]) for t in trials] == [("job1", "stalled")]


def test_the_http_api_and_the_page(jobs: Path) -> None:
    trial = make_trial(jobs)
    append(
        trial / "agent" / "decorum" / "forum.jsonl",
        {"seq": 1, "at": iso(time.time()), "kind": "note", "agent": "a", "text": "x"},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), fv.make_handler(fv.Store([jobs])))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        trials = json.load(urllib.request.urlopen(f"{base}/api/trials"))["trials"]
        assert trials[0]["trial"] == trial.name
        d = json.load(
            urllib.request.urlopen(
                f"{base}/api/trial?job=job1&trial={trial.name}&since=0"
            )
        )
        assert d["next"] == 1
        page = urllib.request.urlopen(f"{base}/").read().decode()
        assert "Decorum forum" in page and "app.js" in page
        for bad in (
            "/api/trial?job=nope&trial=x",
            "/../forum_view.py",
            "/static/../../forum_view.py",
        ):
            with pytest.raises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(base + bad)
            assert e.value.code == 404
    finally:
        server.shutdown()


def test_concurrent_requests_never_read_an_event_twice(jobs: Path) -> None:
    trial = make_trial(jobs)
    fp = trial / "agent" / "decorum" / "forum.jsonl"
    store = fv.Store([jobs])
    store.scan()
    stop = threading.Event()

    def writer() -> None:
        for i in range(1, 301):
            append(
                fp,
                {
                    "seq": i,
                    "at": iso(time.time()),
                    "kind": "note",
                    "agent": "a",
                    "text": f"n{i}",
                },
            )
        stop.set()

    def reader() -> None:
        while not stop.is_set():
            store.scan()
            store.detail("job1", trial.name, 0)

    threads = [
        threading.Thread(target=writer),
        *[threading.Thread(target=reader) for _ in range(8)],
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    d = store.detail("job1", trial.name, 0)
    assert [e["seq"] for e in d["events"]] == list(range(1, 301))


def test_a_swebench_pro_task_gets_its_title_and_repository_from_the_task(
    jobs: Path,
) -> None:
    tid = "instance_ansible__ansible-83fb24b923064d3576d473747ebbe62e4535c9e3-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5"
    tdir = jobs / "tasks" / tid
    tdir.mkdir(parents=True)
    (tdir / "task.toml").write_text("[agent]\ntimeout_sec = 3000.0\n")
    (tdir / "instruction.md").write_text(
        "A code repository is available in /app.\n\n<pr_description>\n## Title Support multiple destination ports in iptables rules\n\n## Description\n..."
    )
    trial = jobs / "job1" / f"{tid[:40]}__x"
    (trial / "agent" / "decorum").mkdir(parents=True)
    append(
        trial / "agent" / "decorum" / "forum.jsonl",
        {"seq": 1, "at": iso(time.time()), "kind": "note", "agent": "a", "text": "x"},
    )
    (trial / "config.json").write_text(
        json.dumps(
            {
                "task": {"path": str(tdir)},
                "agent": {"import_path": "decorum_pier:DecorumForum"},
            }
        )
    )
    [ov] = fv.Store([jobs]).scan()
    assert ov["title"] == "Support multiple destination ports in iptables rules"
    assert ov["repository"] == "ansible/ansible"
