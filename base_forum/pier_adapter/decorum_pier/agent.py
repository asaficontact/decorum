"""Pier agents for the Decorum base forum.

``DecorumForum`` runs one trial of the base forum inside a Pier task sandbox: the authority agent and its
workers (pi sessions in one Node process, ``base_forum/runtime``) work in the task checkout, the rulebook is
enforced at every tool call, and the trial's trace lands in ``/logs/agent/decorum``. ``DecorumSingle`` runs
the same runtime with one agent and no forum, the single-agent condition the forum is compared with.

    pier run -p deep-swe/tasks --agent-import-path decorum_pier:DecorumForum \\
        -m moonshotai/kimi-k3 --ak worker_model=moonshotai/kimi-k2.7-code --ak rulebook=base-0

Build-time install (network open): Node and the runtime's npm dependencies, pinned by the runtime's
package-lock.json. Setup (network closed): the runtime's source and the rulebook are uploaded. Run: only the
model providers' API hosts are reachable, through Pier's egress proxy.
"""

from __future__ import annotations

import base64
import gzip
import json
import os
import shlex
import tempfile
from pathlib import Path
from typing import Any

from pier.agents.installed.base import BaseInstalledAgent, NonZeroAgentExitCodeError, with_prompt_template
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.install import AgentInstallSpec, InstallStep
from pier.models.agent.network import NetworkAllowlist
from pier.utils.trajectory_metrics import populate_context_from_final_metrics
from pier.utils.trajectory_utils import format_trajectory_json

from decorum_pier.atif import build_trajectory

BASE_FORUM_DIR = Path(os.environ.get("DECORUM_BASE_FORUM_DIR", Path(__file__).resolve().parents[2]))
RUNTIME_DIR = BASE_FORUM_DIR / "runtime"
RULEBOOKS_DIR = BASE_FORUM_DIR / "rulebooks"

NODE_VERSION = "24.21.0"
OPT = "/opt/decorum"
REMOTE = "/installed-agent/decorum"
OUT = "/logs/agent/decorum"

# Where each provider's API lives, for the run-time network allowlist, and the key pi reads for it.
PROVIDERS: dict[str, tuple[list[str], list[str]]] = {
    "moonshotai": (["api.moonshot.ai"], ["MOONSHOT_API_KEY"]),
    "moonshotai-cn": (["api.moonshot.cn"], ["MOONSHOT_API_KEY"]),
    "kimi-coding": (["api.kimi.com"], ["KIMI_API_KEY"]),
    "openrouter": (["openrouter.ai"], ["OPENROUTER_API_KEY"]),
    "fireworks": (["api.fireworks.ai"], ["FIREWORKS_API_KEY"]),
    "together": (["api.together.ai"], ["TOGETHER_API_KEY"]),
    "anthropic": (["api.anthropic.com"], ["ANTHROPIC_API_KEY"]),
    "openai": (["api.openai.com"], ["OPENAI_API_KEY"]),
    "faux": ([], []),
}

THINKING = {"off", "minimal", "low", "medium", "high", "xhigh", "max"}


def _provider(model: str) -> str:
    if "/" not in model:
        raise ValueError(f"A model is written provider/model-id (e.g. moonshotai/kimi-k3); got {model!r}")
    return model.split("/", 1)[0]


def _runtime_version() -> str:
    return json.loads((RUNTIME_DIR / "package.json").read_text())["version"]


def _resolve_rulebook(value: str) -> Path:
    """A rulebook is a name under base_forum/rulebooks (base-0) or a path to a YAML file."""
    named = RULEBOOKS_DIR / f"{value}.yaml"
    if named.is_file():
        return named
    path = Path(value).expanduser()
    if path.is_file():
        return path
    known = sorted(p.stem for p in RULEBOOKS_DIR.glob("*.yaml"))
    raise ValueError(f"No rulebook {value!r}: give a name ({', '.join(known)}) or a path to a YAML file")


