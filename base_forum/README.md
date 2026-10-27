# base_forum — Decorum's base forum and its DeepSWE runner

The baseline Decorum compares evolved rulebooks against: an **authority agent** that opens threads and assigns
**workers** (one or several per thread, each with its own persona and instructions) through a **forum**, governed by
a **typed rulebook** that the runtime enforces at every tool call. The base rulebook, `base-0`, keeps the forum as
open as possible and enforces only the trial's limits.

```
base_forum/
  rulebooks/base-0.yaml     the minimal rulebook (every key typed; unknown keys are refused)
  runtime/                  the forum runtime: Node 24 + pi (TypeScript run directly, no build step)
  pier_adapter/             decorum_pier: the Pier agents DecorumForum and DecorumSingle
  scripts/run_baseline.sh   run N DeepSWE tasks with Pier + Docker
  scripts/summarize.py      one table per job, against the leaderboard's Kimi K3 reference
  scripts/regrade.sh        grade a trial's patch by hand when Pier's verifier step fails
  scripts/watch.py          follow a running job live: threads, assignments, posts, tool calls, cost
  tasks/baseline-10.tsv     the 10 baseline tasks, with Kimi K3 / K2.7-code reference pass rates
```

## How a trial runs

Pier starts the task's sandbox (no network except the model provider's API), uploads the runtime and the rulebook,
and runs `node runtime/src/main.ts run` with the task's instruction. Inside, one Node process hosts every agent as a
pi session:

1. **The authority** (`-m`, e.g. Kimi K3) gets the instruction, pi's coding tools, and the forum tools:
   `open_thread`, `assign_workers`, `post`, `read_thread`, `list_threads`, `wait`, `close_thread` (and
   `merge_worker` when the rulebook isolates workers). Whether to use workers at all is its decision.
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
| `budget.usd_per_trial` | 10 | number or null | every tool call and every model response |
| `budget.max_live_workers` | 4 | integer | `assign_workers`, resuming a worker |
| `budget.max_workers_total` | null | integer or null | `assign_workers` |
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

Defaults: authority `moonshotai/kimi-k3` at `max` thinking (as on the DeepSWE leaderboard), workers
`moonshotai/kimi-k2.7-code` at `high`, rulebook `base-0`, 2 trials at once, 4 CPUs and 8 GB per trial. Every
default is an environment variable; see the top of `scripts/run_baseline.sh`. On an Apple-silicon Mac the task images
(linux/amd64) run under emulation: expect the first build of each task image to take several minutes and test suites
to run slower than on the leaderboard.

Watching live: the runtime writes the forum and every agent's session as it goes, and Docker mounts them on the host.
In a second terminal, `python3 base_forum/scripts/watch.py base_forum/jobs/<job>` prints threads opening, workers
joining with their personas and instructions, every post and finish, refusals, each agent's tool calls, and the running
cost (`--quiet` for the forum only). The job directory name is printed by `run_baseline.sh` when it starts.

Results: `base_forum/jobs/<job>/`; `python3 base_forum/scripts/summarize.py base_forum/jobs/<job> --reference
base_forum/tasks/baseline-10.tsv` prints one line per trial (reward, cost, time, workers, posts, end reason) beside the
leaderboard's Kimi K3 pass rate for that task. `pier view base_forum/jobs/<job>` opens the trajectories.

## Developing

```bash
cd base_forum/runtime && npm ci && npm test && npx tsc --noEmit      # 23 tests, scripted agents, no key
cd base_forum/pier_adapter && uv run --with pytest --with-editable . pytest -q
node base_forum/runtime/src/main.ts run --instruction "..." --repo /tmp/repo --out /tmp/out --faux smoke   # no model
pier run -p <task> --agent-import-path decorum_pier:DecorumForum --ak faux=smoke --env docker   # Pier + Docker, no model
```

`--faux smoke` replaces both models with scripted agents (an authority that opens a thread and assigns two workers who
each write a file). It exercises the whole path, Pier and Docker included, without a key, and scores 0 on a real task.
