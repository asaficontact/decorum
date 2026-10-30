#!/usr/bin/env bash
# Run the Decorum base forum (or the single-agent or majority-vote condition) on DeepSWE or SWE-bench Pro tasks with
# Pier and Docker.
#
#   base_forum/scripts/run_baseline.sh                          # DeepSWE: the 10 baseline tasks, forum mode
#   BENCHMARK=swebenchpro base_forum/scripts/run_baseline.sh    # SWE-bench Pro V2: the 10 tasks in tasks/swebenchpro-10.tsv
#   MODE=single base_forum/scripts/run_baseline.sh              # the same tasks, one agent, no forum
#   MODE=vote WORKERS=5 base_forum/scripts/run_baseline.sh      # EvoMAS's majority vote: 5 workers, one aggregator
#   MODE=peer-review WORKERS=6 base_forum/scripts/run_baseline.sh   # EvoMAS's peer review: 6 creators, reviewers, revisers
#   DATASET=collaborators-10 MODE=vote base_forum/scripts/run_baseline.sh   # a named dataset (tasks/datasets/)
#   N_TASKS=1 base_forum/scripts/run_baseline.sh                # just the first task, to check the setup
#   DRY_RUN=1 base_forum/scripts/run_baseline.sh                # print the pier command and stop
#   FAUX=smoke N_TASKS=1 base_forum/scripts/run_baseline.sh     # scripted agents, no key, no cost: checks Docker + Pier
#
# Settings (environment variables, defaults in brackets):
#   BENCHMARK [deepswe]                deepswe | swebenchpro (SWE-bench Pro V2, Scale's Harbor tasks)
#   MODE [forum]                       forum | single | vote | peer-review
#   AUTHORITY_MODEL [moonshotai/kimi-k3]  in vote and peer-review mode, the aggregator's model (AUTHORITY_THINKING its
#                                      thinking); the other agents run on WORKER_MODEL
#   WORKER_MODEL [moonshotai/kimi-k2.7-code]
#   AUTHORITY_THINKING [max]           off | minimal | low | medium | high | xhigh | max (the leaderboard ran K3 at max)
#   WORKER_THINKING [high]
#   RULEBOOK [base-0]                  a name under base_forum/rulebooks, or a path
#   TASKS [per benchmark]              a TSV whose first column is the task id (# lines and the header are skipped)
#   N_TASKS [all]                      run only the first N tasks of the list
#   CONCURRENCY [2]                    trials at once
#   MIN_WORKERS, MAX_WORKERS          the fewest and most workers per task (default: the rulebook's, 3 and 6 in base-0)
#   MAX_LIVE_WORKERS, BUDGET_USD       workers at once, and the spend cap per task in dollars (default: the rulebook's)
#   WORKERS [5 vote, 6 peer-review]    vote and peer-review mode: the agents in each layer (1-20; EvoMAS's pools have 6)
#   AGGREGATOR_RESERVE [0.15, 0.45]    vote and peer-review mode: the share of the dollars and the clock kept for the
#                                      read-only layers after the coding agents
#   DATASET                            a named dataset (scripts/datasets.py list): its tasks and its benchmark, instead
#                                      of TASKS and BENCHMARK; the run records it as <name>@<hash>
#   RETRIES [0]                        retry a trial that fails on infrastructure (Docker, network, a crash) up to N
#                                      times during the run; Pier never retries a timeout or a grading error this way.
#                                      After a run, scripts/retry_failed.py retries any failed task, timeouts included.
#   CPUS, MEMORY_MB                    per trial sandbox. DeepSWE: 4 CPUs / 8192 MB (its tasks ask 2 / 8192).
#                                      SWE-bench Pro: unset, so each task runs with its own settings (1 CPU / 4096 MB).
#   ENV_FILE [base_forum/.env]         must define MOONSHOT_API_KEY (or the key for your provider)
#   DEEPSWE_DIR [base_forum/.deep-swe]  SWEPRO_DIR [base_forum/.swebench-pro]   cloned there if missing
#   JOBS_DIR [base_forum/jobs]   JOB_NAME [<benchmark>-<mode>-<rulebook>-<UTC time>]
#
# Time: each task's own agent time limit ([agent] timeout_sec in its task.toml) is enforced by Pier; the runtime is told
# to stop 120 s before the shortest one, so it always writes its summary and hands over its work before Pier stops it.
# Commits: DeepSWE grades the committed diff, so the authority commits. SWE-bench Pro grades the working tree, so
# nobody commits (commit=false), and any commit an agent makes is undone at the end with its changes kept.
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
die() { echo "run_baseline: $*" >&2; exit 2; }

