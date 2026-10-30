"""Turn a decorum trial (summary.json + one pi session file per agent) into one ATIF trajectory.

The authority is the root trajectory; each worker is an embedded subagent trajectory, referenced from the
assign_workers call that started it. The forum itself (forum.jsonl) stays beside the trajectory as the
trial's coordination trace. In a majority vote the aggregator is the root and the workers are its subagents.
"""

from __future__ import annotations

import json
import re
from datetime import UTC
from pathlib import Path
from typing import Any

from pier.models.trajectories import (
    Agent,
    FinalMetrics,
    Metrics,
    Observation,
    ObservationResult,
    Step,
    SubagentTrajectoryRef,
    ToolCall,
    Trajectory,
)


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def _iso(ms: Any) -> str | None:
    if not isinstance(ms, (int, float)):
        return None
    from datetime import datetime

    return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()


def session_steps(path: Path, worker_names: set[str]) -> tuple[list[Step], dict[str, Any]]:
    """Steps from one pi session file, plus the session's id and summed usage."""
    steps: list[Step] = []
    session_id: str | None = None
    totals = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0.0, "calls": 0, "peak": 0}
    pending: dict[str, Step] = {}  # tool call id -> the agent step that made it
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if entry.get("type") == "session":
            session_id = entry.get("id")
            continue
        if entry.get("type") != "message":
            continue
        msg = entry["message"]
        role = msg.get("role")
        ts = _iso(msg.get("timestamp")) or entry.get("timestamp")
        if role == "user":
            steps.append(Step(step_id=len(steps) + 1, timestamp=ts, source="user", message=_text(msg.get("content"))))
        elif role == "assistant":
            content = msg.get("content") or []
            calls = [
                ToolCall(tool_call_id=c["id"], function_name=c["name"], arguments=c.get("arguments") or {})
                for c in content
                if isinstance(c, dict) and c.get("type") == "toolCall"
            ]
            thinking = "\n".join(
                c.get("thinking", "") for c in content if isinstance(c, dict) and c.get("type") == "thinking"
            ).strip()
            u = msg.get("usage") or {}
            prompt = (u.get("input") or 0) + (u.get("cacheRead") or 0) + (u.get("cacheWrite") or 0)
            cost = (u.get("cost") or {}).get("total")
            totals["input"] += u.get("input") or 0
            totals["output"] += u.get("output") or 0
            totals["cacheRead"] += u.get("cacheRead") or 0
            totals["cacheWrite"] += u.get("cacheWrite") or 0
            totals["cost"] += cost or 0.0
            totals["calls"] += 1
            totals["peak"] = max(totals["peak"], prompt)
            step = Step(
                step_id=len(steps) + 1,
                timestamp=ts,
                source="agent",
                model_name=f"{msg.get('provider')}/{msg.get('model')}" if msg.get("model") else None,
                message=_text(content),
                reasoning_content=thinking or None,
                tool_calls=calls or None,
                metrics=Metrics(
                    prompt_tokens=prompt or None,
                    completion_tokens=u.get("output"),
                    cached_tokens=u.get("cacheRead") or None,
                    cost_usd=cost,
                    extra={
                        k: v
                        for k, v in {
                            "cache_write_tokens": u.get("cacheWrite"),
                            "stop_reason": msg.get("stopReason"),
                            "error": msg.get("errorMessage"),
                        }.items()
                        if v
                    },
                ),
                llm_call_count=1,
            )
            steps.append(step)
            for c in calls:
                pending[c.tool_call_id] = step
        elif role == "toolResult":
            step = pending.get(msg.get("toolCallId"))
            if step is None:
                continue
            text = _text(msg.get("content"))
            refs = None
            if msg.get("toolName") == "assign_workers" and not msg.get("isError"):
                started = [
                    n for n in re.findall(r"\b([a-z][a-z0-9-]{0,23})\b", text.split(" on ")[0]) if n in worker_names
                ]
                refs = [SubagentTrajectoryRef(trajectory_id=n) for n in dict.fromkeys(started)] or None
            result = ObservationResult(
                source_call_id=msg.get("toolCallId"),
                content=text,
                subagent_trajectory_ref=refs,
                extra={"is_error": True} if msg.get("isError") else None,
            )
            if step.observation is None:
                step.observation = Observation(results=[result])
            else:
                step.observation.results.append(result)
    return steps, {"session_id": session_id, **totals}


