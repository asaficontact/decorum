# base_forum — Decorum's base forum and its DeepSWE runner

The baseline Decorum compares evolved rulebooks against: an **authority agent** that manages a team of
**workers** through a **forum**. It turns the task into a requirement list, designs the team, opens threads and
assigns workers to them (one or several per thread, each with a persona and instructions it writes), follows and
verifies the work, and commits. A **typed rulebook** is enforced at every tool call. The base rulebook, `base-0`,
keeps the forum open and enforces three things: the authority manages and does not edit files itself, it runs
the task with a team of 3 to 6 workers, and the trial's limits. It runs on DeepSWE and on SWE-bench Pro V2.

```
base_forum/
  rulebooks/base-0.yaml     the minimal rulebook (every key typed; unknown keys are refused)
  runtime/                  the forum runtime: Node 24 + pi (TypeScript run directly, no build step)
  pier_adapter/             decorum_pier: the Pier agents DecorumForum and DecorumSingle
  scripts/run_baseline.sh   run N DeepSWE tasks with Pier + Docker
  scripts/summarize.py      one table per job, against the leaderboard's Kimi K3 reference
  scripts/regrade.sh        grade a trial's patch by hand when Pier's verifier step fails
  scripts/watch.py          follow a running job live in the terminal
  viewer/                   the forum viewer: a live web page over every trial in the job folders
  tasks/baseline-10.tsv     DeepSWE: the 10 baseline tasks, with Kimi K3 / K2.7-code reference pass rates
  tasks/swebenchpro-10.tsv  SWE-bench Pro V2: the 10 tasks the collaborators use, with Scale's 2025 per-task results
```

## How a trial runs

Pier starts the task's sandbox (no network except the model provider's API), uploads the runtime and the rulebook,
and runs `node runtime/src/main.ts run` with the task's instruction. Inside, one Node process hosts every agent as a
pi session:

1. **The authority** (`-m`, e.g. Kimi K3) gets the instruction, pi's coding tools, and the forum tools:
   `open_thread`, `assign_workers`, `post`, `read_thread`, `list_threads`, `wait`, `close_thread` (and
   `merge_worker` when the rulebook isolates workers). Its prompt (`runtime/src/prompts.ts`) makes it the manager:
   write a numbered requirement list in a "Plan" thread, design a team of usually 2 to 4 workers with one owner per
   requirement and per file, brief each one completely, manage through `wait` and posts, verify every requirement
   itself, then commit (or, for a benchmark that grades the working tree, leave the changes uncommitted). Under
   `authority: manager` its `write` and `edit` calls are refused, and under base-0 it must start between 3 and 6
   workers: if it tries to finish with fewer it is sent back with the reason.
2. **Workers** (`worker_model`, e.g. Kimi K2.7-code) are started only through `assign_workers(thread, workers[])`,
   each with a persona and instructions. They see their thread and what the authority wrote, not its conversation.
   They have pi's coding tools plus `post`, `read_thread`, `list_threads`, `wait`, `finish(summary, evidence?)`.