# A named dataset sets the tasks and the benchmark (scripts/datasets.py).
DATASET_REF=""
if [ -n "${DATASET:-}" ]; then
  [ -z "${TASKS:-}" ] || die "give DATASET or TASKS, not both"
  ds_tasks="$(mktemp "${TMPDIR:-/tmp}/decorum-dataset.XXXXXX")"
  ds_line="$(python3 "$BASE/scripts/datasets.py" resolve "$DATASET" --tasks-out "$ds_tasks")" || die "no dataset '$DATASET' (python3 base_forum/scripts/datasets.py list)"
  ds_bench="${ds_line%%$'\t'*}"; DATASET_REF="${ds_line#*$'\t'}"
  if [ -n "${BENCHMARK:-}" ] && [ "$BENCHMARK" != "$ds_bench" ]; then die "dataset $DATASET is $ds_bench, but BENCHMARK is $BENCHMARK"; fi
  BENCHMARK="$ds_bench"; TASKS="$ds_tasks"
fi
BENCHMARK="${BENCHMARK:-deepswe}"
MODE="${MODE:-forum}"
AUTHORITY_MODEL="${AUTHORITY_MODEL:-moonshotai/kimi-k3}"
WORKER_MODEL="${WORKER_MODEL:-moonshotai/kimi-k2.7-code}"
AUTHORITY_THINKING="${AUTHORITY_THINKING:-max}"
WORKER_THINKING="${WORKER_THINKING:-high}"
RULEBOOK="${RULEBOOK:-base-0}"
N_TASKS="${N_TASKS:-}"
CONCURRENCY="${CONCURRENCY:-2}"
RETRIES="${RETRIES:-0}"
ENV_FILE="${ENV_FILE:-$BASE/.env}"
DEEPSWE_DIR="${DEEPSWE_DIR:-$BASE/.deep-swe}"
SWEPRO_DIR="${SWEPRO_DIR:-$BASE/.swebench-pro}"
JOBS_DIR="${JOBS_DIR:-$BASE/jobs}"
MARGIN_SEC=120

case "$BENCHMARK" in
  deepswe)
    TASKS="${TASKS:-$BASE/tasks/baseline-10.tsv}"
    CPUS="${CPUS-4}"; MEMORY_MB="${MEMORY_MB-8192}"
    COMMIT=true ;;
  swebenchpro)
    TASKS="${TASKS:-$BASE/tasks/swebenchpro-10.tsv}"
    CPUS="${CPUS-}"; MEMORY_MB="${MEMORY_MB-}"
    COMMIT=false ;;
  *) die "BENCHMARK must be deepswe or swebenchpro, got '$BENCHMARK'" ;;
esac
case "$RETRIES" in ''|*[!0-9]*) die "RETRIES must be a whole number, got '$RETRIES'" ;; esac
for v in MIN_WORKERS MAX_WORKERS MAX_LIVE_WORKERS WORKERS; do
  if [ -n "${!v:-}" ] && ! [[ "${!v}" =~ ^[0-9]{1,3}$ ]]; then die "$v must be a whole number up to 999, got '${!v}'"; fi
done
if [ -n "${WORKERS:-}" ] && { [ "$WORKERS" -lt 1 ] || [ "$WORKERS" -gt 20 ]; }; then die "WORKERS must be from 1 to 20, got '$WORKERS'"; fi
if [ -n "${AGGREGATOR_RESERVE:-}" ] && ! [[ "$AGGREGATOR_RESERVE" =~ ^0(\.[0-9]+)?$ ]]; then die "AGGREGATOR_RESERVE must be a share from 0 to 0.9, got '$AGGREGATOR_RESERVE'"; fi
if [ -n "${BUDGET_USD:-}" ] && ! [[ "$BUDGET_USD" =~ ^[0-9]{1,6}(\.[0-9]+)?$ ]]; then die "BUDGET_USD must be a number of dollars, got '$BUDGET_USD'"; fi
if [ -n "${MIN_WORKERS:-}" ] && [ -n "${MAX_WORKERS:-}" ] && [ "$MIN_WORKERS" -gt "$MAX_WORKERS" ]; then
  die "MIN_WORKERS ($MIN_WORKERS) is more than MAX_WORKERS ($MAX_WORKERS)"
