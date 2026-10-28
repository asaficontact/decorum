#!/usr/bin/env bash
# Run the Decorum base forum (or the single-agent condition) on DeepSWE tasks with Pier and Docker.
#
#   base_forum/scripts/run_baseline.sh                 # the 10 baseline tasks, forum mode, Kimi K3 + K2.7-code
#   MODE=single base_forum/scripts/run_baseline.sh     # the same tasks, one Kimi K3 agent, no forum
#   N_TASKS=1 base_forum/scripts/run_baseline.sh       # just the first task, to check the setup
#   DRY_RUN=1 base_forum/scripts/run_baseline.sh       # print the pier command and stop
#   FAUX=smoke N_TASKS=1 base_forum/scripts/run_baseline.sh   # scripted agents, no key, no cost: checks Docker + Pier
#
# Settings (environment variables, defaults in brackets):
#   MODE [forum]                       forum | single
#   AUTHORITY_MODEL [moonshotai/kimi-k3]
#   WORKER_MODEL [moonshotai/kimi-k2.7-code]
#   AUTHORITY_THINKING [max]           off | minimal | low | medium | high | xhigh | max (the leaderboard ran K3 at max)
#   WORKER_THINKING [high]
#   RULEBOOK [base-0]                  a name under base_forum/rulebooks, or a path
#   TASKS [base_forum/tasks/baseline-10.tsv]   first column is the task id
#   N_TASKS [all]                      run only the first N tasks of the list
#   CONCURRENCY [2]                    trials at once
#   CPUS [4]  MEMORY_MB [8192]         per trial sandbox (the task default is 2 CPUs / 8 GB)
#   ENV_FILE [base_forum/.env]         must define MOONSHOT_API_KEY (or the key for your provider)
#   DEEPSWE_DIR [base_forum/.deep-swe] cloned here if missing
#   JOBS_DIR [base_forum/jobs]   JOB_NAME [<mode>-<rulebook>-<UTC time>]
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${MODE:-forum}"
AUTHORITY_MODEL="${AUTHORITY_MODEL:-moonshotai/kimi-k3}"
WORKER_MODEL="${WORKER_MODEL:-moonshotai/kimi-k2.7-code}"
AUTHORITY_THINKING="${AUTHORITY_THINKING:-max}"
WORKER_THINKING="${WORKER_THINKING:-high}"
RULEBOOK="${RULEBOOK:-base-0}"
TASKS="${TASKS:-$BASE/tasks/baseline-10.tsv}"
N_TASKS="${N_TASKS:-}"
CONCURRENCY="${CONCURRENCY:-2}"
CPUS="${CPUS:-4}"
MEMORY_MB="${MEMORY_MB:-8192}"
ENV_FILE="${ENV_FILE:-$BASE/.env}"
DEEPSWE_DIR="${DEEPSWE_DIR:-$BASE/.deep-swe}"
JOBS_DIR="${JOBS_DIR:-$BASE/jobs}"
JOB_NAME="${JOB_NAME:-${FAUX:+faux-}$MODE-$(basename "$RULEBOOK" .yaml)-$(date -u +%Y%m%dT%H%M%SZ)}"

die() { echo "run_baseline: $*" >&2; exit 2; }

case "$MODE" in
  forum) AGENT=decorum_pier:DecorumForum ;;
  single) AGENT=decorum_pier:DecorumSingle ;;
  *) die "MODE must be forum or single, got '$MODE'" ;;
esac

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

if [ ! -d "$DEEPSWE_DIR/tasks" ]; then
  echo "cloning DeepSWE into $DEEPSWE_DIR"
  git clone --depth 1 https://github.com/datacurve-ai/deep-swe "$DEEPSWE_DIR"
fi

ids=()  # no mapfile: macOS ships bash 3.2
while IFS= read -r id; do ids+=("$id"); done < <(awk -F'\t' 'NR > 1 && $1 != "" && $1 !~ /^#/ { print $1 }' "$TASKS")
[ "${#ids[@]}" -gt 0 ] || die "no tasks in $TASKS"
if [ -n "$N_TASKS" ]; then ids=("${ids[@]:0:$N_TASKS}"); fi
[ "${#ids[@]}" -gt 0 ] || die "no tasks in $TASKS"
include=()
for id in "${ids[@]}"; do
  [ -d "$DEEPSWE_DIR/tasks/$id" ] || die "task $id is not in $DEEPSWE_DIR/tasks"
  include+=(-i "$id")
done

# DeepSWE's images are linux/amd64; on Apple silicon Docker runs them under emulation.
export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"

cmd=(pier run -p "$DEEPSWE_DIR/tasks" "${include[@]}"
  --agent-import-path "$AGENT" -m "$AUTHORITY_MODEL"
  --ak "rulebook=$RULEBOOK" --ak "authority_thinking=$AUTHORITY_THINKING"
  --env docker --override-cpus "$CPUS" --override-memory-mb "$MEMORY_MB"
  -n "$CONCURRENCY" -o "$JOBS_DIR" --job-name "$JOB_NAME" ${env_args[@]+"${env_args[@]}"} -y)
if [ "$MODE" = forum ]; then cmd+=(--ak "worker_model=$WORKER_MODEL" --ak "worker_thinking=$WORKER_THINKING"); fi
if [ -n "${FAUX:-}" ]; then cmd+=(--ak "faux=$FAUX"); fi

echo "job $JOB_NAME: ${#ids[@]} tasks, mode $MODE, rulebook $RULEBOOK, authority $AUTHORITY_MODEL ($AUTHORITY_THINKING)$([ "$MODE" = forum ] && echo ", workers $WORKER_MODEL ($WORKER_THINKING)")"
printf '%q ' "${cmd[@]}"; echo
[ -n "${DRY_RUN:-}" ] && exit 0
mkdir -p "$JOBS_DIR"
echo "watch it live: python3 $BASE/viewer/forum_view.py --open --jobs $JOBS_DIR   (or in a terminal: python3 $BASE/scripts/watch.py $JOBS_DIR/$JOB_NAME)"
"${cmd[@]}"
echo
python3 "$BASE/scripts/summarize.py" "$JOBS_DIR/$JOB_NAME" --reference "$TASKS"
