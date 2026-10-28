"""The viewer's server against synthetic Pier job folders: what it lists, reads incrementally, and serves."""

from __future__ import annotations

import json
import os
import re
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
        assert "Forum Decorum" in page and "app.js" in page
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


def make_job(root: Path, job: str, dataset: str, tasks: list[str], **extra) -> Path:
    d = root / job
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text(
        json.dumps(
            {
                "datasets": [{"path": dataset, "task_names": tasks}],
                "agents": [
                    {
                        "import_path": "decorum_pier:DecorumForum",
                        "model_name": "moonshotai/kimi-k3",
                        "kwargs": {
                            "rulebook": "base-0",
                            "worker_model": "moonshotai/kimi-k2.7-code",
                        },
                    }
                ],
            }
        )
    )
    if extra:
        (d / "result.json").write_text(json.dumps(extra))
    return d


def finish(trial: Path, reward: float | None) -> None:
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
        json.dumps({"cost_usd": 0.5, "duration_sec": 30, "mode": "forum"})
    )
    if reward is not None:
        (trial / "verifier").mkdir()
        (trial / "verifier" / "reward.json").write_text(json.dumps({"reward": reward}))
    (trial / "result.json").write_text(
        json.dumps({"finished_at": "2026-10-27T10:00:00"})
    )


def test_trials_are_grouped_into_runs_with_benchmark_status_and_counts(
    jobs: Path,
) -> None:
    make_job(
        jobs,
        "deepswe-forum-base-0-1",
        "/x/.deep-swe/tasks",
        ["a-one", "a-two", "a-three"],
    )
    finish(make_trial(jobs, "deepswe-forum-base-0-1", "a-one"), 1.0)
    running = make_trial(jobs, "deepswe-forum-base-0-1", "a-two")
    append(
        running / "agent" / "decorum" / "forum.jsonl",
        {"seq": 1, "at": iso(time.time()), "kind": "note", "agent": "a", "text": "x"},
    )
    ids = ["instance_acme__x-1", "instance_acme__y-2"]
    make_job(
        jobs,
        "swebenchpro-forum-base-0-0",
        "/x/.swebench-pro/pier-tasks",
        ids,
        started_at="2026-10-26T09:00:00",
        finished_at="2026-10-26T10:00:00",
        stats={},
    )
    finish(make_trial(jobs, "swebenchpro-forum-base-0-0", ids[0]), 0.0)
    finish(make_trial(jobs, "swebenchpro-forum-base-0-0", ids[1]), 1.0)

    live, done = fv.Store([jobs]).runs()
    assert (live["job"], live["benchmark"], live["status"]) == (
        "deepswe-forum-base-0-1",
        "DeepSWE",
        "running",
    )
    assert (
        live["counts"]["passed"] == 1
        and live["counts"]["running"] == 1
        and live["pending"] == 1
    )
    assert (live["mode"], live["rulebook"], live["worker_model"]) == (
        "forum",
        "base-0",
        "moonshotai/kimi-k2.7-code",
    )
    assert [t["status"] for t in live["trials"]] == ["running", "finished"]
    assert (done["benchmark"], done["status"], done["pending"]) == (
        "SWE-bench Pro",
        "finished",
        0,
    )
    assert done["counts"] == {
        "running": 0,
        "passed": 1,
        "not_passed": 1,
        "ungraded": 0,
        "failed": 0,
    }
    assert done["cost_usd"] == 1.0 and done["name"] is None


def test_a_crashed_run_is_stopped_not_running_forever(jobs: Path) -> None:
    job = make_job(jobs, "j", "/x/deep-swe/tasks", ["a-one", "a-two"])
    finish(make_trial(jobs, "j", "a-one"), 1.0)
    old = time.time() - 3 * 3600
    for p in job.rglob("*"):
        os.utime(p, (old, old))
    os.utime(job, (old, old))
    [run] = fv.Store([jobs]).runs()
    assert (run["status"], run["pending"]) == ("stopped", 1)


