# Enforcing rules in the harness vs. stating them in the prompt

This group of work asks whether an LLM agent's rules should live in its prompt (system prompt, constitution, `AGENTS.md`/`CLAUDE.md`) or in the runtime around it: a tool boundary, a reference monitor, a hook, or a governance interpreter that sees each proposed action and allows, blocks, rewrites or sanctions it. What the evidence says is fairly consistent but not unconditional. Rules stated only in prompts decay with conversation depth: prohibitions fall from 73% to 33% compliance between turn 5 and turn 16 while requirements hold at 100% (2604.20911). Prompted rules are also bypassed under optimisation pressure or adversaries: a prompt-only anti-collusion constitution gives no reliable improvement over ungoverned agents, while an enforced governance graph cuts severe collusion from 50% to 5.6% (2601.11369). They are also ignored when they arrive as messages; an in-band halt stopped 0/20 runs for two OpenAI models (2606.06460). Enforced versions reach 88–100% compliance and often raise useful task completion too: `AGENTS.md` compliance goes from 67.0% to 88.3% (2603.00822), conformance from 77.4% to 100% for Claude Sonnet 4.5 (2512.23738), and the trace-failure rate falls from 57.6% to 0.2% (2608.27646). The gain depends on the enforcement giving a path to recovery after a block (2606.04306, 2608.09828). The strongest counter-evidence is POLIS (2608.09828). In a short (≤6 actions), temperature-0, single-planner delegation workflow, a detailed constitutional prompt matched a provenance-aware guard at 0/384 violations. A guard that trusted mutable local state did worse than the prompt (22/384). So "enforced beats prompted" holds when horizons are long, pressure is high or an adversary is present, and when the guard checks the right state; it is not a law. Prompted-vs-enforced comparisons in multi-agent settings already exist: competitive Cournot duopolies (2601.11369), a three-role delegation workflow where only the planner is an LLM (2608.09828), and single bilateral negotiation (2606.04306). No one has run this comparison in a **cooperative, manager-led harness where a main agent spawns subagents that share threads and hand off tasks over long horizons**. No one has measured it against saboteur or prompt-injected subagents in that harness. And, among the papers found for this theme, no one has **optimised the enforced rule set automatically** against task success. The closest is 2601.11369, which selected its governance manifest's parameters by a staged screening sweep and factorial ablation against collusion outcomes, then froze them. Every system in this group hand-authors its rules (Agent-C, XFlow, OCL, OBPE), compiles them from a fixed natural-language policy (ContextCov), or generates them once with an LLM and scores them against risk labels, not task success (AgentSpec). In 2609.22600 the governed agents themselves author and vote on executable rules, but with no outer-loop optimizer and in a common-pool game. Most evaluate single-agent or two-party settings. Decorum fills that gap: an evolved, enforced rulebook in a multi-agent coordination harness, with a same-rulebook prompted-vs-enforced ablation.

