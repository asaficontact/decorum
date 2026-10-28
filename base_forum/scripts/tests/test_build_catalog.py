"""build_catalog.py's pure part: difficulty bands, the two catalogues, titles."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_catalog as bc

BASE = Path(__file__).resolve().parents[2]


def test_bands_are_quartiles_of_the_solve_rate() -> None:
    tasks = [{"solve": s} for s in (0.0, 0.1, 0.2, 0.3, 0.5, 0.6, 0.8, 0.9)] + [
        {"solve": None}
    ]
    cut = bc.band_tasks(tasks)
    assert cut == [0.2, 0.5, 0.8]
    assert [t["band"] for t in tasks] == ["very hard"] * 3 + ["hard"] * 2 + [
        "medium"
    ] * 2 + ["easy", None]


def test_deepswe_counts_scored_attempts_of_every_model() -> None:
    rows = [
        {"id": "b-task", "problem_title": "B", "repository": "o/b", "language": "Go"},
        {
            "id": "a-task",
            "problem_title": "A",
            "repository": "o/a",
            "language": "python",
        },
    ]
    trials = [
        {
            "task_name": "a-task",
            "source": "deep-swe",
            "included_in_score": True,
            "passed": True,
            "model": "kimi-k3",
        },
        {
            "task_name": "a-task",
            "source": "deep-swe",
            "included_in_score": True,
            "passed": False,
            "model": "x",
        },
        {
            "task_name": "a-task",
            "source": "deep-swe",
            "included_in_score": False,
            "passed": True,
            "model": "x",
        },  # not scored
        {
            "task_name": "a-task",
            "source": "other",
            "included_in_score": True,
            "passed": True,
            "model": "x",
        },  # another benchmark
        {
            "task_name": "b-task",
            "source": "deep-swe",
            "included_in_score": True,
            "passed": False,
            "model": "x",
        },
    ]
    cat = bc.deepswe_catalog(rows, trials, {"a-task": "feature_request"})
    a, b = cat["tasks"]
    assert (
        a["id"],
        a["solve"],
        a["attempts"],
        a["ref"],
        a["category"],
        a["language"],
    ) == ("a-task", 0.5, 2, 1.0, "feature_request", "python")
    assert (b["solve"], b["ref"], b["category"], b["language"]) == (
        0.0,
        None,
        None,
        "go",
    )
    assert "3 published attempts by 2 models" in cat["solve_source"]


def test_swebench_pro_takes_titles_hard51_patch_size_and_scales_runs() -> None:
    rows = [
        {
            "instance_id": "instance_o__r-abc1234",
            "repo": "o/r",
            "repo_language": "Go",
            "issue_categories": '["back_end_knowledge"]',
            "hard": "True",
            "patch": "diff --git a/x b/x\n--- a/x\n+++ b/x\n-old\n+new\n+more\n",
            "problem_statement": "## Title:\n\n**Title:** Fix the thing\nmore",
        }
    ]
    runs = {
        "kimi-k2-instruct-10132025": {"instance_o__r-abc1234": True},
        "gpt": {"instance_o__r-abc1234": False},
        "other": {},
    }
    [t] = bc.pro_catalog(rows, runs)["tasks"]
    assert (
        t["title"],
        t["hard51"],
        t["patch_lines"],
        t["solve"],
        t["attempts"],
        t["ref"],
        t["language"],
    ) == ("Fix the thing", True, 3, 0.5, 2, 1.0, "go")
    assert (
        bc.title_of("Title:\n", "fallback") == "fallback"
        and bc.title_of("# Add a flag\n", "x") == "Add a flag"
    )


def test_the_committed_catalogues_are_whole() -> None:
    for key, n in (("deepswe", 113), ("swebenchpro", 642)):
        cat = json.loads((BASE / "tasks" / "catalog" / f"{key}.json").read_text())
        assert (
            cat["key"] == key
            and len(cat["tasks"]) == n
            and len({t["id"] for t in cat["tasks"]}) == n
        )
        assert (
            all(t["band"] in (*bc.BANDS, None) for t in cat["tasks"])
            and cat["agent_timeout_sec"] > 0
        )
