# base_forum — Decorum's base forum and its DeepSWE runner

The baseline Decorum compares evolved rulebooks against: an **authority agent** that manages a team of
**workers** through a **forum**. It turns the task into a requirement list, designs the team, opens threads and
assigns workers to them (one or several per thread, each with a persona and instructions it writes), follows and
verifies the work, and commits. A **typed rulebook** is enforced at every tool call. The base rulebook, `base-0`,
keeps the forum open and enforces three things: the authority manages and does not edit files itself, it runs
the task with a team of 3 to 6 workers, and the trial's limits. It runs on DeepSWE and on SWE-bench Pro V2.
The same runtime runs the two conditions the forum is compared with: one agent alone, and EvoMAS's majority vote
(see [Majority vote](#majority-vote-evomas)).

```
base_forum/
  rulebooks/base-0.yaml     the minimal rulebook (every key typed; unknown keys are refused)
  runtime/                  the forum runtime: Node 24 + pi (TypeScript run directly, no build step)
  pier_adapter/             decorum_pier: the Pier agents DecorumForum, DecorumSingle and DecorumVote
  scripts/run_baseline.sh   run N DeepSWE tasks with Pier + Docker
  scripts/summarize.py      one table per job, against the leaderboard's Kimi K3 reference
  scripts/retry_failed.py   run a job's failed tasks again, in the same job, keeping the failed attempts
  scripts/regrade.sh        grade a trial's patch by hand when Pier's verifier step fails
  scripts/watch.py          follow a running job live in the terminal
  viewer/                   Forum Decorum, the viewer: runs, forums, team analysis and insights, live
  tasks/baseline-10.tsv     DeepSWE: the 10 baseline tasks, with Kimi K3 / K2.7-code reference pass rates
  tasks/swebenchpro-10.tsv  SWE-bench Pro V2: the 10 tasks the collaborators use, with Scale's 2025 per-task results
```

## How a trial runs

Pier starts the task's sandbox (no network except the model provider's API), uploads the runtime and the rulebook,
and runs `node runtime/src/main.ts run` with the task's instruction.

The image installer reuses existing system tools and installs only missing prerequisites. It checks that curl,
xz, git, ripgrep and fd run before the sandbox's network closes; existing tools are not requested for upgrade.

Inside, one Node process hosts every agent as a pi session:

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

## Majority vote (EvoMAS)

`MODE=vote` (Pier agent `DecorumVote`) runs the majority-vote system of EvoMAS (amazon-science/EvoMAS,
`mas_pools/swebench/majority_vote.yaml`) on this runtime, so it differs from the forum only in how the team is
organised:

1. **Workers** `worker1`..`workerN` (`WORKERS`, default 5; EvoMAS's pool has 6) on `WORKER_MODEL` each get the
   instruction exactly as the single agent does, with pi's coding tools, each in its own git worktree branched from
   the task's base. At most `MAX_LIVE_WORKERS` work at once. Where the instruction names the checkout ("A code
   repository is available in the `/app` directory"), a worker's copy names its own worktree, and any worker tool
   call that touches the shared checkout is refused with that reason (rule `vote.own_copy`), so workers stay apart. A worker's patch is everything it changed (committed or
   not, new files included) against the base. A worker that changed nothing is reported as EvoMAS reports it:
   `Error: Agent workerN execution failed: No output generated`.
2. **The aggregator** (`AUTHORITY_MODEL` at `AUTHORITY_THINKING`) gets EvoMAS's prompt word for word: the task
   query (`Repository: ...`, `Instance ID: ...`, the instruction, and the instruction to answer with only a git
   diff), then `Context from other agents:` with each worker's report under `--- workerN ---`. Like EvoMAS's
   aggregator it may read the code (pi's `read`, `grep`, `find`, `ls`) but not change it or run anything. Nothing
   counts votes: it reads every patch and answers with one, copying a worker's or writing its own.
3. **The answer** is cleaned as EvoMAS cleans it (`clean_swe_bench_output`: take a fenced diff, keep the source-file
   diff blocks, drop trailing prose) and applied to the checkout as the SWE-bench harness applies a prediction
   (`git apply`, then `git apply --reject`, then `patch --fuzz=5`). If the aggregator fails, answers with no diff,
   or its patch does not apply, the trial has no patch, as in EvoMAS.

Where it differs from EvoMAS, on purpose: EvoMAS ran its workers one after another in one checkout and showed each
the patches of the workers before it (worker 6 saw five patches); here they are independent. EvoMAS's workers were
SWE-agent, given the aggregator's task query (with its "answer only with a diff" lines, which SWE-agent ignores: its
patch is read from the checkout); here they are the same pi agent as the forum's and the single agent's, given the
plain instruction, since a worker that answered with a diff instead of editing the code would leave no patch. EvoMAS captured a worker's patch
with `git diff HEAD`, which loses new files; here they are kept. And because the trial has one budget, 15% of the
dollars and of the wall clock is kept for the aggregator (`AGGREGATOR_RESERVE`): when the workers have spent the
rest they are stopped, and what each has done so far is its patch.

A vote trial also leaves `decorum/vote/`: each worker's patch, the aggregator's prompt and its answer, and the
final patch; `summary.json`'s `vote` says which worker's patch, if any, the final one is.

```bash
BENCHMARK=swebenchpro MODE=vote WORKERS=5 AUTHORITY_MODEL=moonshotai/kimi-k2.7-code AUTHORITY_THINKING=high \
  base_forum/scripts/run_baseline.sh
```

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
  embedded subagent trajectory referenced from the `assign_workers` call that started it. In a vote the aggregator
  is the root.
- `decorum/vote/` (vote mode) — `workerN.patch`, `aggregator_prompt.md`, `aggregator_answer.md`, `final.patch`.

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
MODE=vote WORKERS=5 base_forum/scripts/run_baseline.sh   # the same 10, EvoMAS's majority vote: 5 workers, an aggregator
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

- **In the browser:** `python3 base_forum/viewer/forum_view.py --open` (http://127.0.0.1:8479/), Forum Decorum. The left column
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
  A run's **Team analysis** tab shows its setup and, task by task, who was on the team (each worker named and
  coloured by role: implementer, tester, reviewer, investigator, guessed from its persona), the threads, the posts of
  the authority and of the workers, send-backs and refusals, beside the result. **Insights across runs** (top of the
  left column) works over the runs you tick: search everything that was said (posts and finish reports), runs side
  by side, cost and result task by task, what the threads were about, how each task unfolded thread by thread, and
  the same task across runs. Standard library only; it binds to 127.0.0.1.
- **In the terminal:** `python3 base_forum/scripts/watch.py base_forum/jobs/<job>` prints the same events as lines
  (`--quiet` for the forum only). `run_baseline.sh` prints both commands when it starts.

Results: `base_forum/jobs/<job>/`; `python3 base_forum/scripts/summarize.py base_forum/jobs/<job> --reference
base_forum/tasks/baseline-10.tsv` prints one line per trial (reward, cost, time, workers, posts, end reason) beside the
leaderboard's Kimi K3 pass rate for that task. `pier view base_forum/jobs/<job>` opens the trajectories.

## Starting a run from the viewer

**＋ New run** (top of the left column) opens the run sheet:
1. **Benchmark:** SWE-bench Pro V2 (642 tasks) or DeepSWE v1.1 (113).
2. **Tasks:** chosen at random with a seed (the default), by difficulty (four bands, from how often published attempts
   solved each task), the same tasks as an earlier run, picked by hand, pasted ids, or the first N. You can narrow
   them to a repository, a language or HARD-51, and load the saved lists (`tasks/*.tsv`).
3. **Team:** the authority's and the workers' models and thinking, the fewest and most workers per task, and how
   many at once. Or **majority vote**: the workers' model and thinking, how many workers and how many at once, and
   the aggregator's model and thinking. Or one agent instead of the forum.
4. **Run:** a name, tasks at once, the spend cap per task, retries on a crash, and **scripted agents** (no model
   calls, no cost: checks Docker, Pier and the tasks).

The sheet on the right shows what the run will be and the most it can spend and take. It also says how hard the
chosen tasks are against the whole benchmark, and how uncertain a pass rate is at that many tasks. **Start** writes
the list to `tasks/runs/<run>.tsv` and starts `run_baseline.sh` with the settings shown under "What it runs"; the run
appears in the list at once. The run takes none of `run_baseline.sh`'s settings from the shell the viewer was started in (only `DEEPSWE_DIR` and `SWEPRO_DIR`, where the benchmarks are kept). A model's key must be in `base_forum/.env`: the page says which one is missing and never
sees it. Start the viewer with `--no-start` to hide the button. When the page is served beyond this computer (`--allow-host` behind a proxy such as tailscale serve, or `--host` other than 127.0.0.1), anyone who can reach it could start paid work, so New run and Retry are then off unless you add `--allow-start` or `--allow-retry`.

The catalogues the page chooses from are in `tasks/catalog/`, built by `scripts/build_catalog.py` from the public
data (sources in the script). The worker range and the spend cap reach the runtime as `MIN_WORKERS`, `MAX_WORKERS`,
`MAX_LIVE_WORKERS` and `BUDGET_USD` (also usable with `run_baseline.sh` directly). They override the rulebook's
budget for that run only, and are checked the same way. A majority-vote run sends `WORKERS` and `MAX_LIVE_WORKERS`
instead of the range.

## When a task fails: retrying it

A task can end without a result of its own: Pier's time limit stopped the agent (`AgentTimeoutError`), Docker or the
network failed, the runtime crashed, or the run was stopped before the task finished or started. The summary says
how many and prints the command; the viewer's run page lists them with the reason and a **Retry** button.

```bash
python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job> --dry-run    # what would be retried, and why
python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job>              # asks, then retries them all
python3 base_forum/scripts/retry_failed.py base_forum/jobs/<job> --task <id>  # one task
```

It moves each failed attempt to `<job>/.attempts/` (logged in `attempts.jsonl`; the viewer shows it as an earlier
attempt you can still open), then runs `pier job resume` on the job: the same models, rulebook, time limit and
concurrency, with the keys from `base_forum/.env`. A task that was graded, passed or not, is never retried: retrying
until it passes would change what the pass rate means. Retried tasks are marked in the summary (`attempts`), with
what the failed attempts cost. `RETRIES=1 run_baseline.sh` also lets Pier retry infrastructure failures (not
timeouts) on its own during the run; it deletes the failed attempt, so prefer `retry_failed.py` when you want to see
why it failed. Start the viewer with `--no-retry` to hide the button.

## Developing

```bash
cd base_forum/runtime && npm ci && npm test && npx tsc --noEmit      # 57 tests, scripted agents, no key
cd base_forum/pier_adapter && uv run --with pytest --with-editable . pytest -q
cd base_forum/viewer && uv run --no-project --with pytest pytest -q
cd base_forum && uv run --no-project --with pytest pytest -q scripts/tests
python3 base_forum/scripts/build_catalog.py      # rebuild tasks/catalog/ from the public sources
node base_forum/runtime/src/main.ts run --instruction "..." --repo /tmp/repo --out /tmp/out --faux smoke   # no model
pier run -p <task> --agent-import-path decorum_pier:DecorumForum --ak faux=smoke --env docker   # Pier + Docker, no model
```

`--faux smoke` replaces both models with scripted agents (an authority that opens a thread and assigns two workers who
each write a file; in vote mode, workers that each write a file and an aggregator that answers with worker1's patch). It exercises the whole path, Pier and Docker included, without a key, and scores 0 on a real task.