def build_trajectory(summary: dict[str, Any], out_dir: Path, *, agent_name: str, version: str) -> Trajectory:
    agents = summary.get("agents") or []
    workers = {a["name"] for a in agents if a.get("role") == "worker"}
    built: dict[str, tuple[list[Step], dict[str, Any]]] = {}
    for a in agents:
        f = a.get("session_file")
        built[a["name"]] = (
            session_steps(out_dir / f, workers) if f and (out_dir / f).exists() else ([], {"session_id": None})
        )

    def trajectory(a: dict[str, Any], *, root: bool) -> Trajectory:
        steps, t = built.get(a["name"], ([], {"session_id": None}))
        u = a.get("usage") or {}
        return Trajectory(
            schema_version="ATIF-v1.7",
            session_id=t.get("session_id") or a["name"],
            trajectory_id=None if root else a["name"],
            agent=Agent(
                name=agent_name if root else f"{agent_name}:{a['name']}",
                version=version,
                model_name=a.get("model"),
                extra={
                    "role": a.get("role"),
                    "thinking": a.get("thinking"),
                    "assignment": a.get("assignment"),
                    "branch": a.get("branch"),
                },
            ),
            steps=steps or [Step(step_id=1, source="system", message=f"{a['name']} produced no session messages")],
            final_metrics=FinalMetrics(
                total_prompt_tokens=(u.get("input", 0) + u.get("cacheRead", 0) + u.get("cacheWrite", 0)) or None,
                total_completion_tokens=u.get("output") or None,
                total_cached_tokens=u.get("cacheRead") or None,
                total_cost_usd=u.get("costUsd"),
                total_steps=len(steps),
                extra={"llm_calls": u.get("llmCalls"), "peak_context_tokens": t.get("peak") or None},
            ),
        )

    lead = "aggregator" if summary.get("mode") == "vote" else "authority"
    authority = next((a for a in agents if a.get("role") == lead), None)
    if authority is None and lead == "aggregator":
        # the trial stopped before the aggregator started: the root is an empty aggregator
        authority = {"name": "aggregator", "role": "aggregator", "model": (summary.get("models") or {}).get("authority")}
    if authority is None:
        raise ValueError("summary.json names no authority agent")
    root = trajectory(authority, root=True)
    subs = [trajectory(a, root=False) for a in agents if a.get("role") == "worker"]
    if subs:
        root.subagent_trajectories = subs
    tok = summary.get("tokens") or {}
    root.final_metrics = FinalMetrics(
        total_prompt_tokens=(tok.get("input", 0) + tok.get("cache_read", 0) + tok.get("cache_write", 0)) or None,
        total_completion_tokens=tok.get("output") or None,
        total_cached_tokens=tok.get("cache_read") or None,
        total_cost_usd=summary.get("cost_usd"),
        total_steps=sum(len(built[a["name"]][0]) for a in agents),
        extra={
            "peak_context_tokens": max((built[a["name"]][1].get("peak") or 0 for a in agents), default=0) or None,
            "llm_calls": summary.get("llm_calls"),
            "end_reason": summary.get("end_reason"),
            "mode": summary.get("mode"),
            "rulebook": (summary.get("rulebook") or {}).get("name"),
            "forum": summary.get("forum"),
            "auto_committed": summary.get("auto_committed"),
            "vote": summary.get("vote"),
        },
    )
    root.notes = f"decorum {summary.get('mode')} trial, rulebook {(summary.get('rulebook') or {}).get('name')}, ended: {summary.get('end_reason')}. Forum trace: agent/decorum/forum.jsonl."
    return root
