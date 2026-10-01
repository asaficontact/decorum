# Humans in the loop of agent teams: when to escalate, and what it buys

This group of work puts a human (or a stand-in for one) inside an agent system and asks two questions: *when* should the system bring the human in, and *how much* does each human intervention buy. The papers fall into four strands: systems and frameworks that make the human a participant (Magentic-UI, Co-Gym); learned escalation policies that trade task reward against a per-intervention cost (ReHAC, HILA); benchmarks and protocols that measure escalation judgment and timing with an oracle "human" holding the missing information (HiL-Bench, Ambig-SWE, Ask Early/Ask Late, prefix branching in *Calibration Is Not Control*); and the cost and validity of the human itself (*Oversight Has a Capacity*, *Mind the Sim2Real Gap*). They agree on three things. Small, well-timed human input recovers a lot (Magentic-UI 30.3% → 51.9% on GAIA with help requested in only 10% of tasks; Ambig-SWE up to 74% over non-interactive). Agents judge badly when to ask (HiL-Bench: 75–89% pass@3 with full information, 4–24% when they must decide whether to ask). And a simulated user flatters the agent (Sim2Real: simulators push success above the 63.6% real-human baseline, up to 77.8%). The shared limitation, which Decorum addresses: the escalation policy is either hand-written (action guards, "ask when stuck" prompts) or learned into model weights by RL (ReHAC, HILA, HiL-Bench RLVR). In none of them is it a readable, enforced rule of interaction that an outer loop can edit, and none measures what escalation buys under attack (saboteur or injected subagent). The multi-agent cases (HILA, Magentic-UI) let only a fixed orchestrator or every agent call the human directly. None treats the human as a member of a shared thread whose entry is governed by a team rulebook with a per-task intervention budget.