fi
case "$MODE" in
  forum) AGENT=decorum_pier:DecorumForum ;;
  single) AGENT=decorum_pier:DecorumSingle ;;
  vote) AGENT=decorum_pier:DecorumVote ;;
  peer-review) AGENT=decorum_pier:DecorumPeerReview ;;
  *) die "MODE must be forum, single, vote or peer-review, got '$MODE'" ;;
esac
JOB_NAME="${JOB_NAME:-${FAUX:+faux-}$BENCHMARK-$MODE-${DATASET:-$(basename "$RULEBOOK" .yaml)}-$(date -u +%Y%m%dT%H%M%SZ)}"

command -v pier >/dev/null || die "pier is not installed: uv tool install datacurve-pier --with-editable \"$BASE/pier_adapter\""
command -v docker >/dev/null && docker info >/dev/null 2>&1 || die "Docker is not running"
[ -f "$TASKS" ] || die "no task list at $TASKS"
env_args=()
if [ -f "$ENV_FILE" ]; then env_args=(--env-file "$ENV_FILE"); fi
if [ -z "${FAUX:-}" ]; then
  [ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE: create it with MOONSHOT_API_KEY=... (see base_forum/README.md)"
  for model in "$AUTHORITY_MODEL" $([ "$MODE" != single ] && echo "$WORKER_MODEL"); do
    case "${model%%/*}" in
      moonshotai|moonshotai-cn) key=MOONSHOT_API_KEY ;;
      openrouter) key=OPENROUTER_API_KEY ;;
      kimi-coding) key=KIMI_API_KEY ;;
      *) key="" ;;
    esac
    if [ -n "$key" ] && ! grep -qE "^(export +)?$key=." "$ENV_FILE"; then die "$ENV_FILE has no $key for $model"; fi
  done
fi

# Fetch the tasks the first time.
if [ "$BENCHMARK" = deepswe ]; then
  TASK_ROOT="$DEEPSWE_DIR/tasks"
  if [ ! -d "$TASK_ROOT" ]; then
    echo "cloning DeepSWE into $DEEPSWE_DIR"
    git clone --depth 1 https://github.com/datacurve-ai/deep-swe "$DEEPSWE_DIR"
  fi
else
  TASK_ROOT="$SWEPRO_DIR/v2/tasks"
  if [ ! -d "$TASK_ROOT" ]; then
    echo "fetching SWE-bench Pro V2's Harbor tasks (scaleapi/SWE-bench_Pro-os, v2/tasks) into $SWEPRO_DIR"
    git clone --depth 1 --filter=blob:none --sparse https://github.com/scaleapi/SWE-bench_Pro-os "$SWEPRO_DIR"
    git -C "$SWEPRO_DIR" sparse-checkout set v2/tasks
  fi
fi

ids=()  # no mapfile: macOS ships bash 3.2
while IFS= read -r id; do ids+=("$id"); done < <(awk -F'\t' '$1 != "" && $1 !~ /^#/ && $1 != "task" { print $1 }' "$TASKS")
[ "${#ids[@]}" -gt 0 ] || die "no tasks in $TASKS"
if [ -n "$N_TASKS" ]; then ids=("${ids[@]:0:$N_TASKS}"); fi
for id in "${ids[@]}"; do [ -f "$TASK_ROOT/$id/task.toml" ] || die "task $id is not in $TASK_ROOT"; done
if [ "$BENCHMARK" = swebenchpro ]; then
  # V2 grades with the network on in the agent's (offline) container; Pier cannot switch it between phases, so it
  # runs a copy whose only change is an offline verifier (see scripts/pier_tasks.py; checked with Pier's oracle).
  python3 "$BASE/scripts/pier_tasks.py" "$TASK_ROOT" "$SWEPRO_DIR/pier-tasks" "${ids[@]}" || die "could not prepare the tasks"
  TASK_ROOT="$SWEPRO_DIR/pier-tasks"
fi
include=()
limit=""
for id in "${ids[@]}"; do
  [ -f "$TASK_ROOT/$id/task.toml" ] || die "task $id is not in $TASK_ROOT"
  include+=(-i "$id")
  # [agent] timeout_sec of this task
  t=$(awk '/^\[/{s=$0} s=="[agent]" && /^timeout_sec[ \t]*=/{gsub(/[^0-9.]/,"",$0); print int($0); exit}' "$TASK_ROOT/$id/task.toml")
  if [ -n "$t" ] && { [ -z "$limit" ] || [ "$t" -lt "$limit" ]; }; then limit=$t; fi
