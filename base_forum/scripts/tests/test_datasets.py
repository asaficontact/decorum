"""Named datasets and setups: saved once under a name, hashed by content, resolved for run_baseline.sh."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import datasets as D  # noqa: E402

SCRIPT = Path(D.__file__)


def test_a_dataset_is_saved_once_hashed_by_its_content_and_loaded_back(tmp_path: Path) -> None:
    ds = D.save_dataset("Collaborator’s 10", "swebenchpro", ["b", "a", "b"], "the ten", "picked", d=tmp_path)
    assert ds["slug"] == "collaborators-10" and ds["tasks"] == ["b", "a"], "an apostrophe is dropped; repeats are dropped, order kept"
    assert ds["hash"] == D.content_hash("swebenchpro", ["b", "a"]) != D.content_hash("swebenchpro", ["a", "b"])
    assert D.ref_of(ds) == f"collaborators-10@{ds['hash']}"
    [back] = D.load_datasets(tmp_path)
    assert (back["name"], back["hash"], back["description"], back["how"]) == ("Collaborator’s 10", ds["hash"], "the ten", "picked")
    with pytest.raises(D.DatasetError, match="already exists"):
        D.save_dataset("collaborator’s 10", "swebenchpro", ["c"], d=tmp_path)
    for bad, msg in ((("", "swebenchpro", ["a"]), "needs a name"), (("x", "mmlu", ["a"]), "benchmark must be"), (("x", "deepswe", []), "non-empty"), (("!!!", "deepswe", ["a"]), "letter or digit")):
        with pytest.raises(D.DatasetError, match=msg):
            D.save_dataset(*bad, d=tmp_path)
    assert D.split_ref("hard-51@abc") == ("hard-51", "abc") and D.split_ref("hard-51") is None


def test_the_committed_datasets_are_valid_and_cover_the_old_saved_lists() -> None:
    by = {d["slug"]: d for d in D.load_datasets()}
    assert {"collaborators-10", "baseline-10", "hard-51", "ansible-smoke"} <= set(by)
    assert (by["collaborators-10"]["benchmark"], len(by["collaborators-10"]["tasks"])) == ("swebenchpro", 10)
    assert (by["hard-51"]["benchmark"], len(by["hard-51"]["tasks"])) == ("swebenchpro", 51)
    assert (by["baseline-10"]["benchmark"], len(by["baseline-10"]["tasks"])) == ("deepswe", 10)


def test_resolve_writes_the_task_list_run_baseline_reads(tmp_path: Path) -> None:
    out = tmp_path / "list.tsv"
    r = subprocess.run([sys.executable, str(SCRIPT), "resolve", "collaborators-10", "--tasks-out", str(out)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    bench, ref = r.stdout.strip().split("\t")
    assert bench == "swebenchpro" and ref.startswith("collaborators-10@")
    lines = out.read_text().splitlines()
    assert lines[0] == "task" and len(lines) == 11
    missing = subprocess.run([sys.executable, str(SCRIPT), "resolve", "nope", "--tasks-out", str(out)], capture_output=True, text=True)
    assert missing.returncode == 2 and "no dataset 'nope'" in missing.stderr


def test_a_runs_tasks_are_read_from_its_pier_job(tmp_path: Path) -> None:
    job = tmp_path / "job"
    job.mkdir()
    ids = ["instance_a__b-1", "instance_c__d-2"]
    (job / "config.json").write_text(json.dumps({"datasets": [{"path": "/x/.swebench-pro/pier-tasks", "task_names": ids}], "tasks": []}))
    assert D.tasks_of_job(job) == ("swebenchpro", ids)


def test_a_setup_is_checked_like_a_new_run(tmp_path: Path) -> None:
    team = {"mode": "vote", "authority": "moonshotai/kimi-k2.7-code", "athink": "high", "worker": "moonshotai/kimi-k2.7-code", "wthink": "high", "min": 3, "max": 6, "live": 5, "n": 5, "extra": "dropped"}
    s = D.save_setup("K2.7 vote", team, {"concurrency": 2, "budget": 10, "retries": 0}, d=tmp_path)
    assert s["slug"] == "k2-7-vote" and "extra" not in s["team"]
    assert [x["name"] for x in D.load_setups(tmp_path)] == ["K2.7 vote"]
    with pytest.raises(D.DatasetError, match="min is more than max"):
        D.check_setup({**team, "min": 7, "max": 6}, {"concurrency": 2, "budget": 10, "retries": 0})
    with pytest.raises(D.DatasetError, match="budget must be"):
        D.check_setup(team, {"concurrency": 2, "budget": 0, "retries": 0})