| Paper | Year | Venue | arXiv | What it is | Role for Decorum |
|---|---|---|---|---|---|
| ReHAC: LLM-based Human-Agent Collaboration (Feng et al.) | 2024 | Findings of EMNLP 2024 | [2402.12914](https://arxiv.org/abs/2402.12914) | Offline-RL policy deciding at each step whether human or agent acts; reward = task − λ·#interventions | closest work (optimizes the escalation policy) |
| HILA: Adaptive Collaboration with Humans (Yang et al.) | 2026 | ICLR 2026 | [2603.07972](https://arxiv.org/abs/2603.07972) | Multi-agent LLM system whose agents learn EVAL/CREATE/DEFER with a cost-aware GRPO reward; expert answers become SFT data | closest work (MAS + learned deferral to human) |
| Magentic-UI (Mozannar et al.) | 2025 | arXiv | [2507.22358](https://arxiv.org/abs/2507.22358) | Open-source multi-agent HITL system: co-planning, co-tasking, action guards; simulated-user GAIA eval; 24 adversarial scenarios | baseline (hand-designed escalation) / closest system |
| Calibration Is Not Control (Zhang et al.) | 2026 | arXiv | [2606.21399](https://arxiv.org/abs/2606.21399) | "Intervention advantage" as the decision object for oversight; prefix-branching counterfactual protocol | evidence for a design choice (metric for recovery per intervention) |
| HiL-Bench (Trinh et al.) | 2026 | arXiv | [2604.09408](https://arxiv.org/abs/2604.09408) | 300 SWE/SQL tasks with hidden blockers; `ask_human()` oracle; Ask-F1 | benchmark candidate / oracle design |
| Ask Early, Ask Late, Ask Right (Gulati et al.) | 2026 | arXiv | [2605.07937](https://arxiv.org/abs/2605.07937) | Forced injection of ground-truth clarifications at controlled trajectory points; 6,000+ runs | evidence for a design choice (escalation timing) |
| Ambig-SWE (Vijayvargiya et al.) | 2025 | ICLR 2026 | [2502.13069](https://arxiv.org/abs/2502.13069) | Underspecified SWE-Bench Verified; GPT-4o user proxy holding the full issue | benchmark candidate (coding + simulated human) |
| Oversight Has a Capacity (Turan) | 2026 | arXiv | [2606.08919](https://arxiv.org/abs/2606.08919) | Action-gating guard as selective classification; fatiguing-reviewer model; flooding attack | threat model / evidence for the budget |
| Mind the Sim2Real Gap (Zhou et al.) | 2026 | COLM 2026 | [2603.11245](https://arxiv.org/abs/2603.11245) | Full τ-bench run with 451 real humans versus 31 LLM user simulators | evidence for a design choice (simulated human validity) |
| Collaborative Gym (Shao et al.) | 2024 | ICLR 2026 | [2412.15701](https://arxiv.org/abs/2412.15701) | Non-turn-taking human-agent collaboration framework with simulated and real-user conditions | background / template for the real-human pilot |

---

## ReHAC — Feng et al. 2024
Xueyang Feng, Zhi-Yuan Chen, Yujia Qin, Yankai Lin, Xu Chen, Zhiyuan Liu, Ji-Rong Wen. *Large Language Model-based Human-Agent Collaboration for Complex Task Solving.* Findings of EMNLP 2024, pp. 1336–1357. arXiv:2402.12914. https://arxiv.org/abs/2402.12914 · PDF: `2024-feng-llm-based-human-agent-collaboration-rehac.pdf`

**Summary.** ReHAC casts human-agent collaboration as an MDP in which, at every step, a policy model decides whether the human or the LLM agent (ReAct, gpt-3.5-turbo) takes the next action. The reward is `R(s,a) = T(s,a) − λ·C(s,a)`, where C counts human interventions in the rest of the trajectory. That makes the escalation policy an explicit optimization of task success against intervention cost. The policy (7B/13B) is trained offline with REINFORCE on trajectories where each action was randomly assigned to a human annotator or the agent. It is evaluated on HotpotQA, StrategyQA and InterCode-SQL. Because real annotation is expensive, GPT-4 stands in for the human in most experiments. The paper checks this substitution only by agreement of relative method rankings on HotpotQA.

**Key numbers.**
- Average 25.8% relative improvement over baselines on HotpotQA [full: Findings-EMNLP camera-ready PDF, §1. Not in the arXiv v1 PDF or in either abstract; source tag corrected by validation 2026-10-01].
- At λ = 0.06, ReHAC reaches higher reward than the prompt-based escalation baseline with ~30% *more* interventions; at λ = 0.1 it gains reward with ~20% *fewer* interventions [full, Fig. 2a text].
- The human intervention rate falls monotonically as λ rises, and task performance falls with it [full].
- A policy trained on GPT-4-simulated collaboration data beat the one trained on real-human data when tested with real humans at λ = 0.06 and 0.08. The authors attribute this to human variance [full].
- Real-human data came from 14 annotators, who were allowed to consult GPT-4's answers [full, App.].

**Relation to Decorum.** This is the direct prior for "optimize the escalation rule against a per-intervention penalty": λ plays the role of Decorum's intervention budget, and the prompt-based baseline matches Decorum's "human on demand". Decorum differs in three ways. Its policy is a readable rulebook primitive evolved by a reflective optimizer rather than a trained policy network. It sits in a manager-led *multi-agent* harness. And it is scored on failed and attacked runs.

**Limitation.** Single ReAct agent, short QA/SQL tasks, a human assumed better than the agent. Most results use GPT-4 as the human, and the simulator is validated only by rank agreement.

## HILA — Yang et al. 2026
Wei Yang, Defu Cao, Jiacheng Pang, Muyan Weng, Yan Liu. *Adaptive Collaboration with Humans: Metacognitive Policy Optimization for Multi-Agent LLMs with Continual Learning.* ICLR 2026. arXiv:2603.07972. https://arxiv.org/abs/2603.07972 · PDF: `2026-yang-hila-metacognitive-policy-human-in-the-loop-mas.pdf`

**Summary.** HILA gives every agent in a debate-style multi-agent system three meta-actions. EVAL exploits the current collective answers, CREATE explores new ones, and DEFER replaces the round's output with an external expert's solution. An inner loop trains the choice with GRPO and the reward `R_gt − C_create` or `R_gt − C_defer` (with `C_defer > C_create`). An outer loop turns each deferral's expert demonstration into SFT data, so the system needs the human less over time. The "human" in the main experiments is GPT-4o-mini. An appendix repeats three benchmarks with 20 PhD experts whose answers were collected offline in advance.

**Key numbers.**
- On Llama3-8B, absolute gains of 3.7–15.4 points over the strongest autonomous MAS baseline (LLM-Debate, DyLAN, GPTSwarm, AFlow) on every benchmark [full, §4].
- The DEFER share drops from the initial policy to full DLPO: 29% → 17% (GSM8K), 24% → 12% (AMC) and 19% → 5% (MMLU) [full, Table 5].
- Results rise with the strength of the proxy expert (gpt-3.5-turbo < gpt-4o-mini < gpt-4o) [full, Fig. 2].

**Relation to Decorum.** This is the closest multi-agent prior: a MAS that learns when to escalate to a human under a cost, and it is compared against topology baselines (GPTSwarm, AFlow) as Decorum is. Decorum differs in four ways. Its escalation is a team rule enforced by the harness and evolved as text, not a per-agent policy in the weights. The human joins a thread rather than overwriting the round's output. The budget is a hard cap per task. And recovery is measured on failed and attacked runs.

**Limitation.** The "human" is mostly a stronger LLM, so deferral is close to a model cascade. The real-human study is offline (answers collected in advance, not interactive), and the tasks are short math/QA with gold answers.

## Magentic-UI — Mozannar et al. 2025
Hussein Mozannar, Gagan Bansal, Cheng Tan, Adam Fourney, Victor Dibia, et al. (20 authors). *Magentic-UI: Towards Human-in-the-loop Agentic Systems.* arXiv:2507.22358, 2025. https://arxiv.org/abs/2507.22358 · PDF: `2025-mozannar-magentic-ui-human-in-the-loop-agentic-systems.pdf`

**Summary.** Magentic-UI is an open-source web interface on an orchestrator-led multi-agent system (from Magentic-One / AutoGen). It offers co-planning, co-tasking, multi-tasking, action guards, answer verification and memory. Action guards are an enforced escalation rule. Each action carries a developer-set irreversibility tag (always / maybe / never); "always" goes to the human, "never" runs, and "maybe" goes to an LLM judge. Evaluation covers autonomous benchmarks, a simulated-user GAIA study, a 12-person qualitative study and 24 adversarial scenarios.

**Key numbers.**
- On GAIA validation (162 tasks), a GPT-4o simulated user holding GAIA's human-written solution plan lifts task completion from 30.3% to 51.9% (+71% relative). Help was requested in 10% of tasks (1.1 requests on average when asked), and the simulated user supplied the final answer in 18% of tasks [full, §7.3].
- An o4-mini "smarter" simulated user gives 42.6%, with help requested in 4.3% of tasks (1.7 times when asked) [full].
- The tuned simulated-user prompt still leaked the answer in 6% of tasks [full].
- With default mitigations, 0 of 24 adversarial scenarios succeeded. With mitigations disabled in code, prompt injection got the agent to exfiltrate SSH keys and create a GitHub API key [full, §7.5].

**Relation to Decorum.** This is the right "human on demand" and "hand-designed enforced escalation" baseline. The irreversibility-tagged action guard is exactly the `when: irreversible action` trigger that Decorum's `escalation_to_human` primitive generalizes and evolves. Its numbers are close to "recovery per intervention", but they are confounded: the 18% of tasks where the simulated user supplied the final answer should be counted separately in Decorum's metric.

**Limitation.** The escalation policy is fixed and partly prompt-driven ("ask when stuck"). There is no budget and no optimization. The simulated user leaks answers, and safety is tested on a small internal scenario set.

## Calibration Is Not Control — Zhang et al. 2026
Chubin Zhang, Zhenglin Wan, Xingrui Yu, Jingxuan Wu, Qi Wen, Pengfei Zhou, Wangbo Zhao, Ivor Tsang. *Calibration Is Not Control: Why LLM-Agent Oversight Needs Intervention.* arXiv:2606.21399, 2026. https://arxiv.org/abs/2606.21399 · PDF: `2026-zhang-calibration-is-not-control.pdf`

**Summary.** The paper argues that runtime oversight targets the wrong quantity when it thresholds a risk or confidence score. The quantity that matters is *intervention advantage*: the expected utility gain from intervening rather than continuing at a given trajectory prefix. Two prefixes can carry the same risk score while only one is still recoverable. The paper introduces *prefix branching*, which replays the same prefix and executes continue / intervene / quit from it, so the oracle action and controller regret can be measured. The interventions vary in strength across benchmarks: defer-to-expert (ALFWorld), gold-prefix handoff (ScienceWorld), and same-model verify/re-answer (GSM8K, HotpotQA). The utility includes an explicit intervention cost.

**Key numbers.**
- A prefix-only action-conditioned controller cuts control regret from 0.506 to 0.110 on ALFWorld [abs] and from 0.245 to 0.169 on ScienceWorld [full].
- Recalibrating a scalar score reduces ECE from 0.463 to 0.006 but leaves regret fixed at 0.318 [full].
- Gains shrink when interventions are weak (the same-model re-answer cases) [abs].

**Relation to Decorum.** Prefix branching is a ready protocol for measuring *recovery per human intervention*: fork a failed or attacked Decorum run at the escalation point, run it with and without the (simulated) human, and take the difference. It also warns that an escalation trigger based on a confidence score (e.g. "agent says it is unsure") is the wrong target. Triggers keyed to recoverability, such as unresolved dissent or failed attempts, are closer to intervention advantage.

**Limitation.** Single-agent, offline, single-rollout protocol with three-way actions. The "expert" is not a human, and the authors call the controller a witness, not an optimal design.

## HiL-Bench — Trinh et al. 2026
Tu Trinh, Mohamed Elfeki, Guangze Luo, Kelvin Luu, et al. (12 authors). *HiL-Bench (Human-in-Loop Benchmark): Do Agents Know When to Ask for Help?* arXiv:2604.09408, 2026. https://arxiv.org/abs/2604.09408 · PDF: `2026-trinh-hil-bench-when-to-ask-for-help.pdf`

**Summary.** HiL-Bench contains 300 tasks (150 from SWE-Bench Pro, 150 text-to-SQL), each with human-validated blockers: missing, ambiguous or contradictory information that surfaces only through exploration. Agents can call `ask_human(question)`. A frozen Llama-3.3-70B judge returns a blocker's resolution only if the question targets a registered blocker, and otherwise returns "irrelevant question". The metric is Ask-F1, the harmonic mean of question precision and blocker recall, which penalizes both over-asking and silent guessing. RL on a shaped Ask-F1 reward improves a 32B model's help-seeking and pass rate, and the improvement transfers across domains.

**Key numbers.**
- 75–89% pass@3 with full information, against 4–24% when the model must judge when to call `ask_human()` [full, Fig. 1].
- Best model with the tool: 38% on SQL and 12% on SWE. Mean Ask-F1 is 40.5% on SQL and 37.4% on SWE [full, §3.5].
- 1,131 blockers, 3.8 per task on average [full].

**Relation to Decorum.** This gives Decorum an oracle design for its simulated human: an oracle that answers only targeted questions, so it cannot simply solve the task, which fixes the leakage problem seen in Magentic-UI. It also offers a process metric (Ask-F1) for escalation quality. The large "judgment gap" is the motivation for making escalation an enforced rule rather than leaving it to the model.

**Limitation.** Single-agent and clarification-only: the human resolves missing information, not failures or attacks. The oracle is a fixed lookup, not a person.

## Ask Early, Ask Late, Ask Right — Gulati et al. 2026
Anmol Gulati, Hariom Gupta, Elias Lumer, Sahil Sen, Vamse Kumar Subbiah. *Ask Early, Ask Late, Ask Right: When Does Clarification Timing Matter for Long-Horizon Agents?* arXiv:2605.07937, 2026. https://arxiv.org/abs/2605.07937 · PDF: `2026-gulati-ask-early-ask-late-clarification-timing.pdf`

**Summary.** The paper uses a forced-injection framework. Ground-truth clarifications of four kinds (goal, input, constraint, context) are injected at controlled fractions of an oracle-calibrated action budget, across three benchmarks (including TheAgentCompany and SWE-Bench Pro) and four frontier models. This yields empirical "demand curves": the value of a human intervention as a function of when it arrives. A separate study of 300 unscripted sessions checks when models ask on their own.

**Key numbers.**
- A goal clarification loses nearly all its value after 10% of execution (pass@3 falls from 0.78 to baseline). An input clarification keeps its value until about 50% [abs].
- Any clarification deferred past mid-trajectory leaves performance *below never asking* [abs].
- 84 task variants, 6,000+ runs. Cross-model Kendall τ is 0.78–0.87 among models with identical task coverage [abs].
- In the unscripted sessions, no model asked inside the optimal window, and 52% of sessions over-asked [abs].

**Relation to Decorum.** This is direct evidence that *when* the human is brought in matters as much as *whether*. A rule like "escalate after two failed attempts" may arrive too late for goal-type gaps and could even hurt. The evolved `escalation_to_human` rule should therefore be able to express early, type-specific triggers, and Decorum's analysis should report recovery as a function of escalation time.

**Limitation.** Single-agent clarification with an oracle that injects the truth. It does not cover failure recovery or adversaries, and the code is not yet released.

## Ambig-SWE — Vijayvargiya et al. 2025
Sanidhya Vijayvargiya, Xuhui Zhou, Akhila Yerukola, Maarten Sap, Graham Neubig. *Ambig-SWE: Interactive Agents to Overcome Underspecificity in Software Engineering.* ICLR 2026. arXiv:2502.13069. https://arxiv.org/abs/2502.13069 · PDF: `2025-vijayvargiya-ambig-swe-interactive-agents-underspecificity.pdf`

**Summary.** Ambig-SWE is an underspecified variant of SWE-Bench Verified run in three settings. In Full the agent sees the full issue. In Hidden it sees only a summary. In Interaction it sees the summary and can query a GPT-4o user proxy that holds the full issue, which includes file locations. The evaluation splits interaction into three steps: detecting underspecificity, asking targeted questions, and using the answers.

**Key numbers.**
- Interaction improves performance by up to 74% over the non-interactive setting [abs].
- Models struggle to tell well-specified from underspecified instructions [abs].

**Relation to Decorum.** It is the closest *coding* benchmark with a simulated human holding hidden information, and it fits Decorum's held-out coding domain (E1). Its Full/Hidden/Interaction design maps directly onto Decorum's no-human / human-on-demand / evolved-escalation conditions. A follow-up (Edwards & Schuster, arXiv:2603.26233) shows that a multi-agent scaffold that separates underspecification detection reaches 69.4% resolve on the same setting.

**Limitation.** The user proxy can reveal file locations, which is close to an oracle. The setting covers only missing information, with no failures or attacks.

## Oversight Has a Capacity — Turan 2026
Emre Turan. *Oversight Has a Capacity: Calibrating Agent Guards to a Subjective, Fatiguing Human.* arXiv:2606.08919, 2026. https://arxiv.org/abs/2606.08919 · Code: https://github.com/turangenesis/headroom · PDF: `2026-turan-oversight-has-a-capacity.pdf`

**Summary.** The paper treats an action-approval gate for LLM agents as selective classification under asymmetric cost. It models the reviewer as *endogenous*: the reviewer is reliable up to a capacity C and then degrades as escalation load grows. Under that model, realized safety is an inverted U in the escalation rate, so escalating everything is strictly worse than a load-aware rate. The same load-aware setting resists a *flooding attack* that wears the reviewer out before slipping a malicious action through. The author explicitly credits the mechanisms to prior work (learning-to-defer with fatigue, alert fatigue) and contributes an open measurement system.

**Key numbers.**
- On 125 adversarially weighted actions, three *LLM persona* reviewers agree only at Fleiss' κ = 0.52 [full]. The abstract says "reviewers", but the full text says the personas are proxies for human annotators.
- Risk–coverage AURC is 0.374 ± 0.002 [full].
- The safety-optimal escalation rate is 64%, 64% and 72% for capacity C = 10, 25 and 50. Danger let through at the optimum versus at full escalation is 56% vs 69%, 42% vs 57% and 22% vs 39% [full, Table 2]. This is a modeling result, not a human study.

**Relation to Decorum.** It gives the rationale and the threat model for a *budgeted* `escalation_to_human` primitive. In E2, a saboteur subagent could deliberately trigger escalations to exhaust the human's budget, which is a flooding attack. Decorum should test this case explicitly and report the budget's effect.

**Limitation.** Single author. The fatigue curve and reviewers are modeled, not measured on people, and the action set is small (125).

## Mind the Sim2Real Gap in User Simulation — Zhou et al. 2026
Xuhui Zhou, Weiwei Sun, Qianou Ma, Yiqing Xie, Jiarui Liu, Weihua Du, Sean Welleck, Yiming Yang, Graham Neubig, Sherry Tongshuang Wu, Maarten Sap. *Mind the Sim2Real Gap in User Simulation for Agentic Tasks.* COLM 2026. arXiv:2603.11245. https://arxiv.org/abs/2603.11245 · PDF: `2026-zhou-sim2real-gap-user-simulation.pdf`

**Summary.** This is the first study to run the full τ-bench protocol with real humans: 451 participants on 165 tasks. It compares 31 LLM user simulators against the humans using a new User-Sim Index. The simulators are excessively cooperative, stylistically uniform, and never frustrated or ambiguous. That makes an "easy mode" which inflates agent success, and their feedback is uniformly more positive than real users'. Higher general model capability did not produce a more faithful simulator.

**Key numbers.**
- 451 participants, 165 tasks, 31 simulators [abs].
- Real-human baseline agent success is 63.6%. Most general-purpose simulators give higher success, up to 77.8% [full, App. A.8].

**Relation to Decorum.** Decorum's first human is simulated, an oracle with hidden tests or gold answers. This paper predicts that such an oracle will *overstate* recovery per intervention. The small real-human pilot should therefore be framed and powered as a check on the simulator's validity, not as a showcase. The oracle should be made less cooperative (answer only targeted questions, as in HiL-Bench).

**Limitation.** Customer-service domain (τ-bench), where the user is the *task owner*, not an *expert rescuer*. The gap for a helper-oracle in coding may differ.

## Collaborative Gym — Shao et al. 2024
Yijia Shao, Vinay Samuel, Yucheng Jiang, John Yang, Diyi Yang. *Collaborative Gym: A Framework for Enabling and Evaluating Human-Agent Collaboration.* ICLR 2026. arXiv:2412.15701. https://arxiv.org/abs/2412.15701 · PDF: `2024-shao-collaborative-gym-human-agent-collaboration.pdf`

**Summary.** Co-Gym is an open (MIT) framework for agents that communicate both ways with humans while acting in a shared task environment. Interaction is asynchronous, not turn-taking. It has a simulated condition with a user simulator and a real condition through a web app. The evaluation suite scores both outcomes and collaboration process. It ships three task environments: travel planning, related-work writing and tabular analysis.

**Key numbers.**
- With real users, the best collaborative agents beat their fully autonomous counterparts with win rates of 86% (Travel), 74% (Tabular) and 66% (Related Work) [abs].
- Communication failures in 65% and situational-awareness failures in 40% of real-condition cases [abs].

**Relation to Decorum.** It is a template for running the same harness under a simulated and a real-human condition, which Decorum needs for the real-human pilot. Its non-turn-taking interaction resembles a human posting into a Decorum thread.

**Limitation.** One agent and one human, not a team. Its tasks have no hidden-test success signal, and it does not study when the agent should involve the human.

---

## Considered, not kept (ids verified in Kestrel)
- **2502.04576** Min et al., *Self-Regulation and Requesting Interventions*. A helper policy with an explicit intervention budget C, trained offline with PRMs and tabular RL. The "intervention" is a stronger model or more compute, not a human. Worth citing in the method section if Decorum's budget is formalized.
- **2606.28733** Luo et al., *Agentic Abstention*. CONVOLVE distills full trajectories into reusable *textual stopping rules* without weight updates: Llama-3.3-70B timely-abstention recall rises from 26.7 to 57.4 on WebShop [abs]. This is the closest *mechanism* to evolving an escalation rule as text, but it covers single-agent abstention with no human.
- **2602.11416** Kolluri et al., *Optimizing Agent Planning for Security and Autonomy*. Proposes autonomy metrics: the fraction of consequential actions run without HITL approval under information-flow-control defenses, on AgentDojo/WASP. Relevant to E2's enforced-vs-prompted comparison (theme 04/06).
- **2312.06942** Greenblatt et al., *AI Control*. Protocols against a deliberately subversive model that rely on a *limited budget of trusted high-quality labor* (human audit). It is the canonical threat model for "human budget vs saboteur" and probably belongs in theme 04.
- **2607.04329** HAS-Bench. Humans and agents as first-class graph participants with roles, permissions and channels. It reports that human participation improves completion and *failure recovery* depending on when and by whom, but the abstract has no numbers. Worth reading if a human-in-graph baseline is needed.
- **2411.12924** HULA (Atlassian, ICSE-SEIP 2025). A deployed human-in-the-loop SWE agent in JIRA, evaluated with engineer perceptions only. Dropped: no recovery numbers.
- **2606.05391** Dhanorkar et al. Interviews with 17 developers find four kinds of oversight: a-priori control, co-planning, real-time monitoring and post-hoc review. Background only.
- **2609.30266** Qin et al., *LLM Agents Can Easily Tamper With Their Own Traces*. Every tested harness except one let agents delete their traces. This supports making Decorum's threads append-only and logged outside the agent's control, and it matters for any human who audits threads. It belongs in theme 06 (runtime enforcement).
- **2607.28430** AgentRadio. Threads, messages and wait-for-mention primitives for coding-agent teams (62.1% vs 32.3% single agent on SWE-Atlas QnA). It has no human in the loop, so it belongs in theme 02/05.
- **2309.10691** MINT (ICLR 2024). GPT-4-simulated natural-language feedback gives 2–17% absolute gains [abs]. An early "gain per simulated-feedback turn" number.
- **2604.04918** (four oversight strategies for computer-use agents compared, n = 48) and **2510.05307** (decision-theoretic placement of confirmation points, CHI'26, −13.54% task time) are human-factors evidence that oversight timing matters more than quantity.

## Novelty check for this theme
No paper found (Kestrel, several phrasings, since 2023-06; plus web) evolves the *escalation-to-human rule* as an editable, harness-enforced rule of interaction in a multi-agent system. None measures recovery per human intervention on *attacked* runs either. The nearest are:
- **ReHAC** (2402.12914) and **HILA** (2603.07972), which optimize when to escalate, but as RL-trained policy weights with a scalar cost.
- **Magentic-UI** (2507.22358), which *enforces* escalation (action guards) but by hand.
- **CONVOLVE** in 2606.28733, which learns textual stopping rules from trajectories, but for single-agent abstention without a human.
