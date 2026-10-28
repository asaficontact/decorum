#!/usr/bin/env python3
"""Copy Harbor tasks into a folder Pier can run, changing only what Pier cannot express.

    python3 base_forum/scripts/pier_tasks.py <source tasks dir> <dest dir> <task id> [<task id> ...]

SWE-bench Pro V2 declares the agent offline ([agent] network_mode = "no-network") and the verifier online
([verifier] network_mode = "public") in one shared container. Harbor switches the container's network between the
two phases; Pier 0.3.1 cannot, and refuses the task. The copy runs the verifier with the agent's network mode
(offline). Every other byte of the task is unchanged. Whether a task's grading still works offline is checked by
running Pier's oracle agent on the copies (base_forum/README.md). Standard library only (macOS ships Python 3.9).
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path


def section_value(toml: str, section: str, key: str) -> str | None:
    current = None
    for line in toml.splitlines():
        s = line.strip()
        if s.startswith("["):
            current = s
            continue
        m = re.match(rf'{re.escape(key)}\s*=\s*"([^"]*)"', s)
        if current == f"[{section}]" and m:
            return m.group(1)
    return None


def align_verifier_network(toml: str) -> tuple[str, bool]:
    """In a shared-container task, give [verifier] the agent's network_mode. Returns (text, changed)."""
    agent = section_value(toml, "agent", "network_mode")
    verifier = section_value(toml, "verifier", "network_mode")
    mode = section_value(toml, "verifier", "environment_mode")
    if agent is None or verifier is None or verifier == agent or mode == "separate":
        return toml, False
    out, current, changed = [], None, False
    for line in toml.splitlines(keepends=True):
        s = line.strip()
        if s.startswith("["):
            current = s
        if current == "[verifier]" and re.match(r"network_mode\s*=", s):
            line = f'network_mode = "{agent}"  # decorum: was "{verifier}"; Pier cannot switch networks between phases\n'
            changed = True
        out.append(line)
    return "".join(out), changed


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, dest, ids = Path(argv[0]), Path(argv[1]), argv[2:]
    dest.mkdir(parents=True, exist_ok=True)
    changed = 0
    for tid in ids:
        if not (src / tid / "task.toml").is_file():
            print(f"pier_tasks: no task {tid} in {src}", file=sys.stderr)
            return 2
        target = dest / tid
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(src / tid, target)
        text, did = align_verifier_network((target / "task.toml").read_text())
        if did:
            (target / "task.toml").write_text(text)
            changed += 1
    print(
        f"pier_tasks: {len(ids)} task(s) in {dest}; verifier network aligned with the agent's in {changed}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