class DecorumForum(BaseInstalledAgent):
    """The Decorum base forum: an authority agent that opens threads and assigns workers."""

    SUPPORTS_ATIF = True
    MODE = "forum"

    def __init__(
        self,
        *args: Any,
        worker_model: str | None = None,
        rulebook: str = "base-0",
        authority_thinking: str = "high",
        worker_thinking: str = "high",
        repo: str = "/app",
        faux: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.worker_model = worker_model
        self.rulebook_path = _resolve_rulebook(rulebook)
        self.authority_thinking = authority_thinking
        self.worker_thinking = worker_thinking
        self.repo = repo
        self.faux = faux
        for name, level in (("authority_thinking", authority_thinking), ("worker_thinking", worker_thinking)):
            if level not in THINKING:
                raise ValueError(f"{name} must be one of {sorted(THINKING)}; got {level!r}")
        if not faux:
            if not self.model_name:
                raise ValueError("Give the authority's model with -m provider/model-id, e.g. -m moonshotai/kimi-k3")
            if self.MODE == "forum" and not worker_model:
                raise ValueError("Give the workers' model with --ak worker_model=provider/model-id")
            for m in self._models():
                if _provider(m) not in PROVIDERS:
                    raise ValueError(f"Unknown provider for {m!r}; known: {', '.join(sorted(PROVIDERS))}")

    @staticmethod
    def name() -> str:
        return "decorum-forum"

    def version(self) -> str | None:
        return self._version or _runtime_version()

    def _models(self) -> list[str]:
        models = [self.model_name] if self.model_name else []
        if self.MODE == "forum" and self.worker_model:
            models.append(self.worker_model)
        return models

    # ---------- install (image build, network open) ----------

    def install_spec(self) -> AgentInstallSpec:
        manifest = {
            "package.json": (RUNTIME_DIR / "package.json").read_text(),
            "package-lock.json": (RUNTIME_DIR / "package-lock.json").read_text(),
        }
        bundle = base64.b64encode(gzip.compress(json.dumps(manifest).encode(), mtime=0)).decode()
        packages = (
            "if command -v apt-get >/dev/null; then "
            "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "
            "ca-certificates curl xz-utils git >/dev/null; "
            "elif command -v dnf >/dev/null; then dnf install -y -q ca-certificates curl xz git; "
            "elif command -v yum >/dev/null; then yum install -y -q ca-certificates curl xz git; fi"
        )
        node = (
            "arch=$(uname -m); case $arch in x86_64) a=x64;; aarch64|arm64) a=arm64;; "
            '*) echo "decorum: unsupported architecture $arch" >&2; exit 1;; esac; '
            f"mkdir -p {OPT}/node && "
            f"curl -fsSL https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-$a.tar.xz "
            f"| tar -xJ -C {OPT}/node --strip-components=1 && {OPT}/node/bin/node --version"
        )
        deps = (
            f"mkdir -p {OPT}/deps && cd {OPT}/deps && "
            f"echo {bundle} | base64 -d | gunzip | {OPT}/node/bin/node -e "
            "\"const m=JSON.parse(require('fs').readFileSync(0,'utf8'));"
            "for (const [k,v] of Object.entries(m)) require('fs').writeFileSync(k,v)\" && "
            f"PATH={OPT}/node/bin:$PATH npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error && "
            f"chmod -R a+rX {OPT}"
        )
        return AgentInstallSpec(
            agent_name=self.name(),
            version=_runtime_version(),
            steps=[
                InstallStep(user="root", run=f"set -euo pipefail; {packages}"),
                InstallStep(user="root", run=f"set -euo pipefail; {node}"),
                InstallStep(user="root", run=f"set -euo pipefail; {deps}"),
            ],
            verification_command=f"{OPT}/node/bin/node --version",
        )

    def get_version_command(self) -> str | None:
        return None

    # ---------- setup (sandbox started, network closed) ----------

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp) / "decorum"
            (stage / "src").mkdir(parents=True)
            for f in (RUNTIME_DIR / "src").glob("*.ts"):
                (stage / "src" / f.name).write_text(f.read_text())
            (stage / "package.json").write_text((RUNTIME_DIR / "package.json").read_text())
            (stage / "rulebook.yaml").write_text(self.rulebook_path.read_text())
            await environment.upload_dir(stage, REMOTE)
        await self.exec_as_root(
            environment,
            command=f"ln -sfn {OPT}/deps/node_modules {REMOTE}/node_modules && chmod -R a+rX {REMOTE} && "
            f"{OPT}/node/bin/node -e \"import('{REMOTE}/src/rulebook.ts').then(m => m.loadRulebook('{REMOTE}/rulebook.yaml'))\"",
        )

    def network_allowlist(self) -> NetworkAllowlist:
        domains: set[str] = set()
        for m in self._models():
            domains.update(PROVIDERS.get(_provider(m), ([], []))[0])
        return NetworkAllowlist(domains=sorted(domains))

    # ---------- run ----------

    def _command(self) -> str:
        args = [
            f"{OPT}/node/bin/node",
            f"{REMOTE}/src/main.ts",
            "run",
            "--instruction-file", f"{REMOTE}/instruction.md",
            "--repo", self.repo,
            "--out", OUT,
            "--mode", self.MODE,
            "--rulebook", f"{REMOTE}/rulebook.yaml",
            "--authority-thinking", self.authority_thinking,
            "--worker-thinking", self.worker_thinking,
            "--work-dir", "/tmp/decorum-work",
        ]  # fmt: skip
        if self.faux:
            args += ["--faux", self.faux]
        else:
            args += ["--authority-model", self.model_name or ""]
            if self.MODE == "forum":
                args += ["--worker-model", self.worker_model or ""]
        return " ".join(shlex.quote(a) for a in args)

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(instruction)
            local = f.name
        try:
            await environment.upload_file(local, f"{REMOTE}/instruction.md")
        finally:
            os.unlink(local)
        env = self.build_process_env({"NODE_USE_ENV_PROXY": "1", "PI_OFFLINE": "1", "PI_TELEMETRY": "0"})
        for m in self._models():
            for key in PROVIDERS.get(_provider(m), ([], []))[1]:
                if value := self._get_env(key):
                    env[key] = value
        await self.exec_as_root(environment, command=f"mkdir -p {OUT} && chmod a+r {REMOTE}/instruction.md")
        try:
            await self.exec_as_agent(
                environment,
                command=f"{self._command()} 2>&1 | tee {OUT}/stdout.txt",
                env=env,
            )
        except NonZeroAgentExitCodeError as e:
            raise NonZeroAgentExitCodeError(f"decorum runtime failed; see agent/decorum/stdout.txt. {e}") from e

    # ---------- after the run ----------

    def populate_context_post_run(self, context: AgentContext) -> None:
        out = self.logs_dir / "decorum"
        summary_path = out / "summary.json"
        if not summary_path.exists():
            self.logger.warning(f"decorum: no {summary_path}; the runtime did not finish")
            return
        try:
            summary = json.loads(summary_path.read_text())
            trajectory = build_trajectory(summary, out, agent_name=self.name(), version=self.version() or "unknown")
        except Exception:
            self.logger.exception("decorum: could not build the ATIF trajectory")
            return
        (self.logs_dir / "trajectory.json").write_text(format_trajectory_json(trajectory.to_json_dict()))
        if trajectory.final_metrics:
            populate_context_from_final_metrics(context, trajectory.final_metrics)
        context.metadata = {**(context.metadata or {}), "decorum": _context_metadata(summary)}


class DecorumSingle(DecorumForum):
    """The same runtime with one pi agent and no forum: the single-agent condition."""

    MODE = "single"

    @staticmethod
    def name() -> str:
        return "decorum-single"


def _context_metadata(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "mode": summary.get("mode"),
        "rulebook": (summary.get("rulebook") or {}).get("name"),
        "end_reason": summary.get("end_reason"),
        "auto_committed": summary.get("auto_committed"),
        "workers": sum(1 for a in summary.get("agents", []) if a.get("role") == "worker"),
        "forum": summary.get("forum"),
        "refusals": len(summary.get("refusals", [])),
    }
