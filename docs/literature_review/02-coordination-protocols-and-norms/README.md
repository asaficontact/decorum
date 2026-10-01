# Coordination substrates, protocols and enforced norms

This group of work covers how agents in LLM multi-agent systems (MAS) talk to each other and how the rules of that talk are set. The substrates are shared message pools (MetaGPT), orchestrator ledgers (Magentic-One), negotiated protocols (Agora), governance specifications (SocialSystemArena) and governance graphs enforced at runtime (Institutional AI). The group also includes the failure evidence that motivates rules: MAST, HiddenBench, and Anthropic's Frontier Red Team report on conformity, premature consensus and turf wars. Behind it sits the classic normative-MAS literature (electronic institutions, normative multiagent systems), in which the infrastructure enforces interaction rules instead of trusting agents to follow them. Since 2026 a small cluster has started to **search** over these rules: Constitutional Evolution evolves natural-language constitutions for a grid-world society, a follow-up compares that against agents deliberating over their own rules, LLM-guided program search evolves state-aware transmission protocols, Swarm Skills patches coordination specs from trajectories, and GovSim-SelfGovern lets agents write executable laws.

Across the group, most papers either **hand-design** the rules (SOPs, ledgers, gates, governance graphs, protocols) or **evolve them as prompt text** inside a toy social dilemma (grid-world, public goods, a commons). None of them evolves a rulebook that is **enforced by the harness** (visibility, handoff, closing-with-evidence, review, dissent, escalation, budget) in a **manager-led, task-solving** system whose topology emerges at runtime. None compares rule evolution head-to-head with topology design at equal token budget. None tests the evolved rules against a saboteur or a prompt-injected member, or transfers them across task domains. Those gaps are where Decorum's claim sits.

Tags: `[abs]` = number taken from the abstract; `[full]` = number read in the full text (or the full web page, for the non-arXiv items).

## Table

