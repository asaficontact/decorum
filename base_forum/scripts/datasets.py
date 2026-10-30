#!/usr/bin/env python3
"""Named datasets and named team setups: what a run runs on, and who runs it, saved under a name and shared.

A dataset is a named list of one benchmark's tasks, kept in base_forum/tasks/datasets/<slug>.json and committed, so
everyone who pulls the repo runs the same tasks under the same name. A dataset never changes once saved (a changed
list is saved under a new name), and a run records the dataset it ran as <slug>@<hash>, where the hash is of the
benchmark and the task ids: two runs with the same <slug>@<hash> ran exactly the same tasks, whatever the setup
(forum, single, vote, peer review), so they can be compared task by task.

A setup is a named team (mode, models, thinking, workers) and run settings, kept in base_forum/tasks/setups/<slug>.json,
so the same team can be started on another dataset with one click.

    python3 base_forum/scripts/datasets.py list [--benchmark swebenchpro]
    python3 base_forum/scripts/datasets.py show collaborators-10
    python3 base_forum/scripts/datasets.py save --name "Ansible smoke" --benchmark swebenchpro \\
        --tasks instance_ansible__ansible-12734fa... [--description "..."]
    python3 base_forum/scripts/datasets.py save --name "Same as Tuesday" --from-job base_forum/jobs/<job>
    python3 base_forum/scripts/datasets.py resolve collaborators-10 --tasks-out list.tsv   # run_baseline.sh uses this

Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATASETS_DIR = BASE / "tasks" / "datasets"
SETUPS_DIR = BASE / "tasks" / "setups"
BENCHMARKS = ("swebenchpro", "deepswe")
SLUG_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,47}")
MAX_TASKS = 2000


class DatasetError(ValueError):
    pass


def slugify(name: str) -> str:
    """The file name for a name: lowercase letters, digits and -, at most 48 characters."""
    slug = re.sub(r"[^a-z0-9]+", "-", re.sub(r"['’]", "", name.lower())).strip("-")[:48].strip("-")
    if not slug or not SLUG_RE.fullmatch(slug):
        raise DatasetError(f"the name {name!r} needs at least one letter or digit")
    return slug


def content_hash(benchmark: str, tasks: list[str]) -> str:
    """12 hex characters of the SHA-256 of the benchmark and the task ids, in order."""
    return hashlib.sha256("\n".join([benchmark, *tasks]).encode()).hexdigest()[:12]


def _check_name(name: object, what: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise DatasetError(f"a {what} needs a name")
    name = " ".join(name.split())
    if len(name) > 60:
        raise DatasetError(f"a {what}'s name is at most 60 characters")
    return name


def _write_new(path: Path, data: dict) -> None:
    """Write a file that must not exist yet, atomically: a name is never saved twice, and never half."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        try:
            os.link(tmp, path)  # fails if the name was taken meanwhile
        except FileExistsError:
            raise
        except OSError:  # a filesystem without hard links: create the file exclusively instead
            with open(path, "x") as f:
                f.write(open(tmp).read())
    except FileExistsError:
        raise DatasetError(f"{path.name} already exists; give it another name") from None
    finally:
        os.unlink(tmp)


def _load_dir(d: Path) -> list[dict]:
    out = []
    for f in sorted(d.glob("*.json")) if d.is_dir() else []:
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(data, dict):
            out.append({**data, "slug": f.stem})
    return out


# ---------- datasets ----------


def load_datasets(d: Path | None = None) -> list[dict]:
    """Every dataset, oldest name first, each with its slug and hash (recomputed: the file is the truth)."""
    out = []
    for ds in _load_dir(d or DATASETS_DIR):
        tasks = ds.get("tasks")
        if ds.get("benchmark") not in BENCHMARKS or not isinstance(tasks, list) or not all(isinstance(t, str) for t in tasks):
            continue
        out.append({**ds, "hash": content_hash(ds["benchmark"], tasks)})
    return out


def load_dataset(slug: str, d: Path | None = None) -> dict:
    for ds in load_datasets(d):
        if ds["slug"] == slug:
            return ds
    known = ", ".join(x["slug"] for x in load_datasets(d)) or "none yet"
    raise DatasetError(f"no dataset {slug!r} (known: {known})")


