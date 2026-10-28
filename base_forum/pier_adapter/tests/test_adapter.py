"""The Pier adapter without Docker: install spec, allowlist, command, and the trajectory built from a real trial.

The trajectory test runs the runtime's scripted smoke trial (node, no model, no key) and converts its output.
"""

from __future__ import annotations

import base64
import gzip
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from pier.models.trajectories import Trajectory

from decorum_pier.agent import RUNTIME_DIR, DecorumForum, DecorumSingle
from decorum_pier.atif import build_trajectory


def make(tmp_path: Path, cls=DecorumForum, **kw):
    kw.setdefault("model_name", "moonshotai/kimi-k3")
    if cls is DecorumForum:
        kw.setdefault("worker_model", "moonshotai/kimi-k2.7-code")
    return cls(logs_dir=tmp_path, **kw)


def test_install_spec_pins_node_and_the_runtime_lockfile(tmp_path):
    spec = make(tmp_path).install_spec()
    assert [s.user for s in spec.steps] == ["root", "root", "root"]
    assert "nodejs.org/dist/v24.21.0" in spec.steps[1].run
    blob = spec.steps[2].run.split("echo ", 1)[1].split(" ", 1)[0]
    manifest = json.loads(gzip.decompress(base64.b64decode(blob)))
    assert manifest["package-lock.json"] == (RUNTIME_DIR / "package-lock.json").read_text()
    assert "npm ci --omit=dev" in spec.steps[2].run
    assert spec.fingerprint() == make(tmp_path).install_spec().fingerprint(), "deterministic, so the image is cached"


def run_package_install(tmp_path, tools, *, fail_update=False, fail_install=False, provide_fd=True):
    """Run the real install shell with a fake package manager and tools, never the host's package manager."""
    bindir = tmp_path / "bin"
    bindir.mkdir(parents=True)
    log = tmp_path / "install.log"

    def executable(name, body):
        path = bindir / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    for tool in tools:
        executable(tool, "exit 0")
    executable("apt-get", r'''
printf '%s\n' "$*" >> "$INSTALL_LOG"
case "$*" in
  *update*) exit "$FAIL_UPDATE" ;;
  *install*)
    if [ "$FAIL_INSTALL" != 0 ]; then exit "$FAIL_INSTALL"; fi
    if [ "$PROVIDE_FD" = 1 ]; then
      printf '#!/bin/sh\nexit 0\n' > "$FAKE_BIN/fdfind"
      /bin/chmod +x "$FAKE_BIN/fdfind"
    fi ;;
esac
''')
    # Redirect the alias into the fixture; do not write /usr/local/bin/fd on the test machine.
    executable("ln", '/bin/ln -sf "$2" "$FAKE_BIN/fd"')
    env = {
        **os.environ,
        "PATH": str(bindir),
        "FAKE_BIN": str(bindir),
        "INSTALL_LOG": str(log),
        "FAIL_UPDATE": "100" if fail_update else "0",
        "FAIL_INSTALL": "100" if fail_install else "0",
        "PROVIDE_FD": "1" if provide_fd else "0",
    }
    result = subprocess.run(
        ["/bin/bash", "-c", make(tmp_path).install_spec().steps[0].run],
        env=env, capture_output=True, text=True, timeout=10,
    )
    return result, log.read_text().splitlines() if log.exists() else [], bindir


@pytest.mark.parametrize("finder", ["fd", "fdfind"])
def test_existing_prerequisites_do_not_contact_the_package_manager(tmp_path, finder):
    result, calls, bindir = run_package_install(tmp_path, ["curl", "xz", "git", "rg", finder])
    assert result.returncode == 0, result.stderr
    assert calls == []
    assert (bindir / "fd").exists()


def test_only_missing_fd_is_installed_without_upgrading_existing_tools(tmp_path):
    result, calls, bindir = run_package_install(tmp_path, ["curl", "xz", "git", "rg"])
    assert result.returncode == 0, result.stderr
    assert calls == [
        "-o Acquire::Retries=3 update -qq",
        "-o Acquire::Retries=3 install -y -qq --no-install-recommends --no-upgrade fd-find",
    ]
    assert (bindir / "fd").resolve() == bindir / "fdfind"


@pytest.mark.parametrize("failure", ["fail_update", "fail_install"])
def test_package_manager_failures_stop_the_install(tmp_path, failure):
    result, calls, bindir = run_package_install(tmp_path, ["curl", "xz", "git", "rg"], **{failure: True})
    assert result.returncode == 100
    assert len(calls) == (1 if failure == "fail_update" else 2)
    assert not (bindir / "fd").exists()