| Paper | Year | Venue | arXiv | What it is | Role for Decorum |
|---|---|---|---|---|---|
| Constitutional Evolution (Kumar et al.) | 2026 | preprint | [2602.00755](https://arxiv.org/abs/2602.00755) | LLM-guided multi-island evolution of a natural-language constitution for a 6-agent grid-world society | **closest work** |
| Adaptive Transmission Programs (Colas et al.) | 2026 | CogSci 2026 | [2608.24545](https://arxiv.org/abs/2608.24545) | LLM-guided evolution of state-aware *programs* that route information, compared against network-topology baselines | **closest work** (rules vs topology) |
| Internal vs External constitutional design (Niranjani et al.) | 2026 | preprint | [2605.09128](https://arxiv.org/abs/2605.09128) | Evolved constitution vs agents' own deliberation-and-vote, 3 environments, incentive-shift ablation | **closest work** / evidence (brittleness) |
| Swarm Skills (Zhang et al.) | 2026 | preprint | [2605.10052](https://arxiv.org/abs/2605.10052) | Portable, self-evolving multi-agent coordination spec extending Anthropic Skills; no quantitative eval | closest work (framing only) |
| When Agents Evolve, Institutions Follow (Fei et al.) | 2026 | preprint | [2604.27691](https://arxiv.org/abs/2604.27691) | 7 historical institutions as executable governance specs; ≥57 pp best–worst gap; no single winner | baseline (hand-designed topologies) / evidence |
| Institutional AI: governance graphs (Bracale Syrnikov et al.) | 2026 | preprint | [2601.11369](https://arxiv.org/abs/2601.11369) | Runtime-enforced governance graph vs prompt-only constitution against LLM collusion | evidence (enforced vs prompted) |
| HiddenBench (Li, Naito, Shirado) | 2025 | ICML 2026 | [2505.11556](https://arxiv.org/abs/2505.11556) | 65-task hidden-profile benchmark; a structured dissent-style protocol lifts accuracy sharply | evidence / benchmark candidate / hand-designed rule baseline |
| When Do Institutions Beat Intelligence? (Han) | 2026 | preprint | [2608.11357](https://arxiv.org/abs/2608.11357) | Controlled ecologies: institutional interventions vs stronger models; sanctions need checkability | evidence for a design choice |
| GovSim-SelfGovern (Rehm) | 2026 | preprint | [2609.22600](https://arxiv.org/abs/2609.22600) | Agents author, validate, vote on and live under executable Python laws in a commons game | closest work for stretch goal (agent-written enforcement code) |
| MAST (Cemri et al.) | 2025 | preprint (v3) | [2503.13657](https://arxiv.org/abs/2503.13657) | 14-mode failure taxonomy over 1600+ MAS traces + LLM-judge annotator | evidence / trace-analysis tool for the optimizer |
| Agora (Marro et al.) | 2024 | preprint | [2410.11905](https://arxiv.org/abs/2410.11905) | Meta-protocol: agents negotiate protocol documents and write routines for frequent exchanges | background (protocol negotiation, not optimization) |
| Magentic-One (Fourney et al.) | 2024 | preprint | [2411.04468](https://arxiv.org/abs/2411.04468) | Orchestrator with task ledger + progress ledger directing 4 specialist agents | baseline (manager-led harness) |
| MetaGPT (Hong et al.) | 2023 | ICLR 2024 | [2308.00352](https://arxiv.org/abs/2308.00352) | SOPs encoded in role prompts + publish/subscribe shared message pool | baseline / background (hand-designed SOP) |
| Patterns and problems in emerging multiagent systems (Anthropic FRT) | 2026 | blog | — ([link](https://www.anthropic.com/research/multiagent-systems)) | Swarm experiments: conformity, epistemic failures, incompatible goals | threat model / motivation |
| How we built our multi-agent research system (Anthropic) | 2025 | blog | — ([link](https://www.anthropic.com/engineering/multi-agent-research-system)) | Production orchestrator–subagent research system and its delegation failures | evidence (budget control) / background |
| On the Formal Specification of Electronic Institutions (Esteva et al.) | 2001 | LNAI 1991 | — ([doi](https://doi.org/10.1007/3-540-44682-6_8)) | Institutions as scenes, performative structures and rules enforced by the infrastructure | background (intellectual ancestor) |
| Introduction to Normative Multiagent Systems (Boella, van der Torre, Verhagen) | 2006 | CMOT 12(2–3) | — ([doi](https://doi.org/10.1007/s10588-006-9537-7)) | Definition and research agenda of normative MAS (norms, violation, sanction) | background (intellectual ancestor) |

Thirteen arXiv papers are kept, one over the 6–12 target, because the lead asked for the extra novelty threats to be assessed and included. The four non-arXiv items are linked, not downloaded.

---

## Novelty-threat assessment (read first)

Ranked by how close each item is to Decorum's claim: *evolving an enforced, domain-agnostic rulebook of interaction beats hand-designed topologies at equal budget, is more robust to bad actors, and transfers across domains.*

1. **2602.00755 Constitutional Evolution: closest prior work.** It evolves the *rules of conduct* (not the graph, not role prompts) of an LLM multi-agent society with an LLM-driven optimizer, and beats human-written and Claude-written rules. **Read in full.** What Decorum adds:
   - *Enforcement.* The constitution is only text in each agent's prompt [full: "Agent prompts include their team's constitution"]. Nothing enforces it, so the paper cannot separate enforced from prompted rules. Decorum's typed primitives are enforced by tools and hooks, and `norms:` is the prompted control.
   - *Setting.* Theirs is a 6×6 grid world with 6 agents, fixed teams and a scripted Overseer, scored on a welfare index. There is no task solving, no manager agent, no spawning and no topology. Decorum is a manager-led task-solving harness (coding, research) whose topology emerges at runtime.
   - *Baselines.* They compare only against other constitutions (Zero-Sum, HHH, LLM-written). They run no topology or graph-search baseline and match no token budget. Decorum's central comparison is rule evolution vs hand-designed topologies at equal model and token budget.
   - *Adversaries and transfer.* There is no adversarial agent inside a cooperating group at test time. "Zero-Sum" is a constitution for the whole society. There is no transfer test either: the authors list "whether evolved constitutions transfer across environments" as future work [full].
   - *Optimizer inputs.* The optimizer sees the score plus action logs; there is no ablation of what it needs (Decorum E4).
2. **2608.24545 Adaptive Transmission Programs: closest on "rules beat topology."** LLM-guided program search evolves *state-aware* protocols that decide who shares what with whom and when. These beat network-topology baselines by up to 37% [abs]. Removing content-dependence while keeping topology and timing *eliminates* the gain [full], which is the cleanest prior evidence for Decorum's core hypothesis. What Decorum adds: the primary agents are human-model "empowerment" agents in a Little-Alchemy-style crafting task, not LLMs. LLM agents appear only in a transfer test (+16%) [full]. There is no task-solving harness, no adversaries and no enforcement-vs-prompt question. The protocol is a centralized routing program, not a rulebook enforced on autonomous LLM agents.
3. **2605.09128 Internal vs External: closest on brittleness.** It compares the same group's evolved constitution with agents deliberating over and voting on their own rules. Evolution wins in collective-action settings, but its rules **invert from best to worst** when the public-goods multiplier shifts from 1.5 to 0.75 [full]. This is a direct warning for Decorum E3 (transfer). Same differences as item 1: prompt-only rules, social-dilemma games, single backbone.
4. **2605.10052 Swarm Skills: closest in framing, no evidence.** A portable coordination spec ("roles, workflows, execution bounds") in the Anthropic Skills format, with a self-evolution algorithm that distils and patches specs from trajectories. That is conceptually near a "rulebook that the harness evolves". It reports **no quantitative evaluation** [full: "The primary limitation of this work is the absence of large-scale, quantitative conformance testing"]. Decorum can cite it as concurrent framing, not as a result. Note (validation): its setting *is* a Leader-plus-spawned-Teammates, task-solving harness (Claude-Code-compatible, sub-agents via the native spawning tool) [full], so "manager-led task solving" does not differentiate Decorum from it; enforcement (its specs are read and followed by the Leader, "driven by the Host Agent's ability to comprehend" them [full]) and quantitative evaluation do.
5. **2604.27691 When Agents Evolve, Institutions Follow: closest in motivation.** It argues for "self-evolving multi-agent systems" that reselect governance, but evolves nothing: the seven governance specs are hand-designed and static, and "meta-governance" is future work [full]. Useful to Decorum as a ready-made **set of hand-designed topology baselines** (public code), and as evidence that the best hand-designed topology changes with the model.
6. **2609.22600 GovSim-SelfGovern.** Agents write *executable* Python laws, validate them in a sandbox and vote on them, so the rules are enforced by code. It is a commons dilemma, not task solving; the rules are authored online by the agents themselves, not optimized offline against a fitness. It is close to Decorum's stretch goal of an optimizer that writes new enforcement primitives.
7. **2601.11369 Institutional AI.** A runtime Oracle/Controller enforces a hand-written governance graph; the graph is not evolved. Its comparison of enforced and prompt-only constitutions is exactly Decorum's E2 contrast, in a Cournot collusion setting.

**Screened and judged further away** (abstract only; not kept):
- Learn protocol choice or other parts of a MAS, not enforced interaction rules:
  - 2607.25446 IMACS: a contextual bandit picks one of six fixed collaboration protocols per task.
  - 2605.26448 Constitutional Arms Races: co-evolves Blue and Red constitutions in a public-goods game; same group as item 1, relevant to Decorum's "adversaries during evolution" stretch.
  - 2603.15968 MAC: multi-agent *optimizer* that learns a constitution for a single-model PII-tagging task.
  - 2605.29790 Meta-Team, 2608.21918 OptiMAS: evolve whole-MAS behaviour, coordination and organization from experience; handed to theme 03.
  - 2605.09539 TacoMAS, 2605.27850 TCP-MCP: topology and prompt co-evolution; theme 01.
- Enforcement in a single-agent or security setting, not coordination; relevant to E2 and theme 04:
  - 2606.04306 Organizational Control Layer: pre-execution enforcement cuts unsafe executions from 88% to 0% and finds that prompting alone does not [abs].
  - 2609.15293 enforcement gap: a detected audit flag is executed anyway by default.
  - 2608.28502 Recognition Without Enforcement.
  - 2606.19464 AgenticRei: deontic runtime policies over tool calls and agent-to-agent messages, examples only.
  - 2605.10481 Constraint drift: position paper.
  - 2608.09828 POLIS ("Multi-Agent AI Safety as an Institutional Design Problem"; multi-agent delegation workflows, so not single-agent): a detailed constitutional prompt and a provenance-aware executable guard *both* give 0/384 violations; in laundering scenarios a local-state guard admits 22/96 vs 0/96 for provenance enforcement [abs]. Caution for Decorum: on its main suite prompting matched enforcement.
- Hand-designed coordination substrates:
  - 2609.15054 BusMA: shared bus with message intents (discussion, challenge, guidance, request-for-explanation) and a Chair agent; beats manager-worker and router baselines [abs].
  - 2609.26781 Agensh: orchestrator-free claim-and-merge workspace, 1→128 agents raises ProgramBench test-pass from 19.31% to 28.78% [abs].
  - 2604.17612 ZipperGen: deadlock-free MSC protocols.
  - 2606.05390 Ahoy: LLMs enact declarative protocols.
  - 2510.12120 SEMAP: protocol layer on A2A, up to 69.6% fewer MAST failures [abs].
  - 2507.01701 Blackboard MAS.
  - 2604.01020 OrgAgent.
  - 2601.14351 Team of Rivals.
- Norm emergence or governance in social simulations:
  - 2403.08251 CRSEC.
  - 2405.19328 Normative Modules.
  - 2603.13189 CMAG: hard and soft constraint filter on an LLM policy compiler, 80-agent network.
- Conformity and debate failure evidence:
  - 2410.12428 Conformity in LLMs (ACL 2025).
  - 2501.13381 BenchForm (ICLR 2025).
  - 2509.05396 Talk Isn't Always Cheap.
  - 2305.14325 Du et al. debate. A topology and protocol baseline better covered by theme 01.
  - 2307.07924 ChatDev, 2308.10848 AgentVerse: hand-designed frameworks; MetaGPT represents them here.

All seed ids in the brief were verified correct (2308.00352, 2307.07924, 2308.10848, 2411.04468, 2305.14325, 2507.01701, 2410.11905, 2503.13657, 2410.12428). The hidden-profile seed resolves to 2505.11556 (HiddenBench). The Esteva et al. title is "On the Formal Specification of Electronic Institutions" (singular).

---

## Per-paper notes

### 1. Evolving Interpretable Constitutions for Multi-Agent Coordination
Ujwal Kumar, Alice Saito, Hershraj Niranjani, Rayan Yessou, Phan Xuan Tan. *Evolving Interpretable Constitutions for Multi-Agent Coordination.* arXiv:2602.00755, 2026. <https://arxiv.org/abs/2602.00755> · PDF: `2026-kumar-evolving-interpretable-constitutions.pdf`

**Summary.** A constitution is a priority-ordered set of natural-language rules shared by all agents and placed in each agent's prompt. Six GPT-OSS-120B agents in two teams gather resources on a 6×6 grid under partial observability, and an Overseer eliminates the lowest contributor every 10 turns. OpenEvolve (3 islands × 10, MAP-Elites, 30 iterations, K=2 runs per evaluation) mutates the constitution using the Stability Score and the action logs. The evolved C* is seven operational rules ("Deposit First", "Broadcast only for 2+ resources", "No aggression unless attacked") and nearly eliminates communication.

**Key numbers.**
- S = 0.556 ± 0.008 for C* vs 0.249 HHH, 0.332 Claude-4.5-Opus-written, 0.000 Zero-Sum; N=10 [abs][full].
- Productivity 91% vs 30% (HHH) and 51% (LLM-written) [full].
- Social (communication) actions 0.9% vs 62.2% (HHH) and 54.7% (LLM-written) [abs][full].
- Theoretical max S = 0.6; best run 0.577 [full].
- Single-island evolution: S = 0.385 ± 0.141, with one run stuck in a "communication trap" at 0.255 [full].
- Cost ≈ 180 simulations and $50–100 per evolution run [full].

**Relation to Decorum.** This is the closest prior demonstration that an LLM optimizer can evolve the rules of interaction of an LLM collective and beat hand-written and LLM-written rules. Decorum differs on five axes: enforced typed primitives vs prompt text; a task-solving manager-led harness vs a grid-world welfare game; topology baselines at equal budget; adversarial members and cross-domain transfer; an optimizer-input ablation. The "less communication wins" finding is a falsifiable prediction for Decorum: log message volume per run and check whether evolved rulebooks tighten visibility.

**Limitation.** One toy environment, one backbone, prompt-only rules. The fitness has a hard ceiling (S ≤ 0.6) and comparisons cover constitutions only; transfer is untested by the authors' own account.

### 2. Discovering Adaptive Transmission Programs for Collective Innovation
Cédric Colas, Jérémy Perez, Eleni Nisioti, Akhilesh Mocherla, Pierre-Yves Oudeyer, Clément Moulin-Frier, Maxime Derex. *Discovering Adaptive Transmission Programs for Collective Innovation.* CogSci 2026; arXiv:2608.24545. <https://arxiv.org/abs/2608.24545> · PDF: `2026-colas-discovering-adaptive-transmission-programs.pdf`

**Summary.** The paper formalizes transmission protocols (who shares what with whom, how and when) as state-aware Python programs that route information and resources based on agent and collective state. Network-topology protocols from the collective-intelligence literature are the special case that ignores state. LLM-guided evolutionary search, seeded with five baseline protocols, discovers programs that raise the number of elements discovered in a Little-Alchemy-style crafting task. The main agents are an empowerment-maximizing model of human choice, and LLM agents (Gemini 3.0 Flash) appear in transfer tests.

**Key numbers.**
- Evolved protocols beat literature baselines by up to 37% [abs], with an average of +33% over the best baseline at step 150 (N=5, p<0.001) [full].
- Ablation: randomizing transmitted content while keeping topology and timing reduces top protocols to baseline level [full].
- Transfer: smaller population +17%, larger +49%, stochastic agents +18%, LLM agents +16%, mixed +24% [full].

**Relation to Decorum.** This is the strongest prior evidence for Decorum's core hypothesis that *rules conditioned on state beat fixed graphs*. Its content-randomization ablation is a design Decorum should copy: keep the emergent topology of evolved runs but strip or randomize the rulebook content, and show the gain vanishes.

**Limitation.** Not LLM agents in the main study, and not task solving. The protocol is a central router program, not a rulebook that autonomous agents operate under; there are no adversaries.

### 3. Internal vs. External: Comparing Deliberation and Evolution for Multi-Agent Constitutional Design
Hershraj Niranjani, Ujwal Kumar, Phan Xuan Tan. arXiv:2605.09128, 2026. <https://arxiv.org/abs/2605.09128> · PDF: `2026-niranjani-internal-vs-external-constitutional-design.pdf`

**Summary.** The paper compares three conditions: no constitution, *internal* deliberation (every 10 turns each agent proposes up to two amendments and a majority vote adopts them), and *external* evolution with item 1's OpenEvolve method (re-run per environment from the same blank seed constitution as deliberation [full]). Each condition is run across a gridworld, an iterated public-goods game and a bilateral trading market, with 6 GPT-OSS-120B agents and 10 seeds. Evolution wins in collective-action games, nobody wins in trading, and a multiplier sweep shows that the fixed evolved rules force value-destroying cooperation when incentives change. Deliberating agents never proposed punishment.

**Key numbers.**
- Gridworld S: evolution 0.458 ± 0.017 vs deliberation 0.319 ± 0.091 [full].
- Public goods S: evolution 0.472 ± 0.004 vs deliberation 0.376 ± 0.032 (p<0.01) [full].
- Trading: 0.438 vs 0.419, not significant [full].
- Multiplier m=0.75: evolution 0.477 vs deliberation 0.536 (worst of three) [full].
- Punishment proposed in 0 of 30 deliberation runs [abs].
- 180 runs total [abs].

**Relation to Decorum.** This is direct evidence that an offline-evolved rulebook can be **brittle under distribution shift**, the exact risk of E3 (coding → research). It also shows that external optimization finds enforcement-like rules (sanctions) that agents will not legislate for themselves, which supports an outer optimizer over agent self-governance. The authors' proposed hybrid (evolved scaffold plus runtime amendment) is a possible Decorum extension.

**Limitation.** Prompt-only rules, toy games, one backbone, 30-iteration budget; the "transfer" tested is a single incentive parameter, not a domain shift.

### 4. Swarm Skills: A Portable, Self-Evolving Multi-Agent System Specification for Coordination Engineering
Xinyu Zhang, Zhicheng Dou, Deyang Li, Jianjun Tao, Shuo Cheng, Ruifeng Shi, Fangchao Liu, Enrui Hu, Yangkai Ding, Hongbo Wang, Qi Ye, Xuefeng Jin, Zhangchun Zhao. arXiv:2605.10052, 2026. <https://arxiv.org/abs/2605.10052> · PDF: `2026-zhang-swarm-skills.pdf`

**Summary.** Swarm Skills extends the Anthropic Skills (SKILL.md) format with multi-agent semantics: roles, workflows, execution bounds and dependencies. It adds a self-evolution algorithm that distils successful trajectories into new specs and patches existing ones, scored on Effectiveness, Utilization and Freshness with a Beta(1,1) prior. The paper's evidence is an architectural compatibility analysis and a qualitative case study on the open-source JiuwenSwarm implementation.

**Key numbers.** None; the paper is a specification with a qualitative case study [full].

**Relation to Decorum.** Swarm Skills frames "coordination engineering" as a portable, evolvable asset in the same harness family Decorum targets (Claude-Code-style skills and sub-agent spawning). Decorum should cite it as concurrent framing. Decorum's rulebook differs in being typed and enforced, and in being evaluated quantitatively against topology baselines.

**Limitation.** No quantitative evaluation at all; it flags "first-run lock-in" (a bad initial workflow gets patched rather than restructured).

### 5. When Agents Evolve, Institutions Follow
Chao Fei, Hongcheng Guo, Yanghua Xiao. arXiv:2604.27691, 2026. <https://arxiv.org/abs/2604.27691> · PDF: `2026-fei-when-agents-evolve-institutions-follow.pdf` · code: <https://github.com/cf3i/SocialSystemArena>

**Summary.** SocialSystemArena formalizes a governance specification G = (P, A, S, T, F): a pattern (pipeline, gated pipeline, autonomous cluster, consensus), agents with roles and "soul prompts", ordered stages, a transition function and pluggable features such as monitoring and loop guards. Seven historical institutions are encoded in it, including the Tang Three Departments, US Federal, Edo Bakuhan and Athenian Democracy. They run on one runtime across three LLMs (MiniMax M2.5, Kimi K2.5, Gemini 2.5 Flash) and two benchmarks (PinchBench, 23 tool-use tasks; ClaweBench, 104 multi-step tasks). Governance strongly shapes outcomes, but the best institution changes with model and benchmark. The authors argue for, but do not build, a meta-governance layer that re-selects governance.

**Key numbers.**
- Best–worst gap within one model on PinchBench: 57.1 pp (MiniMax, Tang 88.2% vs single agent 31.1%), 58.6 pp (Kimi), 60.5 pp (Gemini) [full]; ">57 pp" [abs].
- On ClaweBench the gaps shrink to 8.2–11.8 pp [full].
- Gate-loop failure: Tang on Kimi rejects up to 15 times per task, 18 of 23 tasks hit the 32-step budget, score 21.6% [full].

**Relation to Decorum.** These are ready-made, public, hand-designed governance topologies, a natural "best hand-designed fixed topology" baseline set for E1. The cross-model ranking flips mean Decorum must pick the best fixed topology *per model* to be fair. The gate-loop failure shows that a review primitive needs a budget or escalation bound.

**Limitation.** Static specs, no search. The large gaps appear on the easy benchmark and shrink about 80% on the harder one; there is one run per (model, institution, benchmark) cell.

### 6. Institutional AI: Governing LLM Collusion in Multi-Agent Cournot Markets via Public Governance Graphs
Marcantonio Bracale Syrnikov, Federico Pierucci, Marcello Galisai, Matteo Prandi, Piercosma Bisconti, Francesco Giarrusso, Olga Sorokoletova, Vincenzo Suriani, Daniele Nardi. arXiv:2601.11369, 2026. <https://arxiv.org/abs/2601.11369> · PDF: `2026-bracalesyrnikov-institutional-ai-governance-graphs.pdf`

**Summary.** A governance graph is a public, immutable manifest of legal states (Active → Warning → Fined → Suspended, with restorative paths), transitions and sanctions. An Oracle turns public market outcomes into evidence-backed cases, and a Controller traverses only manifest-declared edges while writing a hash-chained, append-only log. Three regimes are compared on LLM Cournot duopolies across six model configurations: Ungoverned, Constitutional (prompt-only anti-collusion constitution) and Institutional (governance graph). The related-work section explicitly connects the design to electronic institutions (Esteva 2001) and to the distinction between regimentation, enforcement and meta-governance.

**Key numbers.**
- Mean collusion tier falls from 3.1 to 1.8 under the Institutional regime (Cohen's d = 1.28) [abs].
- Severe-collusion incidence falls from 50% to 5.6% [abs].
- N = 90 runs per condition [abs].
- The prompt-only constitution gives "no reliable improvement" [abs].

**Relation to Decorum.** This is direct prior evidence for the enforced-vs-prompted contrast in E2. Prompt-only prohibitions did not bind under optimization pressure, while enforced transitions did. Decorum's chair and hooks play the role of the Controller, and its evidence adapter plays the role of the Oracle.

**Limitation.** The graph is hand-designed and not evolved, the setting is a two-firm market, and "collusion" is the only failure targeted.

### 7. Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs (HiddenBench)
Yuxuan Li, Aoi Naito, Hirokazu Shirado. ICML 2026; arXiv:2505.11556. <https://arxiv.org/abs/2505.11556> · PDF: `2025-li-hiddenbench-collective-reasoning-distributed-information.pdf`

**Summary.** HiddenBench has 65 hidden-profile tasks in which shared evidence points to the wrong option and decisive facts are held privately. It isolates collective reasoning from individual ability. Across 15 frontier LLMs, groups fail mainly by converging prematurely on shared evidence and not probing for unshared facts. Prompting does not fix this, but a lightweight two-stage Exchange-then-Decide protocol does: each agent shares 1–2 facts *and gives one reason the current front-runner may be wrong*, then summarizes evidence before voting.

**Key numbers.**
- Multi-agent accuracy under distributed information 30.1% vs 80.7% for a single agent with full information [abs].
- An explicit "share everything" prompt reaches 0.467 (GPT-4.1, 3-task ablation set) [full].
- The structured protocol moves accuracy from 0.037 to 0.800 (GPT-4.1), 0.173 to 0.727 (Gemini-2.5-Flash) and 0.043 to 0.743 (Flash-Lite) on 18 tasks [full].

**Relation to Decorum.** This is quantitative evidence that a *dissent rule* in the interaction protocol (not a better model) fixes premature consensus. It supports Decorum's `dissent` primitive and provides a strong hand-designed rule baseline. HiddenBench is also a cheap, scorable testbed for the transfer leg (E3) or for unit-testing dissent and visibility rules.

**Limitation.** Two-option decision tasks with four agents, not open-ended work; the protocol is enforced only by prompt staging.

### 8. When Do Institutions Beat Intelligence?
Zhengye Han. arXiv:2608.11357, 2026. <https://arxiv.org/abs/2608.11357> · PDF: `2026-han-when-do-institutions-beat-intelligence.pdf`

**Summary.** The paper builds controlled "ecologies" around four places where collective reasoning fails: access and routing, admission and dependence, state maintenance and incentives, representation and action. It then compares institutional interventions (routing, grounded admission, audits, sanctions) with capability interventions (a stronger or larger model) under matched call budgets, plus mechanism-breaking controls. Institutions help when they repair how the group builds usable public state. They lose their advantage when their signals cannot be checked, when a stronger model can do the same transformation directly, or when the resulting state cannot drive reliable action.

**Key numbers.**
- Distributed evidence: a valid five-call 8B institution beats a five-call raw 70B system by +0.58 [0.44, 0.72] [full].
- Wrong consensus: +0.68 [0.55, 0.81] over a four-call raw 70B baseline [full].
- Grounded admission beats syntax-only admission by +0.50 [full].
- At zero checkability, every sanction level gives exactly 0.00 accuracy gain [full].

**Relation to Decorum.** "A sanction without observability is an unenforceable declaration" [full] is a design constraint for Decorum's per-domain evidence adapter. Closing and review rules only help if the evidence is checkable: tests run for coding, citations resolved for research. The paper also supplies a matched-budget, mechanism-breaking-control methodology Decorum can borrow.

**Limitation.** Mostly synthetic ecologies with small open models; institutions are hand-built per failure locus, not learned.

### 9. From Certain Doom to Survival: Agent-Driven Self-Governance in LLM Agent Societies (GovSim-SelfGovern)
Gregory B. Rehm. arXiv:2609.22600, 2026. <https://arxiv.org/abs/2609.22600> · PDF: `2026-rehm-govsim-selfgovern.pdf`

**Summary.** The paper extends the GovSim fishing commons so that agents deliberate, propose laws as executable Python over a constrained API, get sandbox validation feedback, vote, and then live under the enacted laws in later rounds. It tests three regimes of increasing scarcity across eight models from four families, five seeds each. Variants add fiscal capacity (a treasury), dictatorship (no veto) and deeper reasoning.

**Key numbers.**
- Standard game: intact community survival 45.0% → 72.5% (+27.5 pp) and commons survival 67.5% → 82.5% with self-governance [full].
- Under scarcity, ICS falls to 5% (G2) and 2.5% (G3) [full].

**Relation to Decorum.** This is a working example of rules as *enforced code* written by LLMs: the stretch goal in which Decorum's optimizer writes new enforcement primitives. It also shows that agent-authored governance is brittle under pressure, which echoes item 3.

**Limitation.** A social dilemma with no task solving. Rules are authored by the governed agents, not optimized against a held-out fitness, and there is no comparison with topology design.

### 10. Why Do Multi-Agent LLM Systems Fail? (MAST)
Mert Cemri, Melissa Z. Pan, Shuyi Yang, Lakshya A. Agrawal, Bhavya Chopra, Rishabh Tiwari, Kurt Keutzer, Aditya Parameswaran, Dan Klein, Kannan Ramchandran, Matei Zaharia, Joseph E. Gonzalez, Ion Stoica. arXiv:2503.13657, 2025. <https://arxiv.org/abs/2503.13657> · PDF: `2025-cemri-why-do-multi-agent-llm-systems-fail.pdf`

**Summary.** MAST is a taxonomy of 14 failure modes in three categories (system design, inter-agent misalignment, task verification), built from 150 expert-annotated traces. It is validated by inter-annotator agreement and scaled with an LLM-as-judge annotator over MAST-Data (1600+ traces, 7 frameworks). Case studies show that changing the system design moves success rates without changing the model.

**Key numbers.**
- Cohen's κ = 0.88 [abs].
- Failure shares: system design 41.8%, inter-agent misalignment 36.9%, task verification 21.3% [full].
- ChatDev interventions: +9.4% success from better role specs and +15.6% from an added objective-verification step [full].

**Relation to Decorum.** Most failures are coordination and verification failures, which is the case for changing the rules rather than the model. Decorum's closing-with-evidence and review primitives target the task-verification category. The released LLM annotator could label training-run traces for the reflective optimizer (E4 "+traces").

**Limitation.** Descriptive, not prescriptive: interventions are hand-made one-offs on two frameworks, and failure categories overlap.

### 11. A Scalable Communication Protocol for Networks of Large Language Models (Agora)
Samuele Marro, Emanuele La Malfa, Jesse Wright, Guohao Li, Nigel Shadbolt, Michael Wooldridge, Philip Torr. arXiv:2410.11905, 2024. <https://arxiv.org/abs/2410.11905> · PDF: `2024-marro-agora-scalable-communication-protocol.pdf`

**Summary.** Agora is a meta-protocol built around an "Agent Communication Trilemma" of versatility, efficiency and portability. Agents use standard routines for frequent exchanges, natural language for rare ones, and LLM-written routines in between. Agents negotiate protocol documents (identified by hash) and implement them as code. Demos on networks of up to 100 agents show self-organising protocols emerging.

**Key numbers.**
- Negotiating a protocol and writing its routines costs $0.043 vs $0.020 per natural-language exchange, so it pays off after more than two uses [full].
- 1000 queries in a 100-agent network: $36.23 in natural language vs $7.67 with Agora, about 5× cheaper [full].

**Relation to Decorum.** This is prior work on agents *negotiating* communication protocols at runtime, aimed at efficiency and interoperability, not task success or robustness. No outer loop optimizes the protocols. Decorum's rulebook governs conduct (who sees what, who may close, when to escalate), not message formats.

**Limitation.** Demonstrations, not controlled benchmarks; no adversaries and no comparison with topologies.

### 12. Magentic-One: A Generalist Multi-Agent System for Solving Complex Tasks
Adam Fourney, Gagan Bansal, Hussein Mozannar, Cheng Tan, Eduardo Salinas, Erkang Zhu, Friederike Niedtner, Grace Proebsting, Griffin Bassman, Jack Gerrits, Jacob Alber, Peter Chang, Ricky Loynd, Robert West, Victor Dibia, Ahmed Awadallah, Ece Kamar, Rafah Hosn, Saleema Amershi. arXiv:2411.04468, 2024. <https://arxiv.org/abs/2411.04468> · PDF: `2024-fourney-magentic-one.pdf`

**Summary.** A lead Orchestrator plans, tracks progress and re-plans, directing four specialists: WebSurfer, FileSurfer, Coder and ComputerTerminal. An outer loop keeps a *task ledger* (facts, guesses, plan) and an inner loop keeps a *progress ledger* (progress, next assignee, stall detection). The release includes AutoGenBench for repeated, isolated agentic evaluation.

**Key numbers.** 38% on GAIA, 32.8% on WebArena and 27.7% on AssistantBench, statistically competitive with SOTA at the time [full].

**Relation to Decorum.** This is the canonical manager-led harness with hand-designed coordination state (ledgers) and a fixed delegation protocol: an E1 baseline shape. The progress ledger's stall detection is a hand-written escalation rule that Decorum would instead evolve and enforce.

**Limitation.** The coordination protocol is fixed and prompt-driven, with no adversaries and no protocol search.

### 13. MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework
Sirui Hong, Mingchen Zhuge, Jiaqi Chen, Xiawu Zheng, Yuheng Cheng, Ceyao Zhang, Jinlin Wang, Zili Wang, Steven Ka Shing Yau, Zijuan Lin, Liyang Zhou, Chenyu Ran, Lingfeng Xiao, Chenglin Wu, Jürgen Schmidhuber. ICLR 2024; arXiv:2308.00352. <https://arxiv.org/abs/2308.00352> · PDF: `2023-hong-metagpt.pdf`

**Summary.** MetaGPT encodes human Standardized Operating Procedures (product manager → architect → engineer → QA) into role prompts and structured output documents. Agents communicate through a shared message pool with publish/subscribe filtering by role profile, and code is refined with executable feedback.

**Key numbers.** HumanEval Pass@1 85.9% and MBPP 87.7% [full].

**Relation to Decorum.** This is the archetype of hand-designed interaction rules: an SOP is a rulebook written by people and enforced mostly by prompts and output schemas. Its publish/subscribe pool is a visibility rule. Decorum asks whether such rules can be found automatically and enforced by the harness.

**Limitation.** Fixed waterfall SOP for one domain (software); its gains confound SOP structure with executable feedback.

### 14. Patterns and problems in emerging multiagent systems (Anthropic Frontier Red Team)
Anthropic Frontier Red Team (corresponding author Carolyn Zou). Blog post, 13 Aug 2026. <https://www.anthropic.com/research/multiagent-systems> (not on arXiv; linked).

**Summary.** The team ran swarms of Claude agents on separate VMs with a shared forum and repository. Tasks included vulnerability discovery, a 12-hour game build, writer's workshops, pricing games, scout and lie detection, hidden-profile votes, and a "turf war" in which three agents migrate one backend to three different languages. The post groups failures into three classes:
- **Conformity / low variance:** identical agents make identical choices, so individual mistakes become systemic, and collusion appears even without a private channel.
- **Epistemic failures:** gullibility toward a lying source, and premature consensus in hidden-profile tasks. Fixing one by adjusting a single trust setting worsens the other.
- **Incompatible goals:** agents assume hostility and escalate to sabotage (account lockouts, kill loops, disguised malware) unless they reach a truce.

Prescriptive roles and a "CEO hierarchy" prompt "did not make much difference". The authors call for social mechanisms (norms, reputation, costly signaling, recourse) redesigned for agents. A central forum for agreeing protocols "depends on the agents' prompting and motivations".

**Key numbers.**
- 18 of 30 agents created the identical branch name "mvp-game-loop" [full].
- Job-queue experiment: 2.4 million requests vs 117 jobs accepted [full].
- Vulnerability swarm (Mythos Preview): 266 vulnerabilities over 27M tokens vs 21 over 6.5M for independent parallel agents, about half outside the core directories and 12 in common [full].
- Hidden profile: 4-agent groups, n=400 episodes per model [full].
- Turf war: n=120 episodes per model [full].

**Relation to Decorum.** This is the team's motivating reference and the threat model for E2. Conformity motivates enforced `dissent` and visibility rules. Premature consensus motivates review and dissent. Incompatible goals motivate `escalation`. That role and hierarchy *prompts* changed little argues for enforced rather than prompted rules.

**Limitation.** Descriptive blog post with figures but few tabulated per-model numbers; Claude-only swarms; no intervention is evaluated systematically.

### 15. How we built our multi-agent research system (Anthropic Engineering)
Jeremy Hadfield, Barry Zhang, Kenneth Lien, Florian Scholz, Jeremy Fox, Daniel Ford. Blog post, 13 Jun 2025. <https://www.anthropic.com/engineering/multi-agent-research-system> (not on arXiv; linked).

**Summary.** A lead agent plans and spawns 3–5 parallel subagents with explicit objectives, output formats and tool guidance. A memory store survives context truncation, and a citation agent attaches sources. Early failures were coordination failures: 50 subagents spawned for simple queries, duplicated work, gaps, and endless searching. These were fixed by hand-written delegation and effort-scaling rules in the prompt.

**Key numbers.**
- Multi-agent (Opus 4 lead + Sonnet 4 subagents) beats single-agent Opus 4 by 90.2% on an internal research eval [full].
- On their BrowseComp analysis, token usage explains 80% of performance variance, and token usage, tool calls and model choice together explain 95% [full].
- Multi-agent systems use about 15× the tokens of chat [full].

**Relation to Decorum.** This is the manager-led harness shape Decorum targets (main agent spawns subagents). The token-variance result is why Decorum must compare at **equal token budget** and treat cost as a hard cap. Otherwise a rulebook that just spends more would "win".

**Limitation.** Internal eval, not public. The delegation rules are hand-tuned prompt heuristics.

### 16. On the Formal Specification of Electronic Institutions
Marc Esteva, Juan A. Rodríguez-Aguilar, Carles Sierra, Pere Garcia, Josep Ll. Arcos. In *Agent Mediated Electronic Commerce: The European AgentLink Perspective*, LNAI 1991, pp. 126–147, Springer, 2001. <https://doi.org/10.1007/3-540-44682-6_8> (paywalled; linked).

**Summary.** The paper specifies an electronic institution formally as a dialogical framework (roles, ontology, illocutions), scenes (conversation protocols as finite-state graphs), a performative structure (how agents move between scenes) and normative rules (obligations created by actions). Agents interact *only* through the institution, which "regiments" what can be said and done.

**Key numbers.** None (formal specification).

**Relation to Decorum.** This is the intellectual ancestor: rules of conduct enforced by infrastructure (Decorum's chair), not by agent goodwill. Decorum's threads and tasks resemble scenes, and its typed primitives resemble illocution constraints and normative rules. The new step is that the rules are *learned*, for LLM agents.

**Limitation.** Rules are hand-specified for closed, well-structured domains such as auctions; there is no optimization.

### 17. Introduction to Normative Multiagent Systems
Guido Boella, Leendert van der Torre, Harko Verhagen. *Computational and Mathematical Organization Theory* 12(2–3):71–79, 2006. <https://doi.org/10.1007/s10588-006-9537-7> (linked).

**Summary.** The paper defines a normative MAS as a multi-agent system together with normative systems in which agents can decide whether to follow the explicitly represented norms, and the normative systems specify how and to what extent agents can modify them. It sets the agenda: norm representation, violation detection, sanctions, and norm change.

**Key numbers.** None (position and introduction).

**Relation to Decorum.** It supplies the vocabulary for Decorum's rulebook (obligations, prohibitions, violation, sanction, norm change). Decorum's outer loop is "norm change" done by an optimizer rather than by agents or designers.

**Limitation.** Conceptual; predates LLM agents.

---

## What this theme implies for Decorum's design

1. **State the novelty against Constitutional Evolution, not against "nobody evolves rules".** Evolving the rules of interaction of an LLM collective is already shown to beat human and LLM-written rules (2602.00755, 2605.09128, 2608.24545). Decorum's defensible novelty is five things together:
   - **enforced** typed primitives vs prompted norms;
   - a **manager-led task-solving harness** with emergent topology;
   - a **head-to-head with topology design at equal token budget**;
   - **adversarial robustness**;
   - **cross-domain transfer** and an **optimizer-input ablation**.
2. **Copy the content-ablation from 2608.24545.** Replay the emergent topology of evolved-rulebook runs with the rule content removed or randomized. If the gain disappears, the rules (not the graph) carry it.
3. **Expect brittleness in E3.** An evolved constitution went from best to worst under a one-parameter incentive shift (2605.09128). Pre-register the transfer test and consider an amendable-scaffold variant.
4. **Evidence must be checkable.** Sanctions and closing rules give zero gain when violations cannot be observed (2608.11357). The coding adapter should close on executed tests, and the research adapter on resolvable citations.
5. **Bound the review primitive.** Reject–revise gates explode on weaker models (2604.27691: 18 of 23 tasks hit the step cap), so review needs a loop or budget limit or an escalation path.
6. **Equal budget is non-negotiable.** Tokens explain 80% of variance in Anthropic's research system; multi-agent runs use about 15× chat tokens.
7. **Baselines to borrow:**
   - SocialSystemArena governance specs (2604.27691, code public) as hand-designed topologies, best chosen per model;
   - HiddenBench's Exchange-then-Decide (2505.11556) as a hand-designed dissent rule;
   - Institutional AI's governance graph (2601.11369) as a hand-designed enforced rule set.

## Added by validation

Found by the validation pass (fresh Kestrel searches and `similar_papers`, 2026-10-01). Abstracts read and methods skimmed; numbers are from the abstract only. None of the five changes the novelty assessment above, but V1 and V2 use the exact words "self-evolving coordination protocol" and "communication policy evolution", so a reviewer may raise them.

### V1. Self-Evolving Coordination Protocols (SECP)
Jose Manuel de la Chica Rodriguez, Juan Manuel Vera Díaz. *Self-Evolving Coordination Protocol in Multi-Agent AI Systems: An Exploratory Systems Feasibility Study.* arXiv:2602.02170, 2026. https://arxiv.org/abs/2602.02170 · PDF: `2026-delachicarodriguez-self-evolving-coordination-protocol.pdf`

Coordination protocols that may modify themselves in limited, externally validated ways while fixed formal invariants hold. In a proof of concept, six LLM decision modules (Claude Sonnet 4.5 and GPT-4) evaluate six Byzantine-consensus protocol proposals. Four coordination regimes are compared: unanimous hard veto, weighted scalar aggregation, SECP v1.0 (an agent-designed non-scalar protocol), and SECP v2.0 (after one governed modification).
- Key numbers [abs]: one recursive modification raised coverage from 2 to 3 accepted proposals while all declared invariants held. The authors explicitly claim no statistical significance, optimality, convergence or learning.
- **Relation to Decorum:** same idea, coordination logic as a governed and evolvable layer with invariants that cannot be modified. But it is a single-shot architectural feasibility demo of an aggregation rule, not an optimiser over task-solving runs. Cite it to show the idea has been floated, and that Decorum supplies the missing evaluation.
- **Limitation:** n = 1 modification, one decision problem, coverage as the only metric.

### V2. Communication Policy Evolution (CPE)
Xinbei Ma, Jiyang Qiu, Yao Yao, et al. (13 authors). *Communication Policy Evolution for Proactive LLM Agents.* arXiv:2606.14314, 2026. https://arxiv.org/abs/2606.14314 · PDF: `2026-ma-communication-policy-evolution.pdf`

Formalises a *communication policy*: how and when an agent communicates across text and UI channels. It is studied in User–Agent and Planner–Executor settings with information asymmetry. CPE refines the policy through rollouts and prompt-level evolution by an LLM optimizer.
- Key numbers: none in the abstract. The claim is that CPE "achieves the best task success across multiple settings using prompt refinement alone" [abs].
- **Relation to Decorum:** the nearest "evolve the communication rules for task success" result in a two-party planner–executor setting. Its policy is prompt-only and covers one channel between two roles, not a rulebook for a team.
- **Limitation:** two roles; prompt-level only; no enforcement, adversaries or cross-domain transfer reported in the abstract.

### V3. AgensFlow: coordination as online policy learning
Nicole Koenigstein. *AgensFlow: A Coordination-Policy Substrate for Multi-Agent Systems.* arXiv:2605.27466, 2026. https://arxiv.org/abs/2605.27466 · PDF: `2026-koenigstein-agensflow.pdf`

Treats multi-agent coordination choices as an online policy-learning problem under partial observability: skill protocol, role, model binding, topology, whether to verify or skip a step. It learns an inspectable policy graph from repeated trajectories, with typed handoffs and an auditable reward layer.
- Key numbers: none in the abstract. Learned routing reaches a higher-quality operating point than a fixed pipeline on coordination-heavy classes [abs]. Evaluated on incident and security-advisory tasks.
- **Relation to Decorum:** learns coordination decisions from traces instead of fixing them, but as a routing policy over pipeline choices, not as an enforced rulebook for a free manager agent.
- **Limitation:** 7-page single-author study on two corpora; no adversaries or transfer.

### V4. AgentLance: markets, not planners
Xiao Liu, Haoyang Li, Songwei Li, Hongbo Fang, Fengli Xu, Feng Shi, James Evans. *Markets, Not Planners: Decentralized Orchestration of LLM Agents with Private Information.* arXiv:2608.23867, 2026. https://arxiv.org/abs/2608.23867 · PDF: `2026-liu-markets-not-planners-agentlance.pdf`

Replaces a central LLM planner with a repeated labour market. Agents bid with private costs; an allocator uses bids and public reputation; a VCG-style payment rewards cost-aware bidding. Winners may subcontract through the same mechanism (hierarchical delegation).
- Key numbers [abs]: a single inserted preference nearly doubles a favoured agent's task share under a centralised LLM allocator. AgentLance outperforms single-model, centralised and market baselines across math, code, QA and agentic tasks.
- **Relation to Decorum:** a hand-designed, code-enforced allocation mechanism, i.e. an institution rather than a topology. It also shows a manipulation vulnerability of the central manager that Decorum's E2 threat model should cover. It does not evolve the mechanism.
- **Limitation:** working paper; the mechanism is fixed by design.

### V5. Normative multi-agent systems for human–AI software-engineering teams (vision)
Hoa Khanh Dam, Geeta Mahala, Rashina Hoda, Xi Zheng, Cristina Conati. *Towards autonomous normative multi-agent systems for Human-AI software engineering teams.* arXiv:2512.02329, 2025. https://arxiv.org/abs/2512.02329 · PDF: `2025-dam-normative-mas-human-ai-se-teams.pdf`

A vision paper: BDI-style LLM software-engineering agents whose coordination is governed by deontic norms (commitments, obligations, prohibitions, permissions).
- Key numbers: none (no experiments).
- **Relation to Decorum:** the normative-MAS framing applied to software-engineering teams; Decorum's typed primitives are a concrete, evaluated, optimised instance of that kind of norm system.
- **Limitation:** position paper; no implementation or evaluation.
