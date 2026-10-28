#!/usr/bin/env bash
# Run the Decorum base forum (or the single-agent condition) on DeepSWE or SWE-bench Pro tasks with Pier and Docker.
#
#   base_forum/scripts/run_baseline.sh                          # DeepSWE: the 10 baseline tasks, forum mode
#   BENCHMARK=swebenchpro base_forum/scripts/run_baseline.sh    # SWE-bench Pro V2: the 10 tasks in tasks/swebenchpro-10.tsv
#   MODE=single base_forum/scripts/run_baseline.sh              # the same tasks, one agent, no forum
#   N_TASKS=1 base_forum/scripts/run_baseline.sh                # just the first task, to check the setup
#   DRY_RUN=1 base_forum/scripts/run_baseline.sh                # print the pier command and stop
#   FAUX=smoke N_TASKS=1 base_forum/scripts/run_baseline.sh     # scripted agents, no key, no cost: checks Docker + Pier
#
# Settings (environment variables, defaults in brackets):
#   BENCHMARK [deepswe]                deepswe | swebenchpro (SWE-bench Pro V2, Scale's Harbor tasks)
#   MODE [forum]                       forum | single
#   AUTHORITY_MODEL [moonshotai/kimi-k3]
#   WORKER_MODEL [moonshotai/kimi-k2.7-code]
#   AUTHORITY_THINKING [max]           off | minimal | low | medium | high | xhigh | max (the leaderboard ran K3 at max)
#   WORKER_THINKING [high]
#   RULEBOOK [base-0]                  a name under base_forum/rulebooks, or a path
#   TASKS [per benchmark]              a TSV whose first column is the task id (# lines and the header are skipped)
#   N_TASKS [all]                      run only the first N tasks of the list
#   CONCURRENCY [2]                    trials at once
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

die() { echo "run_baseline: $*" >&2; exit 2; }

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
case "$MODE" in
  forum) AGENT=decorum_pier:DecorumForum ;;
  single) AGENT=decorum_pier:DecorumSingle ;;
  *) die "MODE must be forum or single, got '$MODE'" ;;
esac
JOB_NAME="${JOB_NAME:-${FAUX:+faux-}$BENCHMARK-$MODE-$(basename "$RULEBOOK" .yaml)-$(date -u +%Y%m%dT%H%M%SZ)}"

command -v pier >/dev/null || die "pier is not installed: uv tool install datacurve-pier --with-editable \"$BASE/pier_adapter\""
command -v docker >/dev/null && docker info >/dev/null 2>&1 || die "Docker is not running"
[ -f "$TASKS" ] || die "no task list at $TASKS"
env_args=()
if [ -f "$ENV_FILE" ]; then env_args=(--env-file "$ENV_FILE"); fi
if [ -z "${FAUX:-}" ]; then
  [ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE: create it with MOONSHOT_API_KEY=... (see base_forum/README.md)"
  for model in "$AUTHORITY_MODEL" $([ "$MODE" = forum ] && echo "$WORKER_MODEL"); do
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
if [ "$MODE" = forum ]; then cmd+=(--ak "worker_model=$WORKER_MODEL" --ak "worker_thinking=$WORKER_THINKING"); fi
if [ -n "${FAUX:-}" ]; then cmd+=(--ak "faux=$FAUX"); fi
if [ "$RETRIES" -gt 0 ]; then cmd+=(--max-retries "$RETRIES"); fi

echo "job $JOB_NAME: $BENCHMARK, ${#ids[@]} tasks, mode $MODE, rulebook $RULEBOOK, authority $AUTHORITY_MODEL ($AUTHORITY_THINKING)$([ "$MODE" = forum ] && echo ", workers $WORKER_MODEL ($WORKER_THINKING)")"
echo "time limit: the tasks' ${limit} s (the runtime stops by ${WALL_CLOCK_SEC} s at the latest, sooner if the rulebook says so); commit: $COMMIT; sandbox: ${CPUS:-task default} CPUs, ${MEMORY_MB:-task default} MB"
printf '%q ' "${cmd[@]}"; echo
[ -n "${DRY_RUN:-}" ] && exit 0
mkdir -p "$JOBS_DIR"
echo "watch it live: python3 $BASE/viewer/forum_view.py --open --jobs $JOBS_DIR   (or in a terminal: python3 $BASE/scripts/watch.py $JOBS_DIR/$JOB_NAME)"
"${cmd[@]}" || echo "run_baseline: pier exited with $?; the summary below says which tasks have no result"
echo
python3 "$BASE/scripts/summarize.py" "$JOBS_DIR/$JOB_NAME" --reference "$TASKS"