done
[ -n "$limit" ] || die "no [agent] timeout_sec in the tasks' task.toml"
WALL_CLOCK_SEC=$((limit - MARGIN_SEC))

# The task images are linux/amd64; on Apple silicon Docker runs them under emulation.
export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"

cmd=(pier run -p "$TASK_ROOT" "${include[@]}"
  --agent-import-path "$AGENT" -m "$AUTHORITY_MODEL"
  --ak "rulebook=$RULEBOOK" --ak "authority_thinking=$AUTHORITY_THINKING"
  --ak "commit=$COMMIT" --ak "wall_clock_sec=$WALL_CLOCK_SEC"
  --env docker -n "$CONCURRENCY" -o "$JOBS_DIR" --job-name "$JOB_NAME" ${env_args[@]+"${env_args[@]}"} -y)
if [ -n "$CPUS" ]; then cmd+=(--override-cpus "$CPUS"); fi
if [ -n "$MEMORY_MB" ]; then cmd+=(--override-memory-mb "$MEMORY_MB"); fi
if [ "$MODE" != single ]; then cmd+=(--ak "worker_model=$WORKER_MODEL" --ak "worker_thinking=$WORKER_THINKING"); fi
if [ -n "${FAUX:-}" ]; then cmd+=(--ak "faux=$FAUX"); fi
if [ "$RETRIES" -gt 0 ]; then cmd+=(--max-retries "$RETRIES"); fi
if [ "$MODE" = forum ]; then
  if [ -n "${MIN_WORKERS:-}" ]; then cmd+=(--ak "min_workers=$MIN_WORKERS"); fi
  if [ -n "${MAX_WORKERS:-}" ]; then cmd+=(--ak "max_workers=$MAX_WORKERS"); fi
fi
if [ "$MODE" = vote ] || [ "$MODE" = peer-review ]; then
  if [ -n "${WORKERS:-}" ]; then cmd+=(--ak "workers=$WORKERS"); fi
  if [ -n "${AGGREGATOR_RESERVE:-}" ]; then cmd+=(--ak "aggregator_reserve=$AGGREGATOR_RESERVE"); fi
fi
if [ -n "$DATASET_REF" ]; then cmd+=(--ak "dataset=$DATASET_REF"); fi
if [ "$MODE" != single ] && [ -n "${MAX_LIVE_WORKERS:-}" ]; then cmd+=(--ak "max_live_workers=$MAX_LIVE_WORKERS"); fi
if [ -n "${BUDGET_USD:-}" ]; then cmd+=(--ak "budget_usd=$BUDGET_USD"); fi

case "$MODE" in
  forum) team="authority $AUTHORITY_MODEL ($AUTHORITY_THINKING), workers $WORKER_MODEL ($WORKER_THINKING)" ;;
  single) team="one agent, $AUTHORITY_MODEL ($AUTHORITY_THINKING)" ;;
  vote) team="${WORKERS:-5} workers $WORKER_MODEL ($WORKER_THINKING), aggregator $AUTHORITY_MODEL ($AUTHORITY_THINKING)" ;;
  peer-review) team="${WORKERS:-6} creators, reviewers and revisers $WORKER_MODEL ($WORKER_THINKING), aggregator $AUTHORITY_MODEL ($AUTHORITY_THINKING)" ;;
esac
echo "job $JOB_NAME: $BENCHMARK${DATASET_REF:+, dataset $DATASET_REF}, ${#ids[@]} tasks, mode $MODE, rulebook $RULEBOOK, $team"
echo "time limit: the tasks' ${limit} s (the runtime stops by ${WALL_CLOCK_SEC} s at the latest, sooner if the rulebook says so); commit: $COMMIT; sandbox: ${CPUS:-task default} CPUs, ${MEMORY_MB:-task default} MB"
printf '%q ' "${cmd[@]}"; echo
[ -n "${DRY_RUN:-}" ] && exit 0
mkdir -p "$JOBS_DIR"
echo "watch it live: python3 $BASE/viewer/forum_view.py --open --jobs $JOBS_DIR   (or in a terminal: python3 $BASE/scripts/watch.py $JOBS_DIR/$JOB_NAME)"
rc=0
"${cmd[@]}" || rc=$?
[ "$rc" -eq 0 ] || echo "run_baseline: pier exited with $rc; the summary below says which tasks have no result"
echo
python3 "$BASE/scripts/summarize.py" "$JOBS_DIR/$JOB_NAME" --reference "$TASKS" || true
exit "$rc"