def test_a_run_is_renamed_through_the_api_and_the_name_is_kept_beside_the_jobs(
    jobs: Path,
) -> None:
    make_job(jobs, "j1", "/x/deep-swe/tasks", ["a-one"])
    finish(make_trial(jobs, "j1", "a-one"), 1.0)
    server = ThreadingHTTPServer(("127.0.0.1", 0), fv.make_handler(fv.Store([jobs])))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def post(body: object, headers: dict | None = None) -> tuple[int, dict]:
        h = (
            {"Content-Type": "application/json", "X-Decorum-Viewer": "1"}
            if headers is None
            else headers
        )
        req = urllib.request.Request(
            f"{base}/api/runs/rename",
            data=json.dumps(body).encode(),
            headers=h,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    try:
        assert post({"job": "j1", "name": "  Kimi baseline\n run 1 "}) == (
            200,
            {"job": "j1", "name": "Kimi baseline run 1"},
        )
        assert json.loads((jobs / fv.NAMES_FILE).read_text())["names"] == {
            "j1": "Kimi baseline run 1"
        }
        [run] = json.load(urllib.request.urlopen(f"{base}/api/runs"))["runs"]
        assert run["name"] == "Kimi baseline run 1"
        assert (
            fv.Store([jobs]).runs()[0]["name"] == "Kimi baseline run 1"
        )  # survives a restart
        assert post({"job": "j1", "name": "x" * 81})[0] == 400
        assert post({"job": "j1", "name": 5})[0] == 400
        assert post({"job": "nope", "name": "x"})[0] == 404
        assert (
            post({"job": "j1", "name": "x"}, {"Content-Type": "application/json"})[0]
            == 403
        )
        assert (
            post(
                {"job": "j1", "name": "x"},
                {"X-Decorum-Viewer": "1", "Content-Type": "text/plain"},
            )[0]
            == 403
        )
        assert post({"job": "j1", "name": ""}) == (200, {"job": "j1", "name": None})
        assert json.loads((jobs / fv.NAMES_FILE).read_text())["names"] == {}
        assert (
            json.load(urllib.request.urlopen(f"{base}/api/runs"))["runs"][0]["name"]
            is None
        )
    finally:
        server.shutdown()


# ---------- team analysis, insights, search ----------


def forum_events(trial: Path, at: float) -> None:
    """A small forum: a plan, two workers (an implementer and a reviewer), a mention, a send-back, a refusal."""
    f = trial / "agent" / "decorum" / "forum.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("")
    seq = iter(range(1, 100))

    def ev(kind: str, t: float, **kw) -> dict:
        return {"seq": next(seq), "at": iso(at + t), "kind": kind, **kw}

    append(
        f,
        ev("thread_opened", 1, thread={"id": "T1", "title": "Plan", "goal": "R1..R3"}),
        ev(
            "thread_opened",
            2,
            thread={"id": "T2", "title": "Core change", "goal": "Implement R1"},
        ),
        ev(
            "assigned",
            3,
            assignment={
                "worker": "core",
                "thread": "T2",
                "persona": "A careful Python engineer",
            },
        ),
        ev(
            "thread_opened",
            4,
            thread={"id": "T3", "title": "Final review", "goal": "Check the diff"},
        ),
        ev(
            "assigned",
            5,
            assignment={
                "worker": "rev",
                "thread": "T3",
                "persona": "A reviewer with no prior context",
            },
        ),
        ev(
            "post",
            6,
            post={
                "thread": "T2",
                "author": "core",
                "text": "Added the async variant of fetch()",
                "mentions": ["rev"],
            },
        ),
        ev(
            "finished",
            7,
            assignment={
                "worker": "core",
                "thread": "T2",
                "summary": "R1 done; pytest -q passed",
            },
        ),
        ev(
            "post",
            8,
            post={
                "thread": "T2",
                "author": "authority",
                "text": "R1 misses the sync variant",
                "mentions": ["core"],
            },
        ),
        ev(
            "finished",
            9,
            assignment={
                "worker": "core",
                "thread": "T2",
                "summary": "Sync variant added too",
            },
        ),
        ev(
            "refusal",
            10,
            agent="authority",
            tool="edit",
            rule="authority",
            reason="managers do not edit",
        ),
        ev("thread_closed", 11, thread={"id": "T3"}),
    )


def test_roles_and_thread_topics_are_read_from_personas_and_titles() -> None:
    assert fv.role_of("A reviewer with no prior context", "") == "reviewer"
    assert (
        fv.role_of("QA engineer", "") == "tester"
        and fv.role_of("", "tests") == "tester"
    )
    assert fv.role_of("An investigator who maps the code", "") == "investigator"
    assert fv.role_of("A careful Go engineer", "core change") == "implementer"
    assert fv.kind_of("Plan") == "plan" and fv.kind_of("Final review") == "review"
    assert (
        fv.kind_of("README and examples") == "implementation"
    )  # docs count as implementation
    assert (
        fv.kind_of("Core", "write the failing test first") == "tests"
    )  # the goal decides when the title does not


def test_a_runs_team_analysis_names_each_worker_the_threads_and_the_send_backs(
    jobs: Path,
) -> None:
    make_job(jobs, "j", "/x/deep-swe/tasks", ["a-one"])
    trial = make_trial(jobs, "j", "a-one")
    forum_events(trial, time.time() - 100)
    (trial / "agent" / "decorum" / "summary.json").write_text(
        json.dumps(
            {
                "rulebook": {
                    "name": "base-0",
                    "budget": {"min_workers_total": 3, "max_workers_total": 6},
                },
                "models": {"authority": "a/k3", "worker": "a/k2"},
                "commit_policy": "leave",
            }
        )
    )
    d = fv.Store([jobs]).teams("j")
    assert (
        d["setup"]["rulebook"]["budget"]["max_workers_total"] == 6
        and d["setup"]["commit_policy"] == "leave"
    )
    [t] = d["tasks"]
    assert [(w["worker"], w["role"], w["sent_back"]) for w in t["team"]] == [
        ("core", "implementer", 1),
        ("rev", "reviewer", 0),
    ]
    assert (
        t["threads"],
        t["posts_authority"],
        t["posts_workers"],
        t["sent_back"],
        t["refusals"],
    ) == (3, 1, 1, 1, 1)
    assert [
        (th["title"], th["kind"], th["posts"], th["sent_back"])
        for th in t["thread_list"]
    ] == [
        ("Plan", "plan", 0, 0),
        ("Core change", "implementation", 2, 1),
        ("Final review", "review", 0, 0),
    ]
    assert (
        t["thread_list"][2]["closed_at"]
        and {"from": "core", "to": "rev", "n": 1} in t["mentions"]
    )
    assert fv.Store([jobs]).teams("nope") is None


def test_insights_cover_the_chosen_runs_and_search_finds_posts_and_finish_reports(
    jobs: Path,
) -> None:
    for job, task in (("j1", "a-one"), ("j2", "b-two")):
        make_job(jobs, job, "/x/deep-swe/tasks", [task])
        forum_events(make_trial(jobs, job, task), time.time() - 100)
    store = fv.Store([jobs])
    assert sorted(r["run"]["job"] for r in store.insights(None)["runs"]) == ["j1", "j2"]
    assert [r["run"]["job"] for r in store.insights(["j2"])["runs"]] == ["j2"]
    hits = store.search(
        "SYNC variant", None
    )  # words match inside words too: "sync" finds "async"
    assert hits["total"] == 6 and {h["kind"] for h in hits["hits"]} == {
        "post",
        "finish report",
    }
    assert {h["role"] for h in hits["hits"]} == {"authority", "implementer"}
    assert (
        store.search("variant too", ["j1"])["total"] == 1
        and store.search("   ", None)["hits"] == []
    )
    assert (
        store.search("async nothing-like-this", None)["total"] == 0
    )  # every word must match


# ---------- retrying failed tasks ----------


def failed_attempt(trial: Path, kind: str = "AgentTimeoutError") -> None:
    (trial / "result.json").write_text(
        json.dumps(
            {
                "exception_info": {
                    "exception_type": kind,
                    "exception_message": "timed out after 3000 s",
                }
            }
        )
    )
    append(
        trial / "agent" / "decorum" / "forum.jsonl",
        {
            "seq": 1,
            "at": iso(time.time() - 4000),
            "kind": "note",
            "agent": "runtime",
            "text": "x",
        },
    )
    old = time.time() - 4000
    for p in [trial, *trial.rglob("*")]:
        os.utime(p, (old, old))


def retry_job(jobs: Path) -> Path:
    job = make_job(
        jobs,
        "j",
        "/x/deep-swe/tasks",
        ["a-one", "b-two", "c-three"],
        started_at="2026-10-28T09:00:00",
        finished_at="2026-10-28T10:00:00",
        stats={},
    )
    finish(make_trial(jobs, "j", "a-one"), 1.0)
    failed_attempt(make_trial(jobs, "j", "b-two"))
    old = time.time() - 4000
    for p in [job, *job.rglob("*")]:
        os.utime(p, (old, old))
    return job


def test_a_run_lists_what_retry_would_run_again(jobs: Path) -> None:
    retry_job(jobs)
    [run] = fv.Store([jobs]).runs()
    assert run["status"] == "stopped" and run["earlier"] == []
    assert [(t["task"], t["state"]) for t in run["retry"]["tasks"]] == [
        ("b-two", "failed"),
        ("c-three", "not started"),
    ]
    assert (
        run["retry"]["tasks"][0]["reason"].startswith("AgentTimeoutError")
        and not run["retry"]["in_progress"]
    )


def test_an_attempt_moved_aside_is_an_earlier_attempt_not_a_trial_of_the_run(
    jobs: Path,
) -> None:
    job = retry_job(jobs)
    (job / ".attempts").mkdir()
    (job / "b-two__abc").rename(job / ".attempts" / "b-two__abc")
    (job / ".attempts" / "attempts.jsonl").write_text(
        json.dumps(
            {
                "at": "2026-10-28T10:05:00+00:00",
                "task": "b-two",
                "state": "failed",
                "reason": "AgentTimeoutError: timed out",
                "moved_to": ".attempts/b-two__abc",
            }
        )
        + "\n"
    )
    t2 = job / "b-two__new"
    t2.mkdir()
    (t2 / "config.json").write_text(
        (job / ".attempts" / "b-two__abc" / "config.json").read_text()
    )
    finish(t2, 1.0)
    store = fv.Store([jobs])
    [run] = store.runs()
    assert sorted(t["trial"] for t in run["trials"]) == ["a-one__abc", "b-two__new"]
    assert run["counts"]["passed"] == 2 and run["counts"]["failed"] == 0
    [e] = run["earlier"]
    assert (e["trial"], e["task"], e["reason"], e["superseded"]) == (
        "b-two__abc",
        "b-two",
        "AgentTimeoutError: timed out",
        True,
    )
    assert sorted(t["trial"] for t in store.scan()) == ["a-one__abc", "b-two__new"]
    assert (
        store.detail("j", "b-two__abc", 0)["next"] == 1
    )  # the earlier attempt can still be opened


def test_the_retry_endpoint_checks_everything_then_starts_the_script(
    jobs: Path,
) -> None:
    retry_job(jobs)
    store = fv.Store([jobs])
    started = []

    class Proc:
        def poll(self):
            return None

    store.launch = lambda job, tasks: (
        started.append((job.name, tasks)) or Proc(),
        ".attempts/retry-x.log",
    )
    store.launch_grace = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), fv.make_handler(store))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def post(body: object, headers: dict | None = None) -> tuple[int, dict]:
        h = (
            {"Content-Type": "application/json", "X-Decorum-Viewer": "1"}
            if headers is None
            else headers
        )
        req = urllib.request.Request(
            f"{base}/api/runs/retry",
            data=json.dumps(body).encode(),
            headers=h,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    try:
        assert (
            post({"job": "j"}, {"Content-Type": "application/json"})[0] == 403
        )  # no page header
        assert post({"job": "nope"})[0] == 404
        assert post({"job": "j", "tasks": ["a-one"]}) == (
            400,
            {"error": "already graded, not retried: a-one"},
        )
        assert post({"job": "j", "tasks": "b-two"})[0] == 400
        assert post(["j"])[0] == 400
        assert started == []
        assert post({"job": "j", "tasks": ["b-two"]}) == (
            200,
            {"job": "j", "tasks": ["b-two", "c-three"], "log": ".attempts/retry-x.log"},
        )
        assert started == [("j", ["b-two"])]
        (jobs / "j" / ".attempts").mkdir(exist_ok=True)
        (jobs / "j" / ".attempts" / "retry-20261028T100000Z.log").write_text(
            "job j: 3 tasks\n" + "line\n" * 100 + "the end\n"
        )
        tail = json.load(urllib.request.urlopen(f"{base}/api/runs/retry-log?job=j"))
        assert (
            tail["log"] == ".attempts/retry-20261028T100000Z.log"
            and tail["text"].endswith("the end")
            and "job j" not in tail["text"]
        )
        [run] = json.load(urllib.request.urlopen(f"{base}/api/runs"))["runs"]
        assert run["status"] == "running" and run["retry"]["in_progress"]
        assert post({"job": "j"})[0] == 409  # one retry at a time
        store.retry_enabled = False
        assert post({"job": "j"})[0] == 403
        assert (
            json.load(urllib.request.urlopen(f"{base}/api/runs"))["runs"][0]["retry"]
            is None
        )
    finally:
        server.shutdown()


def test_a_graded_run_has_nothing_to_retry(jobs: Path) -> None:
    make_job(
        jobs,
        "j",
        "/x/deep-swe/tasks",
        ["a-one"],
        started_at="2026-10-28T09:00:00",
        finished_at="2026-10-28T10:00:00",
        stats={},
    )
    finish(make_trial(jobs, "j", "a-one"), 0.0)
    store = fv.Store([jobs])
    assert store.runs()[0]["retry"]["tasks"] == []
    with pytest.raises(ValueError, match="nothing to retry"):
        store.retry("j", None)


def test_the_real_launcher_runs_the_script_detached_and_logs_beside_the_attempts(
    tmp_path: Path,
) -> None:
    job = tmp_path / "j"
    job.mkdir()
    proc, log = fv.launch_retry(job, ["x"])
    assert (
        proc.wait(timeout=30) == 2
    )  # no config.json: the script refuses, and says so in the log
    assert (
        log.startswith(".attempts/retry-")
        and "has no config.json" in (job / log).read_text()
    )


def test_the_retry_list_marks_what_runs_by_default_and_what_always_runs(
    jobs: Path,
) -> None:
    retry_job(jobs)
    t = make_trial(jobs, "j", "d-four")
    (t / "result.json").write_text(
        json.dumps(
            {
                "verifier_result": {"rewards": {"reward": 0.0}},
                "exception_info": {
                    "exception_type": "AgentTimeoutError",
                    "exception_message": "timed out",
                },
            }
        )
    )
    cfg = json.loads((jobs / "j" / "config.json").read_text())
    cfg["datasets"][0]["task_names"].append("d-four")
    (jobs / "j" / "config.json").write_text(json.dumps(cfg))
    old = time.time() - 4000
    for p in [jobs / "j", *(jobs / "j").rglob("*")]:
        os.utime(p, (old, old))
    [run] = fv.Store([jobs]).runs()
    rows = {
        x["task"]: (x["state"], x["default"], x["always"])
        for x in run["retry"]["tasks"]
    }
    assert rows == {
        "b-two": ("failed", True, False),
        "c-three": ("not started", True, True),
        "d-four": ("graded, with an error", False, False),
    }


def test_a_retry_that_refuses_at_once_says_why(jobs: Path) -> None:
    job = retry_job(jobs)
    store = fv.Store([jobs])

    class Done:
        def poll(self):
            return 2

    def launch(found: Path, tasks: list[str] | None) -> tuple[Done, str]:
        (found / ".attempts").mkdir(exist_ok=True)
        (found / ".attempts" / "retry-x.log").write_text(
            "job j: 3 tasks\nretry_failed: MOONSHOT_API_KEY is not set; put it in base_forum/.env\n"
        )
        return Done(), ".attempts/retry-x.log"

    store.launch = launch
    with pytest.raises(
        RuntimeError, match="stopped at once: retry_failed: MOONSHOT_API_KEY is not set"
    ):
        store.retry("j", None)
    # making .attempts/ did not make the stopped run look like it is running
    assert store.runs()[0]["status"] == "stopped" and not fv.retry_failed.is_running(
        job
    )


def test_requests_under_another_host_name_are_refused(jobs: Path) -> None:
    retry_job(jobs)
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), fv.make_handler(fv.Store([jobs]), ("trex.example.ts.net",))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        for host, code in (
            (f"evil.example:{port}", 421),
            (f"localhost:{port}", 200),
            ("trex.example.ts.net", 200),
        ):
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/runs", headers={"Host": host}
            )
            try:
                got = urllib.request.urlopen(req).status
            except urllib.error.HTTPError as e:
                got = e.code
            assert got == code, host
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/runs/retry",
            data=b'{"job":"j"}',
            method="POST",
            headers={
                "Host": "evil.example",
                "Content-Type": "application/json",
                "X-Decorum-Viewer": "1",
            },
        )
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req)
        assert e.value.code == 421
    finally:
        server.shutdown()