def test_a_successful_package_manager_must_actually_supply_the_required_tools(tmp_path):
    result, _, _ = run_package_install(tmp_path, ["curl", "xz", "git", "fd"], provide_fd=False)
    assert result.returncode != 0
    assert "required tool missing: rg" in result.stderr


def test_allowlist_is_only_the_model_providers(tmp_path):
    assert make(tmp_path).network_allowlist().domains == ["api.moonshot.ai"]
    mixed = make(tmp_path, model_name="openrouter/moonshotai/kimi-k3", worker_model="moonshotai/kimi-k2.7-code")
    assert mixed.network_allowlist().domains == ["api.moonshot.ai", "openrouter.ai"]
    assert make(tmp_path, model_name=None, worker_model=None, faux="smoke").network_allowlist().domains == []


def test_command_carries_both_models_and_the_rulebook(tmp_path):
    cmd = make(tmp_path, authority_thinking="max")._command()
    assert "--mode forum" in cmd
    assert "--authority-model moonshotai/kimi-k3" in cmd
    assert "--worker-model moonshotai/kimi-k2.7-code" in cmd
    assert "--authority-thinking max" in cmd
    assert "--rulebook /installed-agent/decorum/rulebook.yaml" in cmd
    single = make(tmp_path, cls=DecorumSingle)._command()
    assert "--mode single" in single and "--worker-model" not in single
    assert DecorumSingle.name() == "decorum-single"


def test_swebench_pro_settings_reach_the_runtime(tmp_path):
    default = make(tmp_path)._command()
    assert "--commit-policy commit" in default and "--wall-clock-sec" not in default
    pro = make(tmp_path, commit="false", wall_clock_sec="2880")._command()
    assert "--commit-policy leave" in pro and "--wall-clock-sec 2880" in pro
    assert "--commit-policy leave" in make(tmp_path, commit=False)._command()
    with pytest.raises(ValueError, match="commit must be true or false"):
        make(tmp_path, commit="sometimes")
    with pytest.raises(ValueError, match="wall_clock_sec must be positive"):
        make(tmp_path, wall_clock_sec=0)


def test_configuration_errors_are_named(tmp_path):
    with pytest.raises(ValueError, match="worker_model"):
        DecorumForum(logs_dir=tmp_path, model_name="moonshotai/kimi-k3")
    with pytest.raises(ValueError, match="-m provider/model-id"):
        DecorumForum(logs_dir=tmp_path, worker_model="moonshotai/kimi-k2.7-code")
    with pytest.raises(ValueError, match="No rulebook 'nope'.*base-0"):
        make(tmp_path, rulebook="nope")
    with pytest.raises(ValueError, match="authority_thinking"):
        make(tmp_path, authority_thinking="huge")
    with pytest.raises(ValueError, match="Unknown provider"):
        make(tmp_path, model_name="acme/model")


@pytest.mark.skipif(
    shutil.which("node") is None or not (RUNTIME_DIR / "node_modules").exists(),
    reason="needs node and npm ci in runtime/",
)
def test_trajectory_from_a_real_smoke_trial(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    g = lambda *a: subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True)
    g("init", "-q")
    (repo / "README").write_text("x\n")
    g("add", "-A")
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base")
    out = tmp_path / "out"
    subprocess.run(
        ["node", str(RUNTIME_DIR / "src" / "main.ts"), "run", "--instruction", "Write smoke files.", "--repo", str(repo),
         "--out", str(out), "--faux", "smoke", "--work-dir", str(tmp_path / "work")],
        check=True, capture_output=True, timeout=120,
    )  # fmt: skip
    summary = json.loads((out / "summary.json").read_text())
    t = build_trajectory(summary, out, agent_name="decorum-forum", version="test")
    Trajectory.model_validate(t.to_json_dict())  # the schema Pier's viewer reads
    assert t.agent.model_name == "faux/authority"
    assert [s.trajectory_id for s in t.subagent_trajectories or []] == ["w1", "w2", "w3"]
    assign = next(st for st in t.steps if st.tool_calls and st.tool_calls[0].function_name == "assign_workers")
    refs = assign.observation.results[0].subagent_trajectory_ref
    assert [r.trajectory_id for r in refs] == ["w1", "w2", "w3"]
    assert t.final_metrics.total_cost_usd == pytest.approx(summary["cost_usd"])
    assert t.final_metrics.extra["end_reason"] == "authority_done"
    assert t.final_metrics.total_steps == sum(len(x.steps) for x in [t, *t.subagent_trajectories])