3. **Messages** reach an agent as `[forum]` messages between its tool calls (pi's steering queue), or wake it from
   `wait`. A finished worker resumes when the authority posts in its thread or a post names it (`@w1`). If the
   authority ends its turn while workers are working, it is woken when one posts or finishes.
4. **The rulebook** is enforced in pi's `tool_call` hook and in the forum tools; a refused call returns the reason
   to the agent and is logged in the forum. When the dollar budget or the wall clock runs out, every agent is
   stopped.
5. **The end**: when the authority ends its turn with no worker working, the runtime commits anything left
   uncommitted (DeepSWE grades `git diff base..HEAD`), writes `summary.json`, and Pier grades the patch in a
   clean container.

## The rulebook

| rule | base-0 | other values | enforced where |
|---|---|---|---|
| `visibility` | `all` | `participants` | `read_thread` |
| `posting` | `all` | `participants` | `post` |
| `workspace` | `shared` (one checkout) | `isolated` (a git worktree per worker, installed deps linked in) | `assign_workers`, `finish`, `merge_worker` |
| `closing` | `self` | `evidence` | `finish` |
| `authority` | `manager` (no write or edit for the authority) | `player` | the `tool_call` hook, forum mode only |
| `budget.usd_per_trial` | 10 | number or null | every tool call and every model response |
| `budget.max_live_workers` | 4 | integer | `assign_workers`, resuming a worker |
| `budget.max_workers_total` | 6 | integer or null | `assign_workers` |
| `budget.min_workers_total` | 3 | integer (0 = none) | when the authority tries to end the trial: sent back with the reason |
| `budget.wall_clock_sec` | 9000 | number or null | a timer, every tool call |
| `norms` | "" | free text | prompt only |

Each rule's value is shown to every agent in its system prompt (`describeRules`). A new rule is a key in
`runtime/src/rulebook.ts`, a decision in `runtime/src/enforce.ts`, and a test.

## What a trial leaves (`<job>/<trial>/agent/`)

- `decorum/forum.jsonl` — every forum event: threads, posts, assignments, finishes, refusals.
- `decorum/sessions/<agent>/*.jsonl` — each agent's full pi session.
- `decorum/summary.json` — models, rulebook, end reason, cost and tokens per agent, assignments, refusals.
- `decorum/runtime.log`, `decorum/stdout.txt` — the runtime's own log.
- `trajectory.json` — ATIF v1.7 for Pier's viewer (`pier view`): the authority as the root, each worker as an
  embedded subagent trajectory referenced from the `assign_workers` call that started it.

## Running the baseline (macOS or Linux, Docker)

Needs Docker (Docker Desktop on a Mac, at least 8 CPUs and 16 GB given to it for two trials at once), `uv`, and git.
Node is only needed to run the runtime's own tests.

```bash
git clone https://github.com/asaficontact/decorum && cd decorum   # or git pull on the merged main
uv tool install datacurve-pier --with-editable ./base_forum/pier_adapter
printf 'MOONSHOT_API_KEY=%s\n' "<your key>" > base_forum/.env       # gitignored

FAUX=smoke N_TASKS=1 base_forum/scripts/run_baseline.sh   # scripted agents, no key, no cost: checks Docker + Pier
N_TASKS=1 base_forum/scripts/run_baseline.sh       # one real task: checks the key and the network
base_forum/scripts/run_baseline.sh                 # the 10 baseline tasks, forum mode
MODE=single base_forum/scripts/run_baseline.sh     # the same 10, one Kimi K3 agent and no forum
```

**SWE-bench Pro** (V2, Scale's Harbor tasks from `scaleapi/SWE-bench_Pro-os`, fetched into `base_forum/.swebench-pro`
the first time): put `BENCHMARK=swebenchpro` in front of any of the commands above. It runs the 10 tasks in
`tasks/swebenchpro-10.tsv` as the benchmark defines them: each task's own sandbox (1 CPU, 4 GB) and time limit
(3000 s), the agent offline except for the model's API, the grade read from the working tree. So nobody commits:
the prompts say so, and any commit an agent makes anyway is undone at the end with its changes kept.

**Time limits** come from the tasks: `run_baseline.sh` reads `[agent] timeout_sec` from each task.toml and tells the
runtime to stop 120 s before the shortest, so it always hands over its work and writes its summary before Pier stops
it. DeepSWE's tasks allow 3 h; base-0's own 2.5 h (the leaderboard's) is the tighter there.

Defaults: authority `moonshotai/kimi-k3` at `max` thinking (as on the DeepSWE leaderboard), workers
`moonshotai/kimi-k2.7-code` at `high`, rulebook `base-0`, 2 trials at once, 4 CPUs and 8 GB per trial. Every
default is an environment variable; see the top of `scripts/run_baseline.sh`. On an Apple-silicon Mac the task images
(linux/amd64) run under emulation: expect the first build of each task image to take several minutes and test suites
to run slower than on the leaderboard.

Watching live: the runtime writes the forum and every agent's session as it goes, and Docker mounts them on the host.

- **In the browser:** `python3 base_forum/viewer/forum_view.py --open` (http://127.0.0.1:8479/). The left column
  lists your runs (one per `run_baseline.sh` invocation, i.e. one Pier job), running ones first: benchmark (DeepSWE
  or SWE-bench Pro V2), status, how many tasks passed, did not pass, failed or are still waiting, and the cost; open a
  run's arrow to see its tasks. Clicking a run opens its page: the score, a bar of the results, and a table of its
  tasks. **Rename** (or ✎ in the list, or double-click the title) gives a run your own name, e.g. "Kimi K3 + K2,
  base-0, try 2"; Enter saves, Escape cancels, an empty name restores the default. Names are kept in
  `base_forum/jobs/.decorum-viewer.json`, beside the jobs, so they survive restarts; the job folders are never
  touched. The address bar (`#run=<job>&trial=<trial>`) can be bookmarked. A task shows its task, cost and time, the team (each
  agent's persona, state and current action), and its threads as columns: the plan, workers joining with their
  instructions, every post, finish reports, and each worker's tool calls folded per step. **L** switches to one
  timeline, **T** back; clicking an agent shows everything it did; **Pause updates** freezes the page while you read.
  Standard library only; it binds to 127.0.0.1.
- **In the terminal:** `python3 base_forum/scripts/watch.py base_forum/jobs/<job>` prints the same events as lines
  (`--quiet` for the forum only). `run_baseline.sh` prints both commands when it starts.

Results: `base_forum/jobs/<job>/`; `python3 base_forum/scripts/summarize.py base_forum/jobs/<job> --reference
base_forum/tasks/baseline-10.tsv` prints one line per trial (reward, cost, time, workers, posts, end reason) beside the
leaderboard's Kimi K3 pass rate for that task. `pier view base_forum/jobs/<job>` opens the trajectories.

## Developing

```bash
cd base_forum/runtime && npm ci && npm test && npx tsc --noEmit      # 45 tests, scripted agents, no key
cd base_forum/pier_adapter && uv run --with pytest --with-editable . pytest -q
cd base_forum/viewer && uv run --no-project --with pytest pytest -q
node base_forum/runtime/src/main.ts run --instruction "..." --repo /tmp/repo --out /tmp/out --faux smoke   # no model
pier run -p <task> --agent-import-path decorum_pier:DecorumForum --ak faux=smoke --env docker   # Pier + Docker, no model
```

`--faux smoke` replaces both models with scripted agents (an authority that opens a thread and assigns two workers who
each write a file). It exercises the whole path, Pier and Docker included, without a key, and scores 0 on a real task.