def save_dataset(
    name: object,
    benchmark: object,
    tasks: object,
    description: object = "",
    how: object = "",
    known_tasks: set[str] | None = None,
    d: Path | None = None,
) -> dict:
    """Check and save a new dataset; returns it with its slug and hash. A name already used is refused."""
    name = _check_name(name, "dataset")
    if benchmark not in BENCHMARKS:
        raise DatasetError(f"benchmark must be one of {', '.join(BENCHMARKS)}")
    if not isinstance(tasks, list) or not tasks or not all(isinstance(t, str) and t.strip() for t in tasks):
        raise DatasetError("a dataset needs a non-empty list of task ids")
    tasks = list(dict.fromkeys(t.strip() for t in tasks))
    if len(tasks) > MAX_TASKS:
        raise DatasetError(f"a dataset holds at most {MAX_TASKS} tasks")
    if known_tasks is not None:
        unknown = [t for t in tasks if t not in known_tasks]
        if unknown:
            raise DatasetError(f"not in the benchmark: {', '.join(unknown[:5])}")
    for field, value in (("description", description), ("how", how)):
        if not isinstance(value, str) or len(value) > 500:
            raise DatasetError(f"{field} must be text of at most 500 characters")
    slug = slugify(name)
    d = d or DATASETS_DIR
    if any(x.get("name", "").lower() == name.lower() for x in load_datasets(d)):
        raise DatasetError(f"a dataset named {name!r} already exists; a dataset never changes, so save the new list under another name")
    data = {
        "name": name,
        "benchmark": benchmark,
        "description": description.strip(),
        "how": how.strip(),
        "created_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "tasks": tasks,
    }
    _write_new(d / f"{slug}.json", data)
    return {**data, "slug": slug, "hash": content_hash(benchmark, tasks)}


def ref_of(ds: dict) -> str:
    """How a run records the dataset it ran: <slug>@<hash>."""
    return f"{ds['slug']}@{ds['hash']}"


def split_ref(ref: str | None) -> tuple[str, str] | None:
    if not ref or "@" not in ref:
        return None
    slug, h = ref.rsplit("@", 1)
    return slug, h


def tasks_of_job(job: Path) -> tuple[str | None, list[str]]:
    """A Pier job's benchmark (guessed from its task paths) and task ids, for saving a run's tasks as a dataset."""
    cfg = json.loads((job / "config.json").read_text())
    paths = [str(t.get("path") or "") for t in cfg.get("tasks") or []]
    names = [str(n) for n in ((cfg.get("datasets") or [{}])[0].get("task_names") or [])] if cfg.get("datasets") else []
    ids = names or [Path(p).name for p in paths if p]
    if not ids:
        ids = sorted({p.name.split("__")[0] for p in job.iterdir() if p.is_dir() and (p / "config.json").exists()})
    paths_text = " ".join(paths) + json.dumps(cfg.get("datasets") or [])
    bench = "swebenchpro" if ("swebench-pro" in paths_text or all(i.startswith("instance_") for i in ids)) else ("deepswe" if ids else None)
    return bench, ids


# ---------- setups ----------

SETUP_MODES = ("forum", "single", "vote", "peer-review")
THINKING = ("off", "minimal", "low", "medium", "high", "xhigh", "max")
MODEL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]*(/[A-Za-z0-9._:+-]+)+", re.ASCII)


def check_setup(team: object, run: object) -> tuple[dict, dict]:
    """A setup's team and run settings, checked like a New run request; unknown keys are dropped."""
    if not isinstance(team, dict) or not isinstance(run, dict):
        raise DatasetError("a setup needs a team and run settings")
    mode = team.get("mode")
    if mode not in SETUP_MODES:
        raise DatasetError(f"mode must be one of {', '.join(SETUP_MODES)}")

    def whole(src: dict, key: str, lo: int, hi: int) -> int:
        v = src.get(key)
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise DatasetError(f"{key} must be a whole number from {lo} to {hi}")
        return v

    t = {"mode": mode}
    for key in ("authority", "worker"):
        v = team.get(key)
        if not isinstance(v, str) or not MODEL_RE.fullmatch(v):
            raise DatasetError(f"{key} must look like provider/model")
        t[key] = v
    for key in ("athink", "wthink"):
        if team.get(key) not in THINKING:
            raise DatasetError(f"{key} must be one of {', '.join(THINKING)}")
        t[key] = team[key]
    t.update(min=whole(team, "min", 0, 8), max=whole(team, "max", 1, 8), live=whole(team, "live", 1, 20), n=whole(team, "n", 1, 20))
    if t["min"] > t["max"]:
        raise DatasetError("min is more than max")
    r = {"concurrency": whole(run, "concurrency", 1, 12), "retries": whole(run, "retries", 0, 3)}
    budget = run.get("budget")
    if not isinstance(budget, (int, float)) or isinstance(budget, bool) or not 1 <= budget <= 1000:
        raise DatasetError("budget must be from 1 to 1000 dollars")
    r["budget"] = budget
    return t, r