| Paper | Year | Venue | arXiv | What it is | Role for Decorum |
|---|---|---|---|---|---|
| Multi-Agent AI Safety as an Institutional Design Problem (POLIS) | 2026 | preprint | [2608.09828](https://arxiv.org/abs/2608.09828) | 5,280-episode study: prompts vs executable guards in a multi-role delegation workflow | closest work |
| Institutional AI: Governing LLM Collusion via Public Governance Graphs | 2026 | preprint | [2601.11369](https://arxiv.org/abs/2601.11369) | Prompt-only constitution vs runtime-enforced governance manifest in multi-agent Cournot markets | closest work |
| XFlow: Executable Protocol Programming for Multi-Agent Workflows | 2026 | preprint | [2606.14790](https://arxiv.org/abs/2606.14790) | DSL that moves workflow commitments from prompts into enforced harness state | closest work |
| Organizational Control Layer (OCL) | 2026 | preprint | [2606.04306](https://arxiv.org/abs/2606.04306) | Execution-boundary governance layer; six-arm ablation prompt-policy vs block vs block+recover | evidence for a design choice |
| ContextCov | 2026 | preprint | [2603.00822](https://arxiv.org/abs/2603.00822) | Compiles `AGENTS.md` into AST checks, shell shims and architecture validators; SWE-bench Lite | evidence for a design choice / benchmark candidate |
| Omission Constraints Decay While Commission Constraints Persist | 2026 | preprint | [2604.20911](https://arxiv.org/abs/2604.20911) | 4,416-trial study of system-prompt constraint decay over conversation depth | evidence for a design choice |
| Will the Agent Recuse, and Will It Stop? | 2026 | preprint | [2606.06460](https://arxiv.org/abs/2606.06460) | Cooperative in-band stop signals vs a harness-level interceptor | evidence for a design choice |
| Enforcing Temporal Constraints for LLM Agents (Agent-C) | 2025 | preprint | [2512.23738](https://arxiv.org/abs/2512.23738) | Temporal-policy DSL → SMT, enforced during decoding; τ-bench retail/airline | baseline (enforcement mechanism) |
| Out-of-Band Policy Enforcement at a Trusted Tool Boundary (OBPE) | 2026 | preprint | [2608.27646](https://arxiv.org/abs/2608.27646) | Cedar-policy proxy outside agent reasoning; prompted agents with vs without | evidence for a design choice / threat model |
| AgentLTL | 2026 | preprint | [2607.02599](https://arxiv.org/abs/2607.02599) | FO-LTL over agent traces: score, gate tool calls online, or use as RL reward | baseline (spec language) |
| AgentSpec | 2026 | ICSE 2026 | [2503.18666](https://arxiv.org/abs/2503.18666) | Trigger/predicate/enforcement DSL for runtime rules on LLM agents | background / baseline |
| Guardrails Beat Guidance | 2026 | preprint | [2604.11088](https://arxiv.org/abs/2604.11088) | 5,000+ Claude Code runs with 679 scraped rule files on SWE-bench Verified | evidence for a design choice (the `norms:` field) |

Practical mechanism (link only): Claude Code hooks reference, https://code.claude.com/docs/en/hooks. It lists blocking events, among them `PreToolUse`, `TaskCreated`, `TaskCompleted`, `SubagentStop` and `Stop`. Agent SDK hooks are at https://code.claude.com/docs/en/agent-sdk/hooks. These are the hooks Decorum's enforced primitives can sit on: a closing rule as a `TaskCompleted` hook, a visibility rule as a `PreToolUse` check on the thread-read tool.

Number tags: [abs] means the number is from the abstract; [full] means I read it in the full text (tables or results section).

---

## 1. POLIS: Multi-Agent AI Safety as an Institutional Design Problem

Abdullah X. *Multi-Agent AI Safety as an Institutional Design Problem.* arXiv:2608.09828, 2026. https://arxiv.org/abs/2608.09828 · code: https://github.com/abdullah-x-bd/polis

**Summary.** Planner agent A, acting for principal Alpha, routes a restricted artifact to an internal specialist B (compliant) or to an external specialist C at principal Beta (more valuable, but forbidden without approval). The study puts six "institutions" around this fixed workflow: none, a concise prompt, a constitutional prompt, a provenance prompt, a local executable guard that checks mutable visible policy, and a provenance guard that checks the immutable originating authority. "Pressure" lowers the payoff of the compliant route. A denied action returns control to the planner, so recovery after a block is measured. The design was pre-specified and frozen; four model families, temperature 0, at most six actions per episode.

**Key numbers.**
- No institution: realized violations 46/384 (12.0%), rising 6.46 pp per pressure level (0% → 20.8%) [full].
- Constitutional prompt: 0/384 violations, 365/384 compliant completion. Provenance guard: 0/384, 367/384. Local guard: 22/384 (5.7%). Concise prompt: 27/384 (7.0%) [full, Table 4].
- The same zero hides different mechanisms. Under the constitutional prompt the agent never attempts a prohibited action. Under the provenance guard it attempts one in 51/384 episodes, every attempt is blocked, and 44/51 later complete safely (86.3%). Under the local guard, 8/32 blocked episodes still end in a violation [full, Table 5].
- In laundering scenarios (a relabel/transform makes visible policy permissive), the local guard admits 22/96 violations and the provenance guard 0/96, p = 4.77e-7 [abs].
- Consistency of violations across three equivalent wordings: 63.5% (none), 95.8% (constitutional), 100% (provenance guard) [full].
- Additional-model diagnostic: no institution 40.3% violation, local guard 13.9% (Claude Sonnet 4.5 alone: 25.0%), constitutional and provenance guard both 0% [full].

**Relation to Decorum.** This is the nearest prompted-vs-enforced ablation in a multi-role setting, and it warns against assuming the answer. On a short horizon, a well-written prompt can be as safe as enforcement. Decorum's E2 ablation must therefore keep the rule *information* identical between arms; POLIS admits its prompt and guard arms differ in information as well as mechanism. It should also report attempts, realized violations and recovery separately. Its laundering result applies directly to Decorum's visibility and handoff primitives: they must check provenance (the thread of origin and the inherited history), not a state that a subagent can rewrite.

**Limitation.** It is "multi-agent" only nominally. Delegation is terminal and only the planner is an LLM. Episodes have at most six actions and there are no adversarial agents, so it cannot speak to long-horizon decay or saboteurs.

## 2. Institutional AI: governance graphs vs constitutional prompts

Bracale Syrnikov, M., Pierucci, F., Galisai, M., Prandi, M., Bisconti, P., Giarrusso, F., Sorokoletova, O., Suriani, V., Nardi, D. *Institutional AI: Governing LLM Collusion in Multi-Agent Cournot Markets via Public Governance Graphs.* arXiv:2601.11369, 2026. https://arxiv.org/abs/2601.11369

**Summary.** LLM firms in a repeated two-commodity Cournot duopoly tend to collude by dividing the market. The paper compares three regimes: Ungoverned; Constitutional, a fixed anti-collusion constitution injected into each firm's prompt; and Institutional. In the Institutional regime a public, immutable *governance manifest* declares states, transitions, sanctions (a fine ladder, suspension) and restorative paths (compliance credits). An Oracle turns public market evidence into cases, and a Controller applies only the transitions the manifest declares, while writing an append-only governance log. The manifest's parameters (fine schedule, credit timing, tier persistence) were picked by a staged screening sweep plus a factorial ablation, then frozen by digest before the reported runs.

**Key numbers.**
- Across six model configurations, three of them cross-provider pairs, with N = 90 runs per condition: mean collusion tier is 3.10 (ungoverned), 3.02 (constitutional) and 1.82 (institutional), d = 1.28, p = 4.67e-15 [full, Table 6] (abstract rounds to 3.1 → 1.8 [abs]).
- Tier ≥4 (severe collusion): 50.0% / 44.4% / 5.6% [full]. For GPT-5 Mini the constitutional prompt was *worse* than ungoverned [full].
- Enforcement activity over 90 institutional runs: 303 warnings, 427 fines, 12 suspensions [full].

**Relation to Decorum.** This is the closest prior design to Decorum's rulebook: a declarative, versioned, diffable manifest interpreted by a runtime outside the LLM, with a prompt-only control arm, in a multi-agent setting. It is a novelty threat on "enforced rules beat prompted rules in multi-agent LLM systems." That claim must not be framed as new. Decorum differs in three ways. Its setting is cooperative task-solving in a manager-led harness, not competitive firms. It enforces mainly by *regimentation* (tools refuse) rather than sanctions. And its rulebook is *optimised automatically* against task success, where here the manifest was hand-screened; the authors list meta-governance as future work.

**Limitation.** Only a two-firm market with no explicit communication channel. The thresholds are fixed proxies that the authors say may be Goodharted. And the institution's parameters were tuned on the same environment they are evaluated on (though the reported runs came after the lock).

## 3. XFlow: executable protocols for multi-agent workflows

Li, H., Peng, J., Wang, Z., Chen, L., Yu, K. *XFlow: An Executable Protocol Programming System for Reliable Multi-Agent Workflows.* arXiv:2606.14790, 2026. https://arxiv.org/abs/2606.14790

**Summary.** XFlow names the problem Decorum works on: the "underspecified prompt–harness boundary". Which workflow commitments stay in prompts, and which become harness structure? XPF is a literate protocol language whose fenced blocks compile into typed symbols with lifecycle and commit policies, actor read/write channels, stage graphs, handoffs and recovery frames. Actor outputs are validated before they become shared state, instead of spreading through transcripts. The authors evaluate on τ³-bench, CorpusQA and SWE-bench Verified, wrapping ReAct and mini-SWE-agent baselines.

**Key numbers.**
- τ³-bench, Qwen3.5-9B: compliance 96.5→100% (retail), 91.8→100% (airline), 77.2→82.5% (telecom), with pass^1 within −2.3 to +0.8 pp [full, Table 2].
- DeepSeek-V4-Flash, telecom: compliance 63.7→100%, conditional pass 63.1→100% [full].
- SWE-bench Verified with mini-SWE-agent and DeepSeek-V4-Flash: 77.4→79.8% [full, Table 3].

**Relation to Decorum.** Decorum's read/write visibility rules, handoff rules and closing-with-evidence rule are the same kind of commitment that XFlow lifts into harness state. XFlow shows that doing so does not cost task success. Decorum differs in that topology is not written down: the main agent spawns subagents at runtime, and the rulebook governs interaction, not a fixed stage graph. Decorum also evolves the rules.

**Limitation.** The baseline is a bare ReAct / mini-SWE-agent (Table 2 caption). On τ³-bench that baseline presumably sees the benchmark's natural-language domain policy (τ-bench convention; the paper does not say), but nothing matches its information to the XFlow protocol, so the prompted-vs-enforced effect is not isolated. Protocols are hand-authored per workflow, and most experiments wrap one agent rather than a multi-agent team.

## 4. Organizational Control Layer (OCL)

Shi, T., Mo, Y., Liu, Y., Hao, Z., Wang, Y., Hu, W., Yu, N., Zhou, M., Yu, J. *Organizational Control Layer: Governance Infrastructure at the Execution Boundary of LLM Agent Systems.* arXiv:2606.04306, 2026. https://arxiv.org/abs/2606.04306

**Summary.** OCL separates proposing an action from executing it. Each LLM-proposed action is checked against role, policy and economic constraints, then approved, revised (deterministic replan, e.g. a price clamped to the floor), blocked or escalated. The evaluation uses 50 adversarial buyer personas against a seller agent in an AgenticPay-derived negotiation, across GPT-5.4, Gemini-3.1 and Qwen-3.5, and compares against ToolGuard.

**Key numbers.**
- GPT-5.4: unsafe rate 88% → 0%, valid success 12% → 96% [abs; the abstract says "across multiple frontier LLM backends", but Table 1 shows these are the main GPT-5.4 run — validation] (205 executed violations → 0 [full]).
- Six-arm ablation [full, Table 2], executed violations / valid success: no control 94% / 6%; **prompt-policy reminders 98% / 2%**; price-floor guard 42% / 50%; reference monitor 0% / 62%; OCL without replan 0% / 60%; OCL full 0% / 94%.
- Intercept rate is backend-dependent: GPT-5.4 94%, Gemini-3.1 82%, Qwen-3.5 60% [full].

**Relation to Decorum.** This is the cleanest three-way split: prompted, enforced-block-only, and enforced-plus-recovery. Blocking alone is safe but loses about a third of valid outcomes. Decorum's primitives should return actionable refusals (why the close was rejected, what evidence is missing), and E2 should report task success under enforcement, not only violation rates.

**Limitation.** One bilateral negotiation, and only the seller side is governed. The personas were synthesised by an LLM, and the recovery rule (clamping) is domain-specific.

## 5. ContextCov

Sharma, R. K. *ContextCov: Deriving and Enforcing Executable Constraints from Agent Instruction Files.* arXiv:2603.00822, 2026. https://arxiv.org/abs/2603.00822 · code: https://github.com/reSHARMA/ContextCov

**Summary.** An LLM extracts constraints from an `AGENTS.md` and compiles them into three check types: static AST queries, runtime shell shims that intercept forbidden commands, and architectural validators. The checks run while the agent works and return reproducible violation traces so it can self-correct. It is compared to "Vanilla", where the agent has `AGENTS.md` in context, and to LLM Reflection, on SWE-bench Lite (12 repositories, 300 tasks).

**Key numbers.**
- Constraint compliance: 88.3% (ContextCov) vs 67.0% (prompt-only) vs 50.3% (LLM reflection), with 3.4× lower feedback cost [abs].
- Functional resolution: 57.3% vs 53.0% (vanilla) vs 52.3% (reflection); the ContextCov–Vanilla McNemar test gives p = 0.031 [full, Table 3].

**Relation to Decorum.** This is the direct single-agent version of Decorum's prompted-vs-enforced arm, in the same domain (coding) and from the same kind of source (an instruction file). It shows enforcement improving compliance without hurting resolution, and that *LLM reflection is worse than plain prompting*. That is a caution for any rule enforced by an LLM judge, such as an LLM-checked "evidence" adapter.

**Limitation.** The study covers one agent on Python repositories. Many of the instruction files were generated for repositories that lacked one, and false positives were judged by a single LLM.

## 6. Omission constraints decay

Gamage, Y. *Omission Constraints Decay While Commission Constraints Persist in Long-Context LLM Agents.* arXiv:2604.20911, 2026. https://arxiv.org/abs/2604.20911

**Summary.** A three-arm causal study (4,416 trials, 12 models, 8 providers, six conversation depths) of operator constraints in a system prompt. Prohibitions ("never reveal X") decay as context fills, while requirements ("always include Y") persist; the author calls this Security-Recall Divergence. Token-matched padding controls attribute most of the effect to semantic content, not length. Re-injecting the constraints before a per-model "Safe Turn Depth" restores compliance.

**Key numbers.**
- Mistral Large 3: omission compliance 73% at turn 5 → 33% at turn 16, while commission compliance holds at 100% (p < 1e-33) [abs].
- Schema semantic content accounts for 62–100% of the dilution effect in the two padded models [abs]. Safe Turn Depth is 10.6 turns [5.0, 16.7] for Mistral Large 3 and 7.1 [5.0, 10.5] for Qwen 3.5. The asymmetry is significant in 3 of 4 models with longitudinal data; one model is immune [full].

**Relation to Decorum.** Most of Decorum's coordination rules are prohibitions: do not read threads you are not on, do not close without evidence, do not exceed the budget. These are the type that decay in prompts, and the type that monitoring misses because commission signals still look healthy. That justifies enforcing them and leaving only positive guidance in `norms:`. It also predicts the prompted arm of the E2 ablation should get worse with thread length; plot it against depth.

**Limitation.** It is a single-author preprint with short synthetic conversations, not agentic tool loops. It measures single-agent chat, not delegation.

## 7. Will the agent recuse, and will it stop?

Munirathinam, T. *Will the Agent Recuse, and Will It Stop? Measuring LLM-Agent Compliance with In-Band Governance Signals at the Access Door and Mid-Flight.* arXiv:2606.06460, 2026. https://arxiv.org/abs/2606.06460

**Summary.** The paper proposes a cooperative "Recuse Signal" (deny, throttle, warn, halt) that a server emits through existing channels (SSH banner, PostgreSQL NOTICE, Kubernetes warning). It measures whether agents including Claude Code honour it, then measures a harness-level interceptor as the backstop.

**Key numbers.**
- Recusal to deny at the access door ranges from 100% down to 55–75% across agents [abs]. No agent surfaced a warning (0/100) [abs].
- Mid-task halt for two OpenAI models: an in-band halt was acknowledged 0/20 times. The same halt in the prompt channel was acknowledged 20/20 times **and still stopped 0/20** [full]. Gemini 2.5 Flash stopped 80% [abs].
- A harness interceptor stops 120/120 runs across six models (by construction), against a 23% cooperative baseline [abs][full].

**Relation to Decorum.** Decorum's budget cut-off and escalation primitives must be interceptors, not requests. The finding "acknowledged but not obeyed" is exactly the failure a prompted budget rule would show.

**Limitation.** The enforced arm succeeds by construction, so it validates the engineering rather than giving a contest. Sample sizes are small (n = 20 per cell), and the study is single-agent.

## 8. Agent-C: enforcing temporal constraints

Kamath, A., Zhang, S., Xu, C., Ugare, S., Singh, G., Misailovic, S. *Enforcing Temporal Constraints for LLM Agents.* arXiv:2512.23738, 2025. https://arxiv.org/abs/2512.23738

**Summary.** A DSL states ordering policies, such as "authenticate before accessing data". Specifications become first-order logic, and an SMT solver checks each tool call as it is being generated. Constrained decoding then forces a compliant alternative. The evaluation uses τ-bench retail and airline with open and closed models, against AgentSpec, DynaGuard and an unrestricted agent. In the unrestricted agent the policy is "explicitly given in the system prompt" [full].

**Key numbers.**
- Conformance 77.4% → 100% for Claude Sonnet 4.5 and 83.7% → 100% for GPT-5 [abs]. Utility 71.8% → 75.2% and 66.1% → 70.6% respectively [abs].
- 0% harm in adversarial settings across all configurations [abs][full].

**Relation to Decorum.** Handoff and closing rules are temporal: accept before work, evidence before close, review before merge. This shows such rules can be enforced with utility *rising*, which is the shape of result Decorum's E1 needs. It is a candidate formalism for typed primitives.

**Limitation.** It requires control of decoding (open models, or re-generation for closed ones). The specifications are hand-written per domain, and the setting is single-agent customer service.

## 9. Out-of-Band Policy Enforcement (OBPE)

Millstone, M., Akidau, T., Brüderl, J., Pekker, M. *If Agents Were Angels, No Governance Would Be Necessary: Out-of-Band Policy Enforcement at a Trusted Tool Boundary.* arXiv:2608.27646, 2026. https://arxiv.org/abs/2608.27646

**Summary.** OBPE is an HTTP proxy, outside the agent's reasoning, that authorises typed operations. It narrows queries before the backend call and filters or masks fields in responses, using Cedar policies. The data owner sets a ceiling that agent policy can only narrow, and the paper proves order-independence and non-widening under stated conditions. The benchmark compares *prompted* agents with and without OBPE against Jira/ServiceNow mocks, including adaptive red-team tasks.

**Key numbers.**
- Trace failure (protected data in context, an exact value leaked, or a forbidden effect) falls from 57.6% to 0.2% over 3,621 trials, a cluster-weighted reduction of 41.2 pp [95% CI 27.7, 54.9] [abs].
- Fulfilment falls from 79.1% to 60.9%, but safe-useful completion rises 21.8 pp [9.5, 35.2] [abs].

**Relation to Decorum.** It shows how to implement a visibility primitive: the thread-read tool filters what reaches a subagent's context, which is stronger than telling the subagent not to look. The paper also names the residue a saboteur in E2 could exploit: answers reconstructed from filtered row counts, so "shaping one execution is not noninterference" [abs].

**Limitation.** Single agent. Write controls, durable approval, and temporal or aggregate policies are explicitly out of scope.

## 10. AgentLTL

Elkoussy, L., Perez, J. *AgentLTL: A Trace-Verification Framework for Measuring, Enforcing, and Training Procedural Compliance in Tool-Using LLM Agents.* arXiv:2607.02599, 2026. https://arxiv.org/abs/2607.02599

**Summary.** A first-order LTL language over agent traces gives a deterministic, judge-free compliance score. One specification serves two uses. As *harnessing*, it scores finished traces or gates each prefix online (block-and-warn). As *fine-tuning*, it serves as a dense reward. The benchmark covers ordering, branching, iteration and grounding.

**Key numbers.**
- Block-and-warn harnessing improves compliance on 5 of 7 models [abs].
- Fine-tuning with the same reward gives +38 pp accuracy and +17.5 pp compliance on held-out patterns [abs].

**Relation to Decorum.** It is a deterministic, judge-free way to score rulebook compliance from traces, which the E4 optimizer could consume. It also shows harness enforcement is not uniformly positive: 2 of 7 models did not improve.

**Limitation.** Single-agent tool traces. The procedural rules are given, not learned.

## 11. AgentSpec

Wang, H., Poskitt, C. M., Sun, J. *AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents.* ICSE 2026, pp. 2938–2950. arXiv:2503.18666. https://arxiv.org/abs/2503.18666 · DOI 10.1145/3744916.3764546

**Summary.** A lightweight DSL of rules made of a trigger (an agent event), predicates (checks on state) and an enforcement action (stop, ask the user, invoke self-reflection, corrective action). It is hooked into the agent loop and evaluated on code execution, embodied agents and autonomous driving. It also tests LLM-generated rules.

**Key numbers.**
- It prevents unsafe executions in over 90% of code-agent cases, eliminates all hazardous embodied actions, and gives 100% AV compliance, with millisecond overhead [abs].
- Rules generated by o1: 95.56% precision / 70.96% recall (embodied), 87.26% of risky code identified, and law-breaking prevented in 5/8 AV scenarios [abs].

**Relation to Decorum.** This is the canonical trigger–predicate–enforcement shape. Decorum's typed YAML primitives are a coordination-specific instance of it. The LLM-generated-rules result is a weak precedent for the stretch goal where the optimizer writes new enforcement primitives.

**Limitation.** It covers safety rules for a single agent, not coordination. Rules are written once and not optimised for task success.

## 12. Guardrails Beat Guidance

Zhang, X., Wang, G., Cui, Y., Qiu, W., Li, Z., Zhu, B., He, P. *Guardrails Beat Guidance: A Large-Scale Study of Rules, Skills, and Persistent Configuration for Coding Agents.* arXiv:2604.11088, 2026. https://arxiv.org/abs/2604.11088

**Summary.** The authors scraped 679 rule files (25,532 rules: `CLAUDE.md`, `.cursorrules`, skills) and ran more than 5,000 Claude Code (Opus 4.6) runs on SWE-bench Verified. Prompt-only rule files help, but largely *independently of content*: random, shuffled and mismatched rules help as much as curated ones. Every rule that helped on its own was a negative constraint, and every one that hurt was a positive directive.

**Key numbers.**
- Random rules and expert-curated rules each give +13.8 pp on a discriminative subset of SWE-bench Verified [abs].
- Pass rate stays stable from 0 to 50 rules [abs].

**Relation to Decorum.** This sets the prior for the prompt-only `norms:` field. Its effect may be context priming rather than rule content, so an optimizer editing `norms:` may be chasing noise. E4 should include a shuffled-`norms:` control. Note the tension with 2604.20911: prohibitions help when prompted (here), yet they are also the type that decays with depth (there).

**Limitation.** It measures task pass rate, not compliance with the rules themselves. Single agent, one model.

---

## Considered and not kept (all ids checked in Kestrel)

- 2605.10481 *Constraint Drift in LLM-based MAS*: a position paper, with no artifact or number; theme 04 may cite it. It argues constraints must stay "fresh, inherited, enforceable, auditable" across delegation, which is the motivation Decorum tests empirically.
- 2604.09443 *Many-Tier Instruction Hierarchy* (EMNLP 2026 Findings): frontier models reach ~40% accuracy with up to 12 conflicting privilege tiers [abs]. Background for why the instruction hierarchy cannot carry a rulebook.
- 2606.19464 *AgenticRei* (ICWS 2026): deontic policies (obligations, dispensations, meta-policy) evaluated outside the LLM over both tool calls *and agent-to-agent messages*. Relevant to Decorum's escalation/dissent primitives, but demonstrated by examples only, with no measured comparison.
- 2503.22738 *ShieldAgent*, 2606.26524 *VIGIL*, 2608.22868 *AgentFlow*, 2609.35807 *Environment Steering*, 2606.26649 *Autoformalization into Cedar*: strong enforcement or detection systems, but security-focused, single-agent, and without a prompted control. AgentFlow (AgentDojo compromise 33.0% → 0.0% with utility 46.7% → 63.3% [abs]) is the best of these if the lead wants one more security number.
- 2609.15293 *The Enforcement Gap*: detection without binding enforcement is worthless (p_e ≈ 0 by default in the frameworks tested) [abs]. Supports enforcing rather than flagging.
- 2609.00267 *Delegation Without Trust*: an authorization broker confines a compromised sub-agent to 1.5 reachable actions vs 8,100 under bearer delegation [abs]. A threat-model candidate for E2.

## Novelty threats found (report to lead)

- **2601.11369 Institutional AI**: enforced governance manifest vs prompt-only constitution in a multi-agent LLM system, with numbers. The closest prior work to "enforced rulebook, prompted control". Not evolved (hand-screened parameters), competitive rather than cooperative, sanction-based.
- **2608.09828 POLIS**: prompted vs executable institutions in multi-role delegation. It finds a strong prompt can equal enforcement on short horizons. Decorum's claim that enforced beats prompted must be scoped (long horizon, adversaries, delegation depth), or E2 may reproduce POLIS's null.
- **2609.22600 GovSim-SelfGovern** (abstract only): agents *author executable governance rules* in Python, vote on them and live under them, in a common-pool social dilemma. That is endogenous rule evolution with enforcement, but done by the governed agents themselves, in a game rather than task-solving, with no outer-loop optimizer. Theme 01/02 should weigh it.
- **2607.09766 Norm Enforcement for AI Agents** (Ye & Steinhardt, ICML 2026 workshop; abstract only): designs enforcement mechanisms (reliability estimates, escalating penalties) that resist exploitation by misaligned agents in multi-agent environments. It concerns the enforcement mechanism, not rule content, and is not about task-solving harnesses.
- **2606.14790 XFlow**: makes the prompt–harness boundary in MAS its explicit research question, with hand-written protocols.

## Added by validation

Found by the validation pass (fresh Kestrel searches, 2026-10-01); abstracts read, numbers from the abstract only.

### V1. Governance at the Boundary: agent decomposition degrades policy compliance
Bowen Li, Guojun Wang. *Governance at the Boundary: How Agent Decomposition Degrades Policy Compliance.* arXiv:2608.16055, 2026. https://arxiv.org/abs/2608.16055 · PDF: `2026-li-governance-at-the-boundary.pdf`

Fiducia-bench tests whether financial (KYC/AML) agents escalate, abstain and leave an audit trail when policy requires it. It compares a single loop, a fixed pipeline and an orchestrator–subagent architecture, and finds that policy-relevant facts found by one component are dropped at the handoff before reaching the component that must act on them.
- Key numbers: 626 episodes, 100 task variants, two models, three architectures [abs]. With a 32B open-weights model, 0% of discovered facts are attenuated in the single loop, 56% in the fixed pipeline and 85% under orchestrator–subagent (constraint distance 2) [abs]. gpt-4.1-mini attenuates 3–6% [abs].
- **Relation to Decorum:** this is direct evidence that the manager→subagent handoff is where constraints get lost. It motivates Decorum's enforced `handoff` primitive and gives E2 a measurable failure mode (fact attenuation at handoff). It is a measurement paper: it does not enforce or evolve handoff rules.
- **Limitation:** single domain (finance compliance), small models; the effect shrinks sharply with a stronger model.

### V2. When Agent Governance Helps
Michael Ray Johnson, Linda Naimi. *When Agent Governance Helps.* arXiv:2609.05531, 2026. https://arxiv.org/abs/2609.05531 · PDF: `2026-johnson-when-agent-governance-helps.pdf`

Synthesises a governed multi-agent organisation framework (GAMPO) from 321 sources and tests a prompt-layer instantiation on the CHI-Bench healthcare benchmark.
- Key numbers [abs]: on capacity-constrained open models the full governance procedure gives no reliable benefit, while one "verify your writes" sentence moves pass@1 from 2/20 to 4/20. At the frontier the scaffold lifts prior-authorization from 24% to 40% on one model and nets zero on another. A per-task definition-of-done reaches 84% (best-of-five; 68% single attempt). The authors flag small samples (n = 5–25) and single trials.
- **Relation to Decorum:** evidence that prompt-only governance is model- and domain-gated, which supports testing enforced vs prompted rules (E2), and supports a per-domain adapter for "done/evidence" (their per-task definition-of-done beat a uniform procedure).
- **Limitation:** exploratory, tiny samples, prompt-layer only, no enforcement, no optimisation.
