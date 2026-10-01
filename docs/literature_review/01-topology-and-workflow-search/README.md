# Searching over multi-agent topologies and workflows

This group of work automates the design of LLM multi-agent systems by searching over their structure:
the communication graph (GPTSwarm, G-Designer), the workflow code (ADAS, AFlow), a distribution over
architectures sampled per query (MaAS), prompts and topology together (MASS). A newer line moves the search
to run time, with an RL-trained orchestrator that picks the next agent (Puppeteer), an orchestrator that
creates sub-agents on demand (AOrchestra), a topology that is mutated during a task (MANTA), or a team
that rewrites its own scaffold and constitution after each task (Meta-Team). Two controlled studies (Kim
et al.; So et al.) show that the architecture changes outcomes a lot, and that a structure tuned on one
domain often fails on another. All of these methods treat *who talks to whom*, and in what order, as the
thing to optimize. What they produce is a graph, a program or a roster, fixed per task or per query. Any rules about
how agents coordinate exist only as prompt text or as control flow inside that artifact. Decorum targets four gaps.
(1) The optimized object is never a set of interaction rules for a manager-led harness, where the topology
is left to emerge at run time. (2) Only MANTA enforces part of its coordination (information visibility) in code rather than in prompts, and
no method compares enforced coordination rules with prompted ones. (3) Robustness to bad actors is tested, when at all, against a simple scripted adversary
on MMLU-style tasks (GPTSwarm, G-Designer), never against saboteurs or prompt-injected sub-agents in agentic coding.
(4) Transfer across domains is weak: topologies show "topological overfitting" (So et al.), and in MANTA's
test, MASS collapses to 0% when its searched system is moved from PlanCraft to WorkBench and back.
The closest prior work is **Meta-Team (2605.29790)**. It already evolves a shared "team constitution" and
coordination rules from execution traces, in a runtime-roster harness, on SWE-bench Pro. Decorum's novelty
has to rest on enforcement, robustness under attack and zero-shot transfer, not on "evolving rules" alone.