def load_setups(d: Path | None = None) -> list[dict]:
    out = []
    for s in _load_dir(d or SETUPS_DIR):
        try:
            team, run = check_setup(s.get("team"), s.get("run"))
        except DatasetError:
            continue
        out.append({**s, "team": team, "run": run})
    return out


def save_setup(name: object, team: object, run: object, description: object = "", d: Path | None = None) -> dict:
    name = _check_name(name, "setup")
    team, run = check_setup(team, run)
    if not isinstance(description, str) or len(description) > 500:
        raise DatasetError("description must be text of at most 500 characters")
    slug = slugify(name)
    d = d or SETUPS_DIR
    if any(x.get("name", "").lower() == name.lower() for x in load_setups(d)):
        raise DatasetError(f"a setup named {name!r} already exists; give it another name")
    data = {"name": name, "description": description.strip(), "created_at": datetime.now(UTC).replace(microsecond=0).isoformat(), "team": team, "run": run}
    _write_new(d / f"{slug}.json", data)
    return {**data, "slug": slug}


# ---------- the command line ----------


def _cli(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list", help="list the datasets")
    ls.add_argument("--benchmark", choices=BENCHMARKS)
    show = sub.add_parser("show", help="one dataset, with its tasks")
    show.add_argument("slug")
    res = sub.add_parser("resolve", help="a dataset's benchmark and <slug>@<hash>, its tasks written as a task list")
    res.add_argument("slug")
    res.add_argument("--tasks-out", required=True, type=Path)
    sv = sub.add_parser("save", help="save a new dataset")
    sv.add_argument("--name", required=True)
    sv.add_argument("--benchmark", choices=BENCHMARKS)
    src = sv.add_mutually_exclusive_group(required=True)
    src.add_argument("--tasks", nargs="+", help="task ids")
    src.add_argument("--tasks-file", type=Path, help="a task list: the first column of each line (# lines and the header skipped)")
    src.add_argument("--from-job", type=Path, help="a Pier job folder: the tasks it ran")
    sv.add_argument("--description", default="")
    a = p.parse_args(argv)
    try:
        if a.cmd == "list":
            for ds in load_datasets():
                if a.benchmark and ds["benchmark"] != a.benchmark:
                    continue
                print(f"{ref_of(ds)}\t{ds['benchmark']}\t{len(ds['tasks'])} tasks\t{ds['name']}")
        elif a.cmd == "show":
            print(json.dumps(load_dataset(a.slug), indent=2))
        elif a.cmd == "resolve":
            ds = load_dataset(a.slug)
            a.tasks_out.parent.mkdir(parents=True, exist_ok=True)
            a.tasks_out.write_text("task\n" + "\n".join(ds["tasks"]) + "\n")
            print(f"{ds['benchmark']}\t{ref_of(ds)}")
        else:
            how = ""
            if a.tasks:
                tasks, bench = a.tasks, a.benchmark
            elif a.tasks_file:
                tasks = [ln.split("\t")[0] for ln in a.tasks_file.read_text().splitlines() if ln and not ln.startswith("#") and ln.split("\t")[0] != "task"]
                bench, how = a.benchmark, f"from {a.tasks_file.name}"
            else:
                bench, tasks = tasks_of_job(a.from_job)
                bench, how = a.benchmark or bench, f"the tasks of run {a.from_job.name}"
            if not bench:
                raise DatasetError("give --benchmark")
            ds = save_dataset(a.name, bench, tasks, a.description, how)
            print(f"saved {DATASETS_DIR / (ds['slug'] + '.json')}: {ref_of(ds)}, {len(ds['tasks'])} tasks")
    except (DatasetError, OSError, ValueError) as e:
        print(f"datasets: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