# ---------- starting a run ----------


def start_body(**kw) -> dict:
    body = {
        "benchmark": "swebenchpro",
        "tasks": [
            "instance_ansible__ansible-83fb24b923064d3576d473747ebbe62e4535c9e3-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5",
            "instance_ansible__ansible-12734fa21c08a0ce8c84e533abdc560db2eb1955-v7eee2454f617569fd6889f2211f75bc02a35f9f8",
        ],
        "mode": "forum",
        "scripted": True,
        "authority_model": "moonshotai/kimi-k3",
        "authority_thinking": "max",
        "worker_model": "moonshotai/kimi-k2.7-code",
        "worker_thinking": "high",
        "min_workers": 2,
        "max_workers": 5,
        "max_live_workers": 3,
        "concurrency": 2,
        "retries": 1,
        "budget_usd": 7,
        "name": "Pro smoke from the page",
    }
    body.update(kw)
    return body


class Running:
    def poll(self):
        return None


def starter(jobs: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[fv.Store, list]:
    monkeypatch.setattr(fv, "RUN_LISTS", jobs / "runlists")
    store = fv.Store([jobs])
    store.launch_grace = 0
    calls: list = []

    def launch(env: dict, log: Path) -> Running:
        calls.append((env, log))
        log.write_text("job …\n")
        return Running()

    store.start_launch = launch
    return store, calls


def test_the_catalog_has_both_benchmarks_with_their_saved_lists(jobs: Path) -> None:
    d = fv.Store([jobs]).catalog()
    assert d["start"] is True
    pro, ds = d["benchmarks"]["swebenchpro"], d["benchmarks"]["deepswe"]
    assert (len(pro["tasks"]), len(ds["tasks"])) == (642, 113)
    assert [(p["name"], len(p["ids"])) for p in pro["presets"]] == [
        ("Collaborator's 10", 10),
        ("HARD-51", 51),
    ]
    assert [(p["name"], len(p["ids"])) for p in ds["presets"]] == [("Baseline 10", 10)]


def test_a_run_started_from_the_page_writes_its_tasks_and_hands_run_baseline_its_settings(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, calls = starter(jobs, monkeypatch)
    r = store.start(start_body())
    assert r["tasks"] == 2 and r["job"].startswith("pro-smoke-from-the-page-")
    [(env, log)] = calls
    assert {
        k: env[k]
        for k in (
            "BENCHMARK",
            "MODE",
            "AUTHORITY_MODEL",
            "AUTHORITY_THINKING",
            "WORKER_MODEL",
            "WORKER_THINKING",
            "MIN_WORKERS",
            "MAX_WORKERS",
            "MAX_LIVE_WORKERS",
            "CONCURRENCY",
            "RETRIES",
            "BUDGET_USD",
            "FAUX",
        )
    } == {
        "BENCHMARK": "swebenchpro",
        "MODE": "forum",
        "AUTHORITY_MODEL": "moonshotai/kimi-k3",
        "AUTHORITY_THINKING": "max",
        "WORKER_MODEL": "moonshotai/kimi-k2.7-code",
        "WORKER_THINKING": "high",
        "MIN_WORKERS": "2",
        "MAX_WORKERS": "5",
        "MAX_LIVE_WORKERS": "3",
        "CONCURRENCY": "2",
        "RETRIES": "1",
        "BUDGET_USD": "7",
        "FAUX": "smoke",
    }
    assert env["JOB_NAME"] == r["job"] and env["JOBS_DIR"] == str(jobs)
    assert Path(env["TASKS"]).read_text().splitlines() == [
        "task",
        *start_body()["tasks"],
    ]
    assert log.parent == jobs / ".decorum-start"
    # it is listed at once, named, before Pier has made its folder
    [run] = store.runs()
    assert (
        run["job"],
        run["status"],
        run["name"],
        run["benchmark"],
        run["planned"],
        run["faux"],
    ) == (r["job"], "starting", "Pro smoke from the page", "SWE-bench Pro", 2, True)
    assert run["task_ids"] == start_body()["tasks"]


def test_a_single_agent_run_sends_no_worker_settings(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, calls = starter(jobs, monkeypatch)
    store.start(start_body(mode="single", worker_model=None, name=""))
    env = calls[0][0]
    assert env["MODE"] == "single" and not {
        "WORKER_MODEL",
        "MIN_WORKERS",
        "MAX_WORKERS",
    } & set(env)
    assert calls[0][0]["JOB_NAME"].startswith("swebenchpro-single-")


@pytest.mark.parametrize(
    "change, message",
    [
        ({"benchmark": "swe-bench"}, "benchmark must be one of"),
        ({"tasks": []}, "non-empty list"),
        ({"tasks": ["instance_nope"]}, "not in SWE-bench Pro: instance_nope"),
        ({"authority_model": "kimi; rm -rf /"}, "must look like provider/model"),
        ({"worker_model": None}, "worker_model in forum mode"),
        ({"authority_thinking": "huge"}, "authority_thinking must be one of"),
        (
            {"min_workers": 6, "max_workers": 3},
            "min_workers (6) is more than max_workers (3)",
        ),
        ({"max_workers": 9}, "max_workers must be a whole number from 1 to 8"),
        ({"concurrency": "3"}, "concurrency must be a whole number"),
        ({"budget_usd": 0}, "budget_usd must be from 1 to 1000"),
        ({"mode": "swarm"}, "mode must be forum or single"),
        ({"name": "x" * 81}, "at most 80 characters"),
    ],
)
def test_a_bad_request_is_refused_before_anything_is_written(
    jobs: Path, monkeypatch: pytest.MonkeyPatch, change: dict, message: str
) -> None:
    store, calls = starter(jobs, monkeypatch)
    with pytest.raises(ValueError, match=re.escape(message)):
        store.start(start_body(**change))
    assert calls == [] and not (jobs / "runlists").exists()


def test_real_models_need_their_key_in_base_forum_env(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, calls = starter(jobs, monkeypatch)
    monkeypatch.setattr(fv, "HERE", jobs / "base" / "viewer")
    monkeypatch.setenv(
        "MOONSHOT_API_KEY", "sk-test"
    )  # in the viewer's shell only: run_baseline.sh reads .env
    with pytest.raises(ValueError, match="MOONSHOT_API_KEY is not set"):
        store.start(start_body(scripted=False))
    (jobs / "base").mkdir(exist_ok=True)
    (jobs / "base" / ".env").write_text("MOONSHOT_API_KEY=sk-test\n")
    assert (
        store.start(start_body(scripted=False))["tasks"] == 2
        and "FAUX" not in calls[0][0]
    )


def test_a_start_refused_at_once_says_why_and_leaves_nothing_behind(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, _ = starter(jobs, monkeypatch)

    class Failed:
        def poll(self):
            return 2

    def launch(env: dict, log: Path) -> Failed:
        log.write_text("run_baseline: Docker is not running\n")
        return Failed()

    store.start_launch = launch
    with pytest.raises(
        RuntimeError, match="the run did not start: run_baseline: Docker is not running"
    ):
        store.start(start_body())
    assert store.runs() == [] and list((jobs / "runlists").iterdir()) == []
    assert json.loads((jobs / fv.NAMES_FILE).read_text())["names"] == {}


def test_a_run_that_stops_after_starting_shows_why(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, _ = starter(jobs, monkeypatch)
    state = {"code": None}

    class Later:
        def poll(self):
            return state["code"]

    def launch(env: dict, log: Path) -> Later:
        log.write_text("cloning…\nrun_baseline: could not prepare the tasks\n")
        return Later()

    store.start_launch = launch
    store.start(start_body())
    assert store.runs()[0]["status"] == "starting"
    state["code"] = 2
    [run] = store.runs()
    assert run["status"] == "stopped" and run["problem"].endswith(
        "run_baseline: could not prepare the tasks"
    )


def test_model_ids_are_matched_whole_and_in_ascii(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, calls = starter(jobs, monkeypatch)
    for bad in (
        "moonshotai/kimi-k3\n",
        "moonshotai/kimi-ｋ３",
        "kimi-k3",
        "/kimi",
        "moonshotai/kimi k3",
    ):
        with pytest.raises(ValueError, match="must look like provider/model"):
            store.start(start_body(authority_model=bad))
    store.start(start_body(authority_model="openrouter/moonshotai/kimi-k3"))
    assert calls[-1][0]["AUTHORITY_MODEL"] == "openrouter/moonshotai/kimi-k3"


def test_the_runs_settings_are_its_own_not_the_shells(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = {}

    class Popen:
        def __init__(self, argv, env, **kw):
            seen.update(env=env, argv=argv)

    monkeypatch.setattr(fv.subprocess, "Popen", Popen)
    for k, v in (
        ("N_TASKS", "1"),
        ("RULEBOOK", "other"),
        ("DRY_RUN", "1"),
        ("FAUX", "smoke"),
        ("PATH", "/usr/bin"),
    ):
        monkeypatch.setenv(k, v)
    fv.launch_run({"BENCHMARK": "deepswe", "JOB_NAME": "j"}, jobs / "log")
    env = seen["env"]
    assert env["BENCHMARK"] == "deepswe" and env["PATH"] == "/usr/bin"
    assert not {"N_TASKS", "RULEBOOK", "DRY_RUN", "FAUX"} & set(env)
    assert seen["argv"][0] == "bash" and seen["argv"][1].endswith("run_baseline.sh")


def test_paid_actions_are_off_when_the_page_is_served_beyond_this_computer(
    jobs: Path,
) -> None:
    import argparse

    def args(**kw):
        base = {
            "allow_host": [],
            "allow_start": False,
            "allow_retry": False,
            "no_start": False,
            "no_retry": False,
        }
        return argparse.Namespace(**{**base, **kw})

    cases = (
        ({}, True, True),
        ({"allow_host": ["trex.example"]}, False, False),
        (
            {"allow_host": ["trex.example"], "allow_start": True, "allow_retry": True},
            True,
            True,
        ),
        ({"no_start": True}, False, True),
    )
    for kw, start, retry in cases:
        store = fv.Store([jobs])
        fv.paid_actions(store, args(**kw))
        assert (store.start_enabled, store.retry_enabled) == (start, retry), kw


def test_the_start_endpoint_needs_the_page_header_and_can_be_switched_off(
    jobs: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, _ = starter(jobs, monkeypatch)
    server = ThreadingHTTPServer(("127.0.0.1", 0), fv.make_handler(store))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def post(body: object, headers: dict | None = None) -> tuple[int, dict]:
        h = (
            {"Content-Type": "application/json", "X-Decorum-Viewer": "1"}
            if headers is None
            else headers
        )
        req = urllib.request.Request(
            f"{base}/api/runs/start",
            data=json.dumps(body).encode(),
            headers=h,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    try:
        assert post(start_body(), {"Content-Type": "application/json"})[0] == 403
        big = start_body(
            tasks=[
                t["id"] for t in store.catalog()["benchmarks"]["swebenchpro"]["tasks"]
            ]
        )  # all 642: about 70 KB
        code, body = post(big)
        assert code == 200 and body["tasks"] == 642, body
        assert post(start_body(budget_usd=0))[0] == 400
        store.start_enabled = False
        assert post(start_body())[0] == 403
        assert (
            json.load(urllib.request.urlopen(f"{base}/api/catalog"))["start"] is False
        )
    finally:
        server.shutdown()
