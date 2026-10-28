"""The run scripts' helpers: preparing SWE-bench Pro V2 tasks for Pier, and the summary's reference column."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import pier_tasks
import summarize

V2_TOML = """schema_version = "1.4"
[task]
name = "swebench-pro/x"

[verifier]
network_mode = "public"
timeout_sec = 3000.0
collect = []

[agent]
network_mode = "no-network"
timeout_sec = 3000.0

[environment]
network_mode = "public"
docker_image = "ghcr.io/scaleapi/swe-bench_pro-v2:x"
"""


def test_only_the_verifier_network_changes() -> None:
    out, changed = pier_tasks.align_verifier_network(V2_TOML)
    assert changed
    diff = [(a, b) for a, b in zip(V2_TOML.splitlines(), out.splitlines()) if a != b]
    assert diff == [
        (
            'network_mode = "public"',
            'network_mode = "no-network"  # decorum: was "public"; Pier cannot switch networks between phases',
        )
    ]
    assert pier_tasks.section_value(out, "agent", "network_mode") == "no-network"
    assert pier_tasks.section_value(out, "environment", "network_mode") == "public"


def test_tasks_pier_already_accepts_are_left_alone() -> None:
    deepswe = '[verifier]\nnetwork_mode = "no-network"\nenvironment_mode = "separate"\n[agent]\nnetwork_mode = "no-network"\n'
    assert pier_tasks.align_verifier_network(deepswe) == (deepswe, False)
    separate = V2_TOML.replace(
        "collect = []", 'collect = []\nenvironment_mode = "separate"'
    )
    assert pier_tasks.align_verifier_network(separate)[1] is False


def test_the_cli_copies_the_tasks_and_refuses_an_unknown_one(tmp_path: Path) -> None:
    src = tmp_path / "src" / "t1"
    (src / "tests").mkdir(parents=True)
    (src / "task.toml").write_text(V2_TOML)
    (src / "tests" / "test.sh").write_text("echo hi\n")
    dest = tmp_path / "dest"
    r = subprocess.run(
        [sys.executable, str(HERE / "pier_tasks.py"), str(src.parent), str(dest), "t1"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert r.returncode == 0, r.stderr
    assert (dest / "t1" / "tests" / "test.sh").read_text() == "echo hi\n"
    assert (
        'network_mode = "no-network"  # decorum'
        in (dest / "t1" / "task.toml").read_text()
    )
    bad = subprocess.run(
        [
            sys.executable,
            str(HERE / "pier_tasks.py"),
            str(src.parent),
            str(dest),
            "nope",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert bad.returncode == 2 and "no task nope" in bad.stderr


def test_the_summary_picks_the_reference_column_of_either_task_list() -> None:
    tasks = HERE.parent / "tasks"
    rows, col = summarize.reference(tasks / "baseline-10.tsv")
    assert col == "k3_max_pass_rate" and len(rows) == 10
    rows, col = summarize.reference(tasks / "swebenchpro-10.tsv")
    assert col == "kimi_k2_v1_2025" and len(rows) == 10
    assert sum(int(r[col]) for r in rows.values()) == 4
    json.dumps(rows)
