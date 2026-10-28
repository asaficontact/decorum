#!/usr/bin/env python3
"""Build the task catalogues the viewer's New run page chooses from: every task of each benchmark, with what it
is about and how hard it has been for published models.

    python3 base_forum/scripts/build_catalog.py            # fetches the public sources, writes tasks/catalog/*.json

DeepSWE v1.1 (113 tasks)
  tasks and trials: https://deepswe.datacurve.ai/artifacts/v1.1/{tasks,trials}.json (the leaderboard's own data);
  category: each task's task.toml under --deepswe-tasks (base_forum/.deep-swe/tasks, cloned by run_baseline.sh).
  solve rate: the share of scored attempts (included_in_score) that passed, across every model.
SWE-bench Pro V2 (642 tasks)
  tasks: Scale's dataset ScaleAI/SWE-bench_Pro, config "default" (= V2), through the Hugging Face datasets server:
  repository, language, issue categories, HARD-51, and the size of the reference patch;
  solve rate: Scale's 2025 runs on v1 (traj/*/eval_results.json in github.com/scaleapi/SWE-bench_Pro-os), on the
  tasks V2 kept. V2's own task.toml files mark every task "medium"/"debugging", so they cannot be used.
Difficulty: the solve rate cut into quartiles within each benchmark: easy, medium, hard, very hard.

Standard library only. The output is sorted and stable, so a rebuild changes the files only when the sources do.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "tasks" / "catalog"
DEEPSWE = "https://deepswe.datacurve.ai/artifacts/v1.1/{}.json"
HF_ROWS = "https://datasets-server.huggingface.co/rows?dataset=ScaleAI/SWE-bench_Pro&config=default&split=test&offset={}&length=100"
SCALE_TRAJ = "https://api.github.com/repos/scaleapi/SWE-bench_Pro-os/contents/traj"
BANDS = ("easy", "medium", "hard", "very hard")


def fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "decorum-build-catalog"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


# ---------- the pure part (tested) ----------


def band_tasks(tasks: list[dict]) -> list[float]:
    """Cut the solve rates into quartiles and give each task its band; returns the three cut points."""
    xs = sorted(t["solve"] for t in tasks if t.get("solve") is not None)
    if not xs:
        return []
    cut = [xs[min(len(xs) - 1, int(len(xs) * f))] for f in (0.25, 0.5, 0.75)]
    for t in tasks:
        s = t.get("solve")
        t["band"] = (
            None
            if s is None
            else (
                "very hard"
                if s <= cut[0]
                else "hard"
                if s <= cut[1]
                else "medium"
                if s <= cut[2]
                else "easy"
            )
        )
    return cut


def deepswe_catalog(
    task_rows: list[dict], trial_rows: list[dict], categories: dict[str, str]
) -> dict:
    by: dict[str, list[float]] = {}
    by_model: dict[str, dict[str, list[float]]] = {}
    models: set[str] = set()
    for t in trial_rows:
        if t.get("source") != "deep-swe" or not t.get("included_in_score"):
            continue
        ok = 1.0 if t.get("passed") else 0.0
        by.setdefault(t["task_name"], []).append(ok)
        by_model.setdefault(t["task_name"], {}).setdefault(
            t.get("model") or "?", []
        ).append(ok)
        models.add(t.get("model") or "?")
    tasks = []
    for r in sorted(task_rows, key=lambda r: r["id"]):
        xs = by.get(r["id"], [])
        k3 = by_model.get(r["id"], {}).get("kimi-k3", [])
        tasks.append(
            {
                "id": r["id"],
                "title": r.get("problem_title") or r["id"],
                "repo": r.get("repository") or "",
                "language": (r.get("language") or "").lower(),
                "category": categories.get(r["id"]),
                "solve": round(statistics.mean(xs), 3) if xs else None,
                "attempts": len(xs),
                "ref": round(statistics.mean(k3), 2) if k3 else None,
            }
        )
    cut = band_tasks(tasks)
    return {
        "key": "deepswe",
        "name": "DeepSWE",
        "version": "v1.1",
        "agent_timeout_sec": 10800,
        "solve_source": f"{sum(len(v) for v in by.values())} published attempts by {len(models)} models (deepswe.datacurve.ai)",
        "ref_label": "Kimi K3 (max) pass rate",
        "cut": cut,
        "tasks": tasks,
    }


def title_of(problem_statement: str | None, fallback: str) -> str:
    """The first line of a problem statement that reads as a title (not a bare "Title:" heading)."""
    for line in (problem_statement or "").splitlines():
        s = re.sub(r"^#+\s*", "", line.strip()).strip(" *")
        if not s or re.fullmatch(
            r"(?i)(title|issue title|bug report|summary|description|problem statement)\s*:?",
            s,
        ):
            continue
        s = re.sub(r"(?i)^(title|issue title|summary)\s*:\s*", "", s).strip(" *\"'`")
        if len(s) >= 4:
            return s[:140]
    return fallback


def pro_catalog(hf_rows: list[dict], runs: dict[str, dict]) -> dict:
    tasks = []
    for x in sorted(hf_rows, key=lambda x: x["instance_id"]):
        tid = x["instance_id"]
        vals = [1.0 if bool(d[tid]) else 0.0 for d in runs.values() if tid in d]
        patch = x.get("patch") or ""
        k2 = runs.get("kimi-k2-instruct-10132025", {})
        tasks.append(
            {
                "id": tid,
                "title": title_of(
                    x.get("problem_statement"),
                    f"{x['repo'].split('/')[-1]} issue {tid.split('-')[1][:7] if '-' in tid else tid}",
                ),
                "repo": x["repo"],
                "language": (x.get("repo_language") or "").lower(),
                "categories": json.loads(x.get("issue_categories") or "[]"),
                "hard51": x.get("hard") in (True, "True", "true"),
                "patch_lines": sum(
                    1
                    for line in patch.splitlines()
                    if line[:1] in "+-" and not line.startswith(("+++", "---"))
                ),
                "solve": round(statistics.mean(vals), 3) if vals else None,
                "attempts": len(vals),
                "ref": (1.0 if bool(k2[tid]) else 0.0) if tid in k2 else None,
            }
        )
    cut = band_tasks(tasks)
    return {
        "key": "swebenchpro",
        "name": "SWE-bench Pro",
        "version": "V2",
        "agent_timeout_sec": 3000,
        "solve_source": f"Scale's 2025 runs of {len(runs)} models on v1 (SWE-agent), on the tasks V2 kept",
        "ref_label": "Kimi K2 solved it (Scale, 2025)",
        "cut": cut,
        "tasks": tasks,
    }


# ---------- fetching ----------


def deepswe_categories(tasks_dir: Path) -> dict[str, str]:
    out = {}
    for f in sorted(tasks_dir.glob("*/task.toml")):
        m = re.search(r'^category = "([^"]+)"', f.read_text(), re.MULTILINE)
        if m:
            out[f.parent.name] = m.group(1)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--deepswe-tasks", type=Path, default=BASE / ".deep-swe" / "tasks")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args(argv)
    a.out.mkdir(parents=True, exist_ok=True)

    print("DeepSWE: fetching tasks and trials", file=sys.stderr)
    cats = deepswe_categories(a.deepswe_tasks) if a.deepswe_tasks.is_dir() else {}
    ds = deepswe_catalog(
        fetch_json(DEEPSWE.format("tasks"))["rows"],
        fetch_json(DEEPSWE.format("trials"))["rows"],
        cats,
    )

    print("SWE-bench Pro V2: fetching the dataset and Scale's runs", file=sys.stderr)
    rows: list[dict] = []
    for off in range(0, 2000, 100):
        page = fetch_json(HF_ROWS.format(off))
        rows += [r["row"] for r in page["rows"]]
        if len(page["rows"]) < 100:
            break
        time.sleep(0.3)
    runs = {}
    for entry in fetch_json(SCALE_TRAJ):
        if entry.get("type") != "dir":
            continue
        for f in fetch_json(entry["url"]):
            if "eval_results" in f["name"] and f.get("download_url"):
                runs[entry["name"]] = fetch_json(f["download_url"])
    pro = pro_catalog(rows, runs)

    for cat in (ds, pro):
        path = a.out / f"{cat['key']}.json"
        path.write_text(
            json.dumps(cat, indent=0, sort_keys=True, ensure_ascii=False) + "\n"
        )
        solved = sum(t["solve"] is not None for t in cat["tasks"])
        print(
            f"{path}: {len(cat['tasks'])} tasks, {solved} with a solve rate, cuts {cat['cut']}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
