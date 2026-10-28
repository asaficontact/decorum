#!/usr/bin/env bash
# Grade a finished trial's patch by hand, the way DeepSWE's verifier does, when Pier's own verifier step failed.
#
#   base_forum/scripts/regrade.sh <job>/<trial> [deep-swe tasks dir]
#
# Builds the task's verifier image (tests/Dockerfile), mounts a copy of <trial>/artifacts/model.patch, runs
# /tests/test.sh with no network, and writes <trial>/regrade/reward.json. Needed on rootless Docker, where Pier
# cannot copy the patch into the verifier ("failed to Lchown model.patch"); Docker Desktop does not need it.
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIAL="${1:?usage: regrade.sh <job>/<trial> [deep-swe tasks dir]}"
TASKS_DIR="${2:-$BASE/.deep-swe/tasks}"
[ -f "$TRIAL/result.json" ] || { echo "regrade: no result.json in $TRIAL" >&2; exit 2; }
task=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["task_name"].split("/")[-1])' "$TRIAL/result.json")
[ -d "$TASKS_DIR/$task/tests" ] || { echo "regrade: no task $task under $TASKS_DIR" >&2; exit 2; }
[ -f "$TRIAL/artifacts/model.patch" ] || { echo "regrade: $TRIAL has no artifacts/model.patch (the agent produced no commits?)" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/artifacts" "$work/verifier"
cp "$TRIAL/artifacts/model.patch" "$work/artifacts/"
chmod -R a+rwX "$work"
image="decorum-regrade-$task"
docker build -q --platform linux/amd64 -t "$image" "$TASKS_DIR/$task/tests" >/dev/null
docker run --rm --platform linux/amd64 --network none \
  -v "$work/artifacts:/logs/artifacts" -v "$work/verifier:/logs/verifier" "$image" bash /tests/test.sh > "$work/verifier/stdout.txt" 2>&1 || true
mkdir -p "$TRIAL/regrade"
cp -r "$work/verifier/." "$TRIAL/regrade/"
reward=$(cat "$TRIAL/regrade/reward.json" 2>/dev/null || cat "$TRIAL/regrade/reward.txt" 2>/dev/null || echo missing)
echo "$task: $reward"