| Paper | Year | Venue | arXiv | What it is | Role for Decorum |
|---|---|---|---|---|---|
| Evolve as a Team (Meta-Team) | 2026 | preprint | [2605.29790](https://arxiv.org/abs/2605.29790) | Team evolves its agent scaffolds, teammate profiles and a shared constitution / coordination rules from post-task discussion | **closest work** (novelty threat) |
| MANTA | 2026 | preprint | [2607.28527](https://arxiv.org/abs/2607.28527) | Plans a topology per task and mutates it at run time (roles, links, code-enforced visibility, validation paths); cross-run playbook | closest work; baseline candidate |
| AOrchestra | 2026 | preprint | [2602.03786](https://arxiv.org/abs/2602.03786) | Orchestrator spawns sub-agents on the fly as (Instruction, Context, Tools, Model); orchestrator prompt optimized from traces + cost | closest work (harness shape); baseline |
| Multi-Agent Collaboration via Evolving Orchestration (Puppeteer) | 2025 | NeurIPS 2025 | [2505.19591](https://arxiv.org/abs/2505.19591) | RL-trained central orchestrator picks the next agent; topology emerges at run time | closest work (runtime topology); background |
| AFlow | 2025 | ICLR 2025 | [2410.10762](https://arxiv.org/abs/2410.10762) | MCTS over code-represented workflows | baseline (evolved workflow) |
| ADAS — Automated Design of Agentic Systems | 2025 | ICLR 2025 | [2408.08435](https://arxiv.org/abs/2408.08435) | Meta agent writes new agent systems in code from an archive | baseline; template for "optimizer writes primitives" stretch |
| MASS — Multi-Agent Design | 2026 | ICLR 2026 | [2502.02533](https://arxiv.org/abs/2502.02533) | Staged prompt → topology → prompt optimization | baseline; evidence (prompts matter more than topology) |
| GPTSwarm — Language Agents as Optimizable Graphs | 2024 | ICML 2024 | [2402.16823](https://arxiv.org/abs/2402.16823) | Agents as computational graphs; node (prompt) and edge (connectivity) optimization | baseline (evolved graph, same-optimizer stretch); threat-model precedent |
| G-Designer | 2025 | ICML 2025 | [2410.11782](https://arxiv.org/abs/2410.11782) | VGAE decodes a task-specific communication topology | baseline; robustness precedent |
| MaAS — Multi-agent Architecture Search via Agentic Supernet | 2025 | ICML 2025 (oral) | [2502.04180](https://arxiv.org/abs/2502.04180) | Query-dependent sampling from a supernet of agentic operators | baseline (cost-aware) |
| Towards a Science of Scaling Agent Systems | 2025 | preprint | [2512.08296](https://arxiv.org/abs/2512.08296) | 260 controlled configs: 5 architectures × 6 benchmarks × 3 LLM families | evidence for a design choice (single-agent baseline, review primitive) |
| Superficial Success vs. Internal Breakdown | 2026 | preprint | [2604.18951](https://arxiv.org/abs/2604.18951) | Adaptive MAS (AFlow, AgentDropout) overfit topologies to the training domain | evidence for E3 (transfer) |

---

## Evolve as a Team: Collaborative Self-Evolution for LLM-based Multi-Agent Systems (Meta-Team)
Zhezheng Hao, Tianfu Wang, Huanshuo Dong, Ziyan Liu, Hong Wang, Xiankun Lin, Qiang Lin, Can Wang, Hande Dong, Jiawei Chen. arXiv:2605.29790, 2026.
<https://arxiv.org/abs/2605.29790> · code: <https://github.com/zz-haooo/Meta-Team> · PDF: `2026-hao-evolve-as-a-team-meta-team.pdf`

**Summary.** The paper models a MAS as agents plus an orchestration mechanism, O = (P, S). P is the inter-agent protocol (when and how agents exchange information and hand off results). S is a shared team scaffold: roster, organization and a "team constitution" that holds common objectives, collaboration principles and decision rules. After each task, the agents keep their own local traces and talk to each other to attribute failures, instead of flattening the trajectory into one analyzer. They then update at three levels. L1 is each agent's scaffold. L2 is the protocol, written as teammate profiles and collaboration notes. L3 is the constitution, coordination rules and candidate roster, revised by collective discussion. The harness has an open roster: agents are recruited at run time with `StartAgent`, and messages go over an append-only bus, so the shape is close to Decorum's. Evolution uses about 20 instances per benchmark; evaluation is on a disjoint held-out split of the same benchmark.

**Key numbers.**
- Average over 9 benchmark columns (SWE-bench Pro ×2, BeyondSWE ×2, LOCA, GAIA, LoCoBench ×2, ResearchRubrics), Claude Sonnet 4.6, avg@3. Meta-Team 62.7. The unevolved hand-designed MAS 56.1, single agent 56.8, AOrchestra 57.8, MASFly 56.4 [full, Table 1].
- The unevolved hand-designed MAS underperforms the single agent on 6 of 9 columns [full, §4.2].
- Ablation, SWE-bench Pro Ansible / ResearchRubrics: full 53.9 / 55.8; without team-level (constitution) evolution 51.9 / 52.1; without interaction-level 50.7 / 54.4; without agent-level 48.5 / 47.9 [full, Table 3].
- Collaborative failure attribution beats a single global analyzer on traces longer than 128K tokens (TraceElephant, 220 traces) [full, Fig. 1].
- Average improvement of 6.6% over hand-crafted MAS [full, §1]; this is 6.6 points (62.7 vs 56.1, Table 1), which the paper writes as %. The abstract gives no numbers.

**Relation to Decorum.** This is the nearest prior work found. It evolves coordination rules and a constitution (a rulebook in prose), in a runtime-roster harness, on coding and research, from traces and scores. What separates Decorum: (a) the rules are typed primitives *enforced* by tools and hooks, while Meta-Team's constitution is "the global prompt" (§3.2; its run-time primitives such as `StartAgent`/`Finalize` are fixed code and per-agent tool lists live in an editable `config.yaml`, but no evolved coordination rule is enforced); (b) Decorum's evolution is an outer optimizer, not the team itself; (c) E2 (adversaries) has no counterpart here, and for E3 Meta-Team tests generalization only within a benchmark (evolved on Python, evaluated on C/C++/Java in LoCoBench; evolved at 96K context, evaluated at 8K–256K in LOCA-Bench, §4.4), never across task domains such as coding → research. (Validation note: an earlier differentiator "(d) Decorum compares against hand-designed topologies at equal budget" was removed, because Meta-Team already compares against hand-crafted MAS — its unevolved MAS, OWL, AOrchestra, AggAgent — under shared per-case time/message/cost limits, App. F.3.) Recommended: run a Meta-Team-style "evolve only the prose `norms:`" arm as the prompted-rules baseline, and cite Meta-Team explicitly in the claim.

**Limitation.** The evolved rules are prompt-only and unenforced. The evolution set is about 20 instances per benchmark. There is no adversarial evaluation, and generalization is tested only within a benchmark (cross-language, cross-context-length), not across task domains. The authors say it does not adapt "environment harnesses, verifiers", which is exactly where Decorum puts enforcement.

## MANTA: Multi-Agent Network Topology Adaptation for Self-Evolving Multi-Agent Systems
Mao-xun Huang, Jerry Wang, Yi-Cheng Lai, Zhengxin Zhang, Claire Cardie, Hen-Hsen Huang. arXiv:2607.28527, 2026.
<https://arxiv.org/abs/2607.28527> · PDF: `2026-huang-manta-topology-adaptation.pdf`

**Summary.** A Topology Planner designs a team for each task (size, interaction pattern, roles, optional verifier), and deterministic code validates it. A Trace Auditor flags process anomalies without seeing the answer. A Controller then allows one bounded mutation, of at most three operations: add or expand an agent, rewire edges, or change information visibility. Each agent's context policy (what messages and evidence it can read) is *enforced by code whenever information is read*. A long-term playbook, rewritten every N runs from process-derived labels only (never ground truth), carries topology lessons across runs.

**Key numbers.**
- Average 74.0 over BrowseComp, StableToolBench, PlanCraft, WorkBench and MATH, against 68.2 for the best baseline (ADAS). Gemma 4 31B, 30 questions per benchmark, 3 runs [full, Table 1; abs: +5.8 pts].
- Ablation: replacing the planned topology with a fixed coordinator–worker drops 71.7 → 57.5; removing run-time mutation gives 60.8 [full, Table 2].
- Cross-benchmark transfer, mean Δ: MANTA +3.3, ADAS −3.3, AgentSquare −13.3, MASS −58.3 (MASS goes to 0.0 in both directions) [full, Table 3].
- MANTA uses 77,652 tokens per run, the fewest among the MAS methods [full, Table 4].

**Relation to Decorum.** MANTA's mutation vocabulary (visibility, validation pathways) overlaps with Decorum's primitives, and it enforces visibility in code. But the object it adapts is a topology specification chosen by a planner for each task. Decorum's object is a cross-task rulebook that constrains a free manager. MANTA's transfer table is the best existing evidence that searched topologies transfer badly (E3 motivation).

**Limitation.** n = 30 tasks per benchmark, one open model, one mutation per run. There are no adversaries, and the code enforcement covers visibility (plus structural validation of the topology), not handoff, closing or review.

## AOrchestra: Automating Sub-Agent Creation for Agentic Orchestration
Jianhao Ruan, Zhihao Xu, Yiran Peng, Fashen Ren, Zhaoyang Yu, Xinbing Liang, Jinyu Xiang, Yongru Chen, Bang Liu, Chenglin Wu, Yuyu Luo, Jiayi Zhang. arXiv:2602.03786, 2026.
<https://arxiv.org/abs/2602.03786> · code: <https://github.com/FoundationAgents/AOrchestra> · PDF: `2026-ruan-aorchestra.pdf`

**Summary.** Every agent is a 4-tuple (Instruction, Context, Tools, Model). The orchestrator has only two actions, `Delegate(Φ)` and `Finish(y)`, and creates a tailored sub-agent for each subtask. It is the same main-agent-spawns-subagents shape as Claude Code and Decorum. The orchestrator is improved in two ways: SFT of Qwen3-8B on orchestration trajectories, and iterative in-context optimization, in which an optimizer reads trajectories, performance and cost and edits the orchestrator's instruction.

**Key numbers.**
- +16.28% relative over the strongest baseline with Gemini-3-Flash on GAIA, Terminal-Bench 2.0 and SWE-Bench-Verified [abs].
- Average Pass@1 71.62 against 49.49 for the best baseline (Mini-SWE), Gemini-3-Flash [full, Table 1].
- SWE-Bench-Verified is a random 100-task subset, and Terminal-Bench a 70-task sample [full, App.].
- The instruction optimization reduces average cost by 18.5% [full, §1].
- Caution: their "Claude Code" baseline scores 22.0 (Gemini-3-Flash) / 25.0 (Claude-4.5-haiku) Pass@1 on SWE-Bench-Verified [full, Table 1], which suggests a misconfigured baseline. Do not cite it as a Claude Code number.

**Relation to Decorum.** This is the cleanest published instance of Decorum's harness shape. Its prompt optimization, OPTIMIZE(I, τ, Perf, Cost), is the outer loop Decorum runs, but aimed at one manager prompt instead of an enforced rulebook. It is a natural E1 baseline: "default harness + optimized manager prompt".

**Limitation.** Sub-agents are isolated: there are no shared threads, no successor inheritance and no review or dissent. Beyond a code-fixed action space (`Delegate`, `Finish`) and an attempt cap, nothing constrains how the orchestrator coordinates; there are no coordination rules to enforce.

## Multi-Agent Collaboration via Evolving Orchestration (Puppeteer)
Yufan Dang, Chen Qian, Xueheng Luo, Jingru Fan, Zihao Xie, Ruijie Shi, Weize Chen, Cheng Yang, Xiaoyin Che, Ye Tian, Xuantang Xiong, Lei Han, Zhiyuan Liu, Maosong Sun. NeurIPS 2025. arXiv:2505.19591.
<https://arxiv.org/abs/2505.19591> · code: <https://github.com/OpenBMB/ChatDev/tree/puppeteer> · PDF: `2025-dang-evolving-orchestration-puppeteer.pdf`

**Summary.** A central "puppeteer" policy picks which agent ("puppet") acts next, given the evolving task state. It is trained with REINFORCE on a reward that combines answer quality with a step-wise token/FLOP cost penalty λ·C_t. The topology is never specified; it emerges as the orchestrator's sequence of choices. The analysis finds that the gains come from more compact, cyclic reasoning structures.

**Key numbers.**
- Titan subspace, average over tasks: 0.6893 at initialization, 0.7731 after evolution [full, §3].
- Token consumption falls over training in almost all settings [full, Fig. 2].
- The abstract gives no numbers.

**Relation to Decorum.** It shares Decorum's premise that topology emerges at run time from a manager. It learns the manager's *policy* (weights), whereas Decorum evolves the *rules* the manager and sub-agents must follow, and needs no training.

**Limitation.** Fixed agent set, coarse outcome-only reward. The authors report "deceptive agreement among agents". Nothing in the harness checks evidence or review.

## AFlow: Automating Agentic Workflow Generation
Jiayi Zhang, Jinyu Xiang, Zhaoyang Yu, Fengwei Teng, Xionghui Chen, Jiaqi Chen, Mingchen Zhuge, Xin Cheng, Sirui Hong, Jinlin Wang, Bingnan Zheng, Bang Liu, Yuyu Luo, Chenglin Wu. ICLR 2025. arXiv:2410.10762.
<https://arxiv.org/abs/2410.10762> · code: <https://github.com/FoundationAgents/AFlow> · PDF: `2024-zhang-aflow.pdf`

**Summary.** AFlow treats a workflow as code: LLM-invoking nodes joined by edges, built from operators (Generate, Review, Revise, Ensemble, Test …). Monte Carlo Tree Search, guided by execution feedback and tree-structured experience, modifies that code. It evaluates on six benchmarks: HumanEval, MBPP, MATH, GSM8K, HotpotQA and DROP.

**Key numbers.**
- 5.7% average improvement over state-of-the-art baselines [abs].
- Smaller models beat GPT-4o on some tasks at 4.55% of its dollar cost [abs].
- On MANTA's agentic benchmarks (AFlow run with its own optimization procedure and a matched search budget), AFlow averages 51.6 against 59.3 for a single agent [full, MANTA Table 1]. This is an in-domain result on harder tasks, not a transfer test.

**Relation to Decorum.** This is the standard "evolved workflow" baseline. It optimizes control flow per task family; Decorum optimizes rules over a free manager.

**Limitation.** Workflows are frozen after search and specific to the benchmark. The tasks are short, single-turn problems, with no agentic tool use and no adversaries.

## Automated Design of Agentic Systems (ADAS / Meta Agent Search)
Shengran Hu, Cong Lu, Jeff Clune. ICLR 2025. arXiv:2408.08435.
<https://arxiv.org/abs/2408.08435> · PDF: `2024-hu-automated-design-of-agentic-systems.pdf`

**Summary.** A meta agent writes new agentic systems as Python code, conditioned on a growing archive of earlier discoveries and their scores. Since code is Turing-complete, the search space covers prompts, tools, workflows and new building blocks. The paper reports transfer of the discovered agents across domains and foundation models.

**Key numbers.**
- Agents searched on MGSM and moved to other math sets gain 25.9% on GSM8K and 13.2% on GSM-Hard over baselines [full, §4.3].
- Moved to non-math tasks, the best transferred agent reaches 67.0 ± 3.2 on MMLU against 65.9 ± 3.2 for COT-SC, which is within noise. On DROP it reaches 71.9 F1 against 65.8 for Role Assignment [full, Table 2].
- In MANTA's cross-benchmark test, ADAS's transferred designs lose 3.3 points on average [full, MANTA Table 3].

**Relation to Decorum.** ADAS is the precedent for Decorum's stretch goal of an optimizer that writes new enforcement primitives in code. Its transfer claim is the bar E3 must clear with a fair comparison, and its own non-math transfer is partly within noise.

**Limitation.** It searches over single-run "agent programs", not a long-lived multi-agent harness. Search cost is large, and a follow-up (El et al., 2510.06711) finds that the design cost pays off on only two datasets, even after deployment on more than 15,000 examples [abs].

## Multi-Agent Design: Optimizing Agents with Better Prompts and Topologies (MASS)
Han Zhou, Xingchen Wan, Ruoxi Sun, Hamid Palangi, Shariq Iqbal, Ivan Vulić, Anna Korhonen, Sercan Ö. Arık. ICLR 2026. arXiv:2502.02533.
<https://arxiv.org/abs/2502.02533> · PDF: `2025-zhou-multi-agent-design-mass.pdf`

**Summary.** MASS first analyzes the MAS design space and finds that prompts are frequently the most influential component, and that only a small fraction of topologies matter. It then optimizes in three stages: block-level prompt optimization, then a search for workflow topology over a pruned space, then workflow-level prompt optimization. It distills design principles from the systems it finds.

**Key numbers.**
- Block-level prompt optimization gives about 6% average over single-agent prompt optimization (MIPROv2). Adding topology search gives about 3% more, and workflow-level prompts about 2% more [full, §4 ablation, Fig. 5].
- The abstract gives no numbers.
- In MANTA's transfer test, MASS systems fall to 0.0 on both PlanCraft→WorkBench and WorkBench→PlanCraft [full, MANTA Table 3].

**Relation to Decorum.** MASS's finding that topology contributes about 3 points beside about 8 from prompts supports Decorum's bet that what agents are *told to do* matters more than the graph. It is also a strong single-domain baseline that transfers very poorly.

**Limitation.** Topology space is limited to fixed templates (aggregate, reflect, debate, execute). There is no runtime adaptation and no robustness evaluation.

## Language Agents as Optimizable Graphs (GPTSwarm)
Mingchen Zhuge, Wenyi Wang, Louis Kirsch, Francesco Faccio, Dmitrii Khizbullin, Jürgen Schmidhuber. ICML 2024. arXiv:2402.16823.
<https://arxiv.org/abs/2402.16823> · code: <https://github.com/metauto-ai/gptswarm> · PDF: `2024-zhuge-language-agents-as-optimizable-graphs.pdf`

**Summary.** GPTSwarm represents agents as computational graphs whose nodes are LLM or tool operations and whose edges are information flow; graphs compose into multi-agent "swarms". Node optimization refines prompts. Edge optimization learns connection probabilities with REINFORCE. In an adversarial MMLU setting, edge optimization learns to cut off agents prompted to give wrong answers.

**Key numbers.**
- Collaborative MMLU swarm with 7 role-differentiated agents: +2.1% ± 1.1% over the single-agent baseline across 5 training seeds [full, §3.1.2].
- Adversarial setting (1T1A, 3T3A … 7T7A truthful/adversarial agents): edge optimization brings the swarm's score back to the single-agent level [full, §3.1.1, Fig. 2].
- The abstract gives no numbers.

**Relation to Decorum.** This is the canonical "evolved graph" baseline, and the natural target for Decorum's "evolved graph with the same optimizer" stretch. Its adversarial setup (wrong-answer agents, majority vote) is a much weaker threat model than Decorum's saboteur and prompt-injected sub-agents.

**Limitation.** Gains are small and measured on MMLU and crosswords. Edges are static after optimization, and the adversaries are scripted and known.

## G-Designer: Architecting Multi-agent Communication Topologies via Graph Neural Networks
Guibin Zhang, Yanwei Yue, Xiangguo Sun, Guancheng Wan, Miao Yu, Junfeng Fang, Kun Wang, Tianlong Chen, Dawei Cheng. ICML 2025 (PMLR 267). arXiv:2410.11782.
<https://arxiv.org/abs/2410.11782> · PDF: `2024-zhang-g-designer.pdf`

**Summary.** G-Designer encodes the agents and a task-specific virtual node with a variational graph auto-encoder, then decodes a sparse communication topology suited to the task. The topology adapts to task difficulty, and the paper reports robustness to agent-level adversarial attacks.

**Key numbers.**
- MMLU 84.50% and HumanEval pass@1 89.90% [abs].
- Up to 95.33% fewer tokens on HumanEval [abs].
- Only a 0.3% accuracy drop under agent adversarial attacks [abs].

**Relation to Decorum.** It is a learned-topology baseline that also claims robustness, so it is a relevant comparator for E2. Decorum should report attack success rate and detection, not only the change in accuracy.

**Limitation.** One topology per query on short-answer benchmarks, which are saturated by 2026 models. Robustness is shown against one simple attack type.

## Multi-agent Architecture Search via Agentic Supernet (MaAS)
Guibin Zhang, Luyang Niu, Junfeng Fang, Kun Wang, Lei Bai, Xiang Wang. ICML 2025 (oral). arXiv:2502.04180.
<https://arxiv.org/abs/2502.04180> · code: <https://github.com/bingreeky/MaAS> · PDF: `2025-zhang-multi-agent-architecture-search-agentic-supernet.pdf`

**Summary.** MaAS optimizes a probabilistic "agentic supernet" (layers of operators such as CoT, debate, ReAct, self-refine and early exit) rather than one fixed system. A controller samples a query-dependent sub-architecture, which lets cost follow query difficulty.

**Key numbers.**
- Needs 6–45% of the inference cost of existing handcrafted or automated MAS and beats them by 0.54–11.82% [abs].
- Cross-dataset transfer: HumanEval→MATH gives 50.27, against 47.15 for AFlow and 47.92 for GPTSwarm [full, Table 8].

**Relation to Decorum.** This is the cost-aware topology baseline. Under Decorum's hard cost cap, MaAS is the method most directly built to trade cost against accuracy.

**Limitation.** Its operators are single-turn reasoning patterns, not long-horizon delegation. The transfer tested is within math and code, not across task kinds.

## Towards a Science of Scaling Agent Systems
Yubin Kim, Ken Gu, Chanwoo Park, Chunjong Park, Samuel Schmidgall, A. Ali Heydari, Yao Yan, Zhihan Zhang, Yuchen Zhuang, Yun Liu, Mark Malhotra, Paul Pu Liang, Hae Won Park, Yuzhe Yang, Xuhai Xu, Yilun Du, Shwetak Patel, Tim Althoff, Daniel McDuff, Xin Liu. arXiv:2512.08296, 2025 (reported under revision at a journal; not verified).
<https://arxiv.org/abs/2512.08296> · code: <https://github.com/ybkim95/agent-scaling> · PDF: `2025-kim-towards-a-science-of-scaling-agent-systems.pdf`

**Summary.** A controlled study of 260 configurations: six agentic benchmarks, five canonical architectures (single agent; independent, centralized, decentralized and hybrid MAS) and three LLM families, with tools, prompts and compute held equal. It fits a predictive model of MAS benefit from coordination and task properties.

**Key numbers.**
- Relative change against a single agent ranges from +80.8% (decomposable financial reasoning, centralized) to −70.0% (sequential planning) [abs].
- The predictive model reaches cross-validated R² = 0.373 and picks the best architecture for 87% of held-out configurations [abs].
- Independent agents amplify trace-level errors 17.2×; centralized coordination with validation holds this to 4.4× [full, §1].

**Relation to Decorum.** It is strong evidence that the single-agent baseline in E1 is essential, since MAS can hurt. The error-amplification result supports making *review/verification* an enforced primitive.

**Limitation.** Architectures are fixed templates, nothing is optimized, and robustness is not studied.

## Superficial Success vs. Internal Breakdown: An Empirical Study of Generalization in Adaptive Multi-Agent Systems
Namyoung So, Seokgyu Jang, Taeuk Kim. arXiv:2604.18951, 2026.
<https://arxiv.org/abs/2604.18951> · PDF: `2026-so-superficial-success-internal-breakdown-adaptive-mas.pdf`

**Summary.** The authors optimize AFlow and AgentDropout on one of six domains (legal, detective, multi-hop, science, math, commonsense) and evaluate them on the others. They name two failures. "Topological overfitting" is the loss of performance out of domain. "Illusory coordination" is reasonable accuracy while the interactions no longer follow the intended roles and connections, measured with role-alignment (R) and connection-significance (O) metrics.

**Key numbers.**
- AgentDropout trained on legal falls from 63.5% in-domain to 55.78% averaged out of domain [full, §3.2].
- Swapping in out-of-domain roles costs −13.00 points, against −1.24 for out-of-domain connections, so roles are more task-specific than connections [full, §4].
- Accuracy and role alignment are nearly uncorrelated in most transfers [full, §4].

**Relation to Decorum.** This directly motivates E3. It suggests that domain-agnostic *rules* may transfer better than roles or graphs, and that E3 should report process measures (whether the rules were actually followed), not only final accuracy.

**Limitation.** It covers two methods on QA and math with a 20B open model, and no agentic or coding tasks.

---

## Considered, not kept (verified ids; one line each)
Ids were checked in Kestrel and abstracts read. Numbers are tagged [abs]. These are the papers most likely to be raised in review.

**Novelty threats or near-misses, besides Meta-Team and MANTA above:**
- **2607.25446** IMACS, "Toward an Organizational Science of MAS: Decoupling Who, How, and Which Algorithm" (2026). Organizational theory (Belbin, Mintzberg, RACI) becomes executable configuration, and a contextual bandit *learns which of six fixed collaboration protocols* to use per task. Accountability placement flips across model families [abs]. **Medium threat**: it learns to *select* a protocol, while Decorum evolves the protocol's content.
- **2609.05774** ReActNet, "Inference-Time Graph Engineering" (2026). A training-free compiler turns each query into temporal graphs whose edges carry natural-language instructions about *what* to send. **Low–medium threat**: it shapes *how* agents talk per query, but there is no cross-task evolution, no enforcement and no adversaries.
- **2606.27492** QueenBee Planner (2026). It distills traces into "design rules" (Preserve/Modify/Avoid) with held-out acceptance gates and insight falsification, then generates communication DAGs. RMSE 12.53 → 7.87 against the best fixed topology on Count-Frequency [abs]. **Low threat**: the rules are about graph design. Its acceptance-gate machinery is worth borrowing for Decorum's optimizer.
- **2507.22606** MetaAgent (ICML 2025). It generates an MAS as a *finite state machine* that controls agent actions and transitions at deployment, then refines it. **Low–medium threat**: the control flow is enforced, but it is generated per task description, and coordination norms are not evolved across tasks.
- **2609.34136** Waggle (2026). It learns "one anonymous local law" shared by interchangeable agents via distillation; the law keeps over 96% of oracle quality [abs]. **Low threat**: the law is a trained policy, not an inspectable rulebook, and the setting is swarms.
- **2605.09128** "Internal vs. External: Deliberation and Evolution for Multi-Agent Constitutional Design" (2026). Evolved constitutions beat deliberated ones in collective-action games (p < 0.01) [abs]. These are social games, not task-solving harnesses; it belongs to theme 02 and is flagged here only.
- **2607.20488** Autonomous Topology Mutation (2026). Runtime team mutation gated by *enforced* invariants (capability monotonicity, state routing, shadow validation). Code-task success rises from 3.3% to 61.7% [abs]. It enforces rules but evolves nothing; relevant to theme 04.

**Same family as the kept baselines (dropped as redundant):**
- 2410.02506 AgentPrune: one-shot pruning of the message graph; $5.6 vs $43.7, +3.5–10.8% under attack [abs].
- 2410.16946 EvoMAC: textual backpropagation updates a coding MAC network; introduces rSDE-Bench.
- 2406.14228 EvoAgent (NAACL 2025): evolutionary operators extend one agent into a MAS.
- 2406.07155 MacNet (ICLR 2025): irregular topologies beat regular ones; collaborative scaling law.
- 2503.03686 MAS-GPT; 2505.14996 MAS-Zero (up to +16.66% on coding [abs]); 2502.04306 ScoreFlow (+8.2% [abs]); 2504.15257 FlowReasoner (+10.52% over o1-mini [abs]); 2509.24323 MAS²; 2601.14652 MAS-Orchestra (ICML 2026). All are query-level MAS generators.
- 2605.09539 **TacoMAS** (verified id). Test-time co-evolution, with a fast loop for capabilities and a slow loop for topology (agent birth/death, edge edits); +13.3% over the strongest of about 20 baselines [abs].
- 2605.11136 EVOCHAMBER. Test-time evolution at the individual, team and population levels; selects collaboration structures online [abs].
- Other conditional/runtime topology methods: 2603.01089 CARD (ICLR 2026), 2506.17784 AnyMAC (EMNLP 2025), 2505.23352 EIB-learner, 2604.00901 HERA, 2604.20714 TPGO, 2608.21918 OptiMAS (EMNLP 2026), 2511.21572 BAMAS (AAAI 2026; up to 86% cost reduction [abs]).
- 2602.03128 "Architectural Design, Not Only Model Intelligence, Governs MAS Performance" (SIGMOD 2027, per arXiv comment). Communication topology drops coordination success from above 90% to below 30% under mismatched structure; orchestration adds more than 60× latency [abs]. Kept Kim et al. instead, as the larger controlled study.
- 2510.06711 "Inefficiencies of Meta Agents for Agent Design". Automated design pays for itself on only two datasets, even after deployment on more than 15,000 examples [abs]. Decorum should report the optimizer's cost amortization.

## Cross-domain transfer of searched systems: what exists
- ADAS: MGSM → MMLU 67.0 ± 3.2 vs 65.9 ± 3.2 (within noise); → DROP 71.9 vs 65.8 [full].
- MaAS: transfer only within math and code (HumanEval → MATH 50.27 vs AFlow 47.15) [full].
- MANTA's head-to-head transfer test: MASS −58.3, AgentSquare −13.3, ADAS −3.3, MANTA's playbook +3.3 (n = 30, median of 3 runs) [full].
- So et al.: AgentDropout legal 63.5 → 55.78 out of domain [full].
- Meta-Team: evaluated on held-out splits of the *same* benchmark; within-benchmark shifts only (LoCoBench Python → C/C++/Java; LOCA-Bench 96K → 8K–256K context) [full, §4.4].

No kept paper tests transfer from coding to research.

## Added by validation

Found by the validation pass (fresh Kestrel searches, 2026-10-01); abstract and method skimmed.

### V1. OPTAGENT: optimizing multi-agent interactions through verbal RL
Zhenyu Bi, Meng Lu, Yang Li, Swastik Roy, Weijie Guan, Morteza Ziyadi, Xuan Wang. *OPTAGENT: Optimizing Multi-Agent LLM Interactions Through Verbal Reinforcement Learning for Enhanced Reasoning.* arXiv:2510.18032, 2025. https://arxiv.org/abs/2510.18032 · PDF: `2025-bi-optagent.pdf`

Builds a multi-agent collaboration graph and refines it with verbal reinforcement learning. The feedback scores the *quality of the interaction* (robustness and coherence of the debate), not only agent outputs; the final answer is a majority vote. Evaluated on math, creative writing, scientific reasoning and numerical sorting against single-agent prompting and multi-agent frameworks (including GPTSwarm).
- Key numbers: none in the abstract ("significantly outperforms" only); not extracted.
- **Relation to Decorum:** one of the few works whose optimisation signal is the quality of communication rather than only task score, but what it optimises is still the debate graph per task, not a reusable, enforced rulebook. A related-work citation for "optimising interactions".
- **Limitation:** reasoning QA/debate setting with majority vote; no tools, no delegation, no enforcement, no adversaries.
