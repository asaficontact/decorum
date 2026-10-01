# Reflective optimization of agent systems from execution traces

These papers improve a text or code artifact around a frozen model: a prompt, a program, a harness, an agent scaffold, a team "constitution". An LLM (or a coding agent) reads the scores, and often the execution traces, of earlier candidates and proposes edits. Evolutionary or Pareto bookkeeping decides which candidates survive. They share three assumptions. The artifact is plain text or code that the optimizer can read. The fitness signal is task success on a held-out search set. Richer feedback (per-example traces, evaluator messages, agent-local context) should beat scalar scores. The best-controlled evidence for that last assumption is Meta-Harness (median 50.0 vs 34.6, scores-only, in one domain). Trace's masked-trace ablation supports it qualitatively, and MoMHa's ablation gap is small and reported without variance (0.611 vs 0.604 overall). A recent line asks *who* failed and *when* (Who&When, Meta-Team's attribution study), which an optimizer needs before it can blame a component. The group has five limitations that Decorum targets:
1. **The rules are prompt-only.** When a method evolves interaction rules at all (Meta-Team's team constitution, Constitutional Evolution), they are prose injected into prompts. No run separates rules the harness enforces from rules it only states.
2. **No matched comparison against topology search.** The multi-agent work either searches topologies and prompts together (MASS), or evolves a team against experience-driven evolution baselines (including AgentNet, whose DAG edges evolve) but without a dedicated communication-topology search such as G-Designer or MaAS (Meta-Team).
3. **No adversaries.** Robustness to a saboteur or prompt-injected agent is not measured; MoMHa's safety axis is about refusing user requests, not adversarial teammates.
4. **Transfer is tested across models, programming languages or context lengths, not task domains.** Wang et al. (2607.12227) show harness evolution often fails to beat matched test-time scaling and barely transfers to held-out tasks (+0.6 pt).
5. **The value of reading traces is rarely isolated.** Only Meta-Harness, Trace and MoMHa ablate traces against scores, each on a single-agent harness; Meta-Team ablates how multi-agent traces are organized but has no scores-only arm.

| Paper | Year | Venue | arXiv | What it is | Role for Decorum |
|---|---|---|---|---|---|
| Evolve as a Team (Meta-Team) | 2026 | preprint | [2605.29790](https://arxiv.org/abs/2605.29790) | MAS evolves agent scaffolds, teammate profiles, and a shared team constitution and roster from distributed post-task reflection | closest work (novelty threat) |
| Evolving Interpretable Constitutions | 2026 | preprint | [2602.00755](https://arxiv.org/abs/2602.00755) | OpenEvolve evolves a prompt-level behavioral constitution for a 6-agent grid-world society | closest work (novelty threat) |
| Meta-Harness | 2026 | preprint | [2603.28052](https://arxiv.org/abs/2603.28052) | Coding-agent proposer searches harness code with filesystem access to all prior code, scores, traces | closest work (optimizer design); evidence for E4 |
| GEPA | 2025 | ICLR 2026 (oral) | [2507.19457](https://arxiv.org/abs/2507.19457) | Reflective prompt evolution with per-instance Pareto selection; reads traces and evaluator feedback | baseline (the optimizer Decorum adapts) |
| Agentic Harness Engineering (AHE) | 2026 | preprint | [2604.25850](https://arxiv.org/abs/2604.25850) | Trace-driven evolution of a coding-agent harness (prompt, tools, middleware, memory), with every edit paired with a prediction | evidence for a design choice (enforced vs prompted) |
| Rethinking the Evaluation of Harness Evolution | 2026 | preprint | [2607.12227](https://arxiv.org/abs/2607.12227) | Harness evolution vs matched test-time-scaling baselines, plus held-out split | threat to validity / required baseline |
| Multi-Agent Design (MASS) | 2025 | ICLR 2026 | [2502.02533](https://arxiv.org/abs/2502.02533) | Staged prompt → topology → prompt optimization of a MAS | baseline (optimized topology + prompts) |
| MAS-PromptBench | 2026 | preprint | [2606.23664](https://arxiv.org/abs/2606.23664) | Controlled study of MAS prompt optimization (MAS-GEPA, MAS-MIPRO) across topology, protocol, team size | evidence for a design choice (structured protocols) |
| Trace / OptoPrime | 2024 | NeurIPS 2024 | [2406.16218](https://arxiv.org/abs/2406.16218) | OPTO formalism: optimizer receives the execution trace (computation graph) plus feedback | background; evidence for E4 |
| Which Agent Causes Task Failures and When? (Who&When) | 2025 | ICML 2025 (spotlight) | [2505.00212](https://arxiv.org/abs/2505.00212) | Failure-attribution benchmark over 127 MAS; which agent, which step | benchmark candidate (blame-assignment probe) |
| MoMHa | 2026 | NeurIPS 2026 | [2609.30967](https://arxiv.org/abs/2609.30967) | Multi-objective (accuracy, safety, tokens) harness search with a Claude Code proposer; scalar-only ablation | evidence for E4 (weak); cost-as-objective |
| Inefficiencies of Meta Agents for Agent Design | 2025 | preprint | [2510.06711](https://arxiv.org/abs/2510.06711) | Shows cumulative context of prior designs is no better than none; evolutionary curation helps; design cost rarely pays off | evidence for a design choice (archive curation, cost accounting) |

Tag key: **[abs]** number taken from the abstract; **[full]** read in the full text (section or table named).

---

## Evolve as a Team: Collaborative Self-Evolution for LLM-based Multi-Agent Systems (Meta-Team)
Zhezheng Hao, Tianfu Wang, Huanshuo Dong, Ziyan Liu, Hong Wang, Xiankun Lin, Qiang Lin, Can Wang, Hande Dong, Jiawei Chen. arXiv:2605.29790, 2026. https://arxiv.org/abs/2605.29790 · code: https://github.com/zz-haooo/Meta-Team

**Summary.** A MAS improves from its own execution experience at three levels. L1 updates each agent's scaffold. L2 refines teammate profiles and collaboration notes, which play the role of the interaction protocol. L3 revises the team roster, the organization, and a shared *team constitution*: "the global prompt that defines common objectives, collaboration principles, and decision rules". Diagnosis is not done by one central analyzer over the flattened trajectory. Each agent keeps its local context and agents exchange evidence after the task. The harness is open-roster: primitives LISTPOOL / STARTAGENT / STOPAGENT / FINALIZE, an append-only message bus, and agents recruited at runtime. That is structurally very close to Decorum's spawn-and-thread harness.

**Key numbers.**
- Average over 9 benchmark columns (SWE-bench Pro, BeyondSWE, LOCA, GAIA, LoCoBench, ResearchRubrics), Claude Sonnet 4.6, avg@3: Meta-Team 62.7, hand-designed MAS 56.1, single agent 56.8, MASFly (strongest MAS-evolution baseline) 56.4, AOrchestra (strongest baseline overall) 57.8, AgentSquare (scalar-reward search) 50.9 [full, Table 1].
- The un-evolved hand-designed MAS underperforms the single agent on 6 of 9 columns [full, §4.2].
- Experience-organization ablation (Ansible / ResearchRubrics): no evolution 40.8/49.5, centralized analyzer over the flattened trace 49.8/52.9, partitioned per-agent 44.5/51.0, collaborative 53.9/55.8 [full, Table 2].
- Removing team-level (L3: constitution and roster) evolution: 51.9/52.1 vs 53.9/55.8 full [full, Table 3].
- About 20 instances per benchmark are used for evolution; evaluation is on a disjoint split [full, §4.1].

**Relation to Decorum.** This is the closest prior work. It already evolves shared "coordination rules" and organization of a manager-style, spawn-at-runtime MAS from traces and threads, and it beats hand-crafted MAS. Decorum has to differentiate on four points. (i) Its rules are typed primitives *enforced* by tools/hooks; Meta-Team's constitution is a prompt. (ii) It compares at matched budget against hand-designed and searched topologies; Meta-Team's baselines share the per-case budget and include AgentNet's evolving DAG, but no communication-topology search. (iii) It tests adversarial agents (E2). (iv) It tests zero-shot cross-*domain* transfer of the rulebook (E3); Meta-Team evolves per benchmark and tests transfer only within a domain (LoCoBench Python → C/C++/Java; LOCA-Bench 96K → 8K–256K context, §4.4).

**Limitation.** The constitution is prompt text, and the infrastructure (tools, verifiers, harness) is explicitly out of scope (their Appendix A). There is no adversarial evaluation. Evolution sets are small (~20 instances) and results are avg@3 with no variance reported in Table 1 (App. E gives paired t-tests: margins on SWE-Pro Qute., BeyondSWE CrossRepo and GAIA are not significant).

## Evolving Interpretable Constitutions for Multi-Agent Coordination
Ujwal Kumar, Alice Saito, Hershraj Niranjani, Rayan Yessou, Phan Xuan Tan. arXiv:2602.00755, 2026. https://arxiv.org/abs/2602.00755

**Summary.** "Constitutional Evolution" uses LLM-driven genetic programming (OpenEvolve with 3 islands, migration, and MAP-Elites) to evolve a priority-ordered rule list that every agent receives in its prompt. The setting is a 6×6 grid world with 6 GPT-OSS-120B agents in two teams; an Overseer eliminates the lowest contributor every 10 turns. Fitness is a Societal Stability Score S combining productivity, survival and conflict. The optimizer reads S and detailed action logs. The evolved constitution beats a human HHH constitution and one written by Claude 4.5 Opus. It discovers that minimal communication beats verbose coordination.

**Key numbers.**
- Evolved C* S = 0.556 ± 0.008 (N = 10) vs HHH 0.249 vs Opus-designed 0.332; adversarial constitutions S = 0 [abs].
- C* reduces social actions to 0.9% (vs 62.2%) [abs].
- Single-island evolution S = 0.385 ± 0.141 (high variance, one run trapped at 0.255) vs multi-island higher and more consistent [full, §Ablation, Table 9].
- Evolution evaluates each constitution on only K = 2 rollouts, for 30 iterations [full, §3.3, Table 1].

**Relation to Decorum.** This is direct prior evidence that evolved *norms* beat hand-written and LLM-written norms in a multi-agent LLM system. It is also an existence proof for Decorum's `norms:` field. Decorum differs in four ways: enforced typed primitives rather than prompt rules; manager-led task solving (coding, research) rather than a survival game; topology baselines; adversarial and transfer tests. (Its "adversarial" arm is a zero-sum constitution given to every agent, not a saboteur among cooperating agents.) The finding that "operational specificity beats abstract principles" supports typed rules.

**Limitation.** It uses a toy environment, prompt-only rules, two rollouts per fitness estimate, and no transfer test (the authors list transfer as future work, §Conclusion).

## Meta-Harness: End-to-End Optimization of Model Harnesses
Yoonho Lee, Roshen Nair, Qizheng Zhang, Kangwook Lee, Omar Khattab, Chelsea Finn. arXiv:2603.28052, 2026. https://arxiv.org/abs/2603.28052

**Summary.** The outer loop is deliberately minimal. A coding-agent proposer (Claude Code with Opus 4.6) gets a filesystem containing the source code, scores and raw execution traces of every prior candidate. It greps and reads them, then writes new single-file harnesses. There is no parent-selection rule; a Pareto frontier is kept and evaluated on test at the end. A typical run evaluates about 60 harnesses over 20 iterations. The paper argues that existing text optimizers (OPRO, TextGrad, GEPA, AlphaEvolve) "compress feedback too aggressively". A qualitative log shows the proposer find a confound: prompt edits bundled with bug fixes caused the regressions. It then pivots to purely additive changes.

**Key numbers.**
- Proposer-information ablation (online text classification): scores-only median 34.6 / best 41.3; scores + LLM summaries 34.9 / 38.7; full traces 50.0 / 56.7. Runs beating zero-shot: 26, 23, 39 [full, Table 3]. The median full-trace candidate beats the best candidate of either ablation.
- At equal proposal budget and the same proposer: GEPA 32.6/40.2, Best-of-N 34.0/44.2, OpenEvolve 39.1/43.3, TTT-Discover 34.1/45.6, Meta-Harness 50.0/56.7 [full, Table 4].
- +7.7 pt over ACE with 4× fewer context tokens (48.6% vs ACE; 11.4K vs 50.8K tokens) [abs; full §4.1].
- +4.7 pt on 200 IMO-level problems averaged over 5 held-out models [abs]; #1 among Haiku 4.5 agents and #2 among Opus 4.6 agents on TerminalBench-2 [full, §4.3; the abstract says only "surpass the best hand-engineered baselines"].
- The proposer reads a median of 82 files per iteration [full, §1 / App. A].

**Relation to Decorum.** This is the cleanest evidence for Decorum's E4 ("scores / +threads / +traces"). Raw traces beat scores, and LLM *summaries* recover none of the gap. Decorum's optimizer should get filesystem access to raw threads and traces rather than digests, and E4 should include a "summaries" arm. The single-agent setup leaves the multi-agent question open.

**Limitation.** It uses one proposer (Claude Code), which the authors flag (§Discussion). The ablation is in one domain, and the paper does not say how many seeds stand behind each median.

## GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning
Lakshya A Agrawal, Shangyin Tan, Dilara Soylu, Noah Ziems, Rishi Khare, Krista Opsahl-Ong, Arnav Singhvi, Herumb Shandilya, Michael J Ryan, Meng Jiang, Christopher Potts, Koushik Sen, Alexandros G. Dimakis, Ion Stoica, Dan Klein, Matei Zaharia, Omar Khattab. ICLR 2026 (oral). arXiv:2507.19457. https://arxiv.org/abs/2507.19457 · code: https://github.com/gepa-ai/gepa

**Summary.** For a compound AI system with several prompts, GEPA samples rollouts and collects execution traces. It also collects *evaluation traces* (e.g., compiler errors) through a feedback function µf that returns text plus score. An LLM reflects on these and rewrites one module's prompt. A candidate is kept only if it improves on the minibatch. Candidates are drawn from a per-instance Pareto front (any candidate best on at least one instance), not the global best. A merge operator combines complementary lineages.

**Key numbers.**
- Beats GRPO by 6% on average and up to 20% with up to 35× fewer rollouts; beats MIPROv2 by >10% (e.g., +12% on AIME-2025) [abs]. GRPO used 24,000 rollouts [full, Table 1].
- Aggregate gain over baseline on GPT-4.1 Mini: GEPA +12.19% and GEPA+Merge +13.33% vs MIPROv2 +5.64% [full, Table 2; Obs. 2]. On Qwen3 8B: GEPA +9.62% vs MIPROv2 +2.61% [full, Table 1].
- Candidate selection with the harness fixed (Qwen3-8B): Pareto +12.44% vs SelectBest (TextGrad-style) +6.05% vs beam +5.11% [full, Obs. 3, Table 3].
- Most of the rollout budget goes to validation; only 79–737 train rollouts reach optimal performance [full, Obs. 1].

**Relation to Decorum.** This is the reflective-mutation and Pareto-selection core Decorum's outer loop adapts: the rulebook YAML is the "prompt", forum threads plus traces are µf's feedback_text, and per-task Pareto selection keeps rulebooks that win on different task types. The comparison with MIPROv2 (score-driven search) favors reflection but is confounded by the different search spaces. It is not a clean trace ablation.

**Limitation.** It optimizes prompts within a fixed program structure and has no feedback-text ablation. Validation cost dominates the budget, which matters under Decorum's hard cost cap.

## Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses
Jiahang Lin, Shichun Liu, Chengjun Pan, Lizhi Lin, Shihan Dou, Zhiheng Xi, Xuanjing Huang, Hang Yan, Zhenhua Han, Tao Gui, Yu-Gang Jiang. arXiv:2604.25850, 2026. https://arxiv.org/abs/2604.25850

**Summary.** AHE evolves a coding-agent harness made of file-level components: system prompt, tools, middleware, skills, sub-agent config, and long-term memory. Trajectories are distilled into a layered drill-down evidence corpus. Every edit carries a self-declared prediction of which tasks it will fix and which it may break, and the next round checks it. The seed is minimal: a single shell tool and no middleware.

**Key numbers.**
- Ten iterations lift Terminal-Bench 2 pass@1 from 69.7% to 77.0%, above Codex-CLI 71.9% [abs].
- Component ablation, each swapped alone into the seed: memory 75.3%, tool 73.0%, middleware 71.9%, system prompt 67.4% (−2.3 pt, the only regression) [full, Table 3].
- The middleware gain comes from a finish-hook that forces one evaluator-style closure check [full, §4.4.1].
- Self-attribution: fix precision 33.7% and recall 51.4% vs random 6.5% and 10.6%; regression precision 11.8% and recall 11.1% vs random 5.6% and 5.4% [full, §4.4.2].

**Relation to Decorum.** This is the strongest single piece of evidence for "enforced beats prompted". An evolved prompt-only rule set hurt on its own, while an enforcement hook (middleware finish-gate) helped. Decorum's enforced-vs-prompted contrast (E2) should mirror this per-component ablation. The regression-blindness result argues for validating every rulebook edit on a held-out minibatch before accepting it.

**Limitation.** Its seed is single-agent (sub-agent configs are an editable component, but no multi-agent coordination is studied), it is evolved on one benchmark, and its step budgets are tuned to one model. The authors note transfer conflates harness portability with operating point (§Limitations).

## Rethinking the Evaluation of Harness Evolution for Agents
Yike Wang, Huaisheng Zhu, Zhengyu Hu, Yige Yuan, Zhengyu Chen, Shakti Senthil, Hannaneh Hajishirzi, Yulia Tsvetkov, Pradeep Dasigi, Teng Xiao. arXiv:2607.12227, 2026. https://arxiv.org/abs/2607.12227

**Summary.** The paper re-evaluates AHE-style harness evolution on Terminal-Bench 2.1 (Claude Opus 4.6, GPT-5.4, GPT-5.4-mini) under a unified compute budget K = 5. Test-time-scaling baselines are parallel sampling and sequential refinement; "harness scaling" is a second harness-evolution variant. It also evaluates on a held-out split (45 train / 10 val / 34 test). Harness evolution does not consistently beat simple test-time scaling, and its gains do not generalize. Its qualitative analysis observes the meta-agent escalating from advisory prompt rules to "runtime enforcement through middleware", such as finalization gates.

**Key numbers.**
- Without unit tests, parallel sampling raises the average from 68.2 to 72.3, while harness evolution fails to beat direct sampling. On GPT-5.4 it drops from 75.3 to 69.7 [full, §4.2, Table 1].
- Held-out tasks: the evolved harness gains +1.2 pt (Opus 4.6) and 0 (GPT-5.4), +0.6 on average [full, Table 3].
- Most edits "memorize fixes rather than distilling strategies" [full, §5.1].

**Relation to Decorum.** This sets the bar Decorum's E1 must clear. Decorum needs a matched-compute test-time-scaling baseline (best-of-N / parallel sampling of the default harness at the same token cap), not only fixed topologies. It also needs a disjoint held-out split, which E1 and E3 already plan. Memorized task-specific fixes are exactly the failure a domain-agnostic, typed rulebook should resist; that is a testable claim.

**Limitation.** It uses one benchmark (Terminal-Bench), which the authors say may be insensitive to harness design (§5.2), and one evolution method (AHE).

## Multi-Agent Design: Optimizing Agents with Better Prompts and Topologies (MASS)
Han Zhou, Xingchen Wan, Ruoxi Sun, Hamid Palangi, Shariq Iqbal, Ivan Vulić, Anna Korhonen, Sercan Ö. Arık. ICLR 2026. arXiv:2502.02533. https://arxiv.org/abs/2502.02533

**Summary.** MASS analyzes the MAS design space and finds prompts matter at least as much as topology. It optimizes in three stages: block-level prompt optimization (MIPRO), topology search in a space pruned by each block's measured incremental influence (rejection sampling of 10 topologies), then workflow-level prompt optimization. The search is score-driven: MIPRO's Bayesian surrogate plus validation scores, with no trace reading.

**Key numbers.**
- Average over 8 tasks (Gemini 1.5 Pro): MASS 78.79 vs multi-agent debate 70.26, ADAS 69.72, self-consistency 68.18, CoT 65.28 [full, Table 1].
- 78.8% on Gemini 1.5 Pro and 74.3% on Gemini 1.5 Flash [full, §5].

**Relation to Decorum.** This is the strongest "optimized topology + prompts" baseline at matched budget. Decorum's "best hand-designed fixed topology" arm should include, or at least cite, a MASS-optimized system. MASS's own prompt stage is a natural "prompts only" control for Decorum.

**Limitation.** Topologies come from a fixed small vocabulary (aggregate, reflect, debate, …) on QA, math and code. There is no runtime-emergent topology, no traces, and no adversaries.

## MAS-PromptBench: When Does Prompt Optimization Improve Multi-Agent LLM Systems?
Juyang Bai, Laixi Shi. arXiv:2606.23664, 2026. https://arxiv.org/abs/2606.23664 · code: https://github.com/juyangbai/MAS-PromptBench

**Summary.** A controlled benchmark varying task, workflow topology (independent, centralized, decentralized, …), communication protocol (free-form, semi-structured, structured JSON slots) and team size. It measures gains from two MAS extensions of single-agent optimizers, MAS-GEPA and MAS-MIPRO.

**Key numbers.**
- MAS-GEPA's average gain grows with protocol structure: +1.6 (free-form), +2.4 (semi-structured), +4.3 (structured) [full, §5.3].
- Gains shrink with team size: +2.4 (n=2), +0.6 (n=4), −0.9 (n=8), −2.1 (n=10) [full, §5.4].
- Prompt optimization on the Independent topology can hurt: −16.0 on MATH [full, §5.2].

**Relation to Decorum.** This is evidence for Decorum's typed-primitive design. When interactions follow a shared, explicit structure, optimization has more to work with. It is also a warning: per-agent prompt optimization degrades as teams grow, which motivates optimizing one shared rulebook instead of N prompts.

**Limitation.** Gains are small (a few points) on QA and code with fixed workflows. The paper does not optimize the protocol itself.

## Trace is the Next AutoDiff: Generative Optimization with Rich Feedback, Execution Traces, and LLMs
Ching-An Cheng, Allen Nie, Adith Swaminathan. NeurIPS 2024. arXiv:2406.16218. https://arxiv.org/abs/2406.16218 · code: https://github.com/microsoft/Trace

**Summary.** The paper formalizes Optimization with Trace Oracle (OPTO). The optimizer receives the execution trace, as a minimal subgraph of the computation, together with output feedback, and updates heterogeneous parameters (prompts, code). OptoPrime is an LLM optimizer over such traces. It is shown on numerical optimization, BigBench-Hard, traffic control, Battleship and Meta-World robot control.

**Key numbers.**
- About 10% higher accuracy than specialized optimizers on BigBench-Hard (DSPy program) [full, §1].
- Meta-World: masking out the execution trace causes "a significant decline in performance and stability" [full, §5.4; the text gives no number, see Fig. 6].
- Even with 7–10× more OPRO iterations to equalize tokens, OPRO plateaus below OptoPrime (e.g., OPRO at iteration 50 vs OptoPrime at iteration 5) [full, App. token-count note].

**Relation to Decorum.** This is the earliest controlled evidence that the trace, not just the score, carries the optimization signal. OPRO, which sees only (solution, score) pairs, is the canonical "scores only" arm for E4.

**Limitation.** It uses small, single-agent workflows. The trace-masking ablation is reported only in a figure, with seeds for some tasks.

## Which Agent Causes Task Failures and When? On Automated Failure Attribution of LLM Multi-Agent Systems (Who&When)
Shaokun Zhang, Ming Yin, Jieyu Zhang, Jiale Liu, Zhiguang Han, Jingyang Zhang, Beibin Li, Chi Wang, Huazheng Wang, Yiran Chen, Qingyun Wu. ICML 2025 (spotlight). arXiv:2505.00212. https://arxiv.org/abs/2505.00212 · data: https://github.com/mingyin1/Agents_Failure_Attribution

**Summary.** Defines automated failure attribution: given a failed MAS log, name the responsible agent and the decisive error step. Releases Who&When, failure logs from 127 MAS with annotations. Compares three LLM judges: all-at-once (whole log), step-by-step, and binary search.

**Key numbers.**
- Best method: 53.5% agent accuracy but only 14.2% step accuracy; some methods fall below random; o1 and R1 are not practically usable [abs].
- All-at-once is best for *which agent*; step-by-step is best for *which step*; all-at-once step accuracy falls below random [full, Tables 1–2 and text].

**Relation to Decorum.** Decorum's optimizer has to blame a *rule*, which is one step removed from blaming an agent or step. Who&When is a ready probe of that ability: run the optimizer's diagnosis prompt on it before trusting E4. The all-at-once vs step-wise split suggests reading whole threads for *who* and walking them for *when*.

**Limitation.** It assumes a single ground-truth root cause. 2603.25001 (MP-Bench) argues this assumption inflates how badly LLMs seem to do. Logs come from AG2/Magentic-One-style systems, not manager-spawn harnesses.

## MoMHa: Multi-Objective Optimization of LLM Harnesses over Accuracy, Safety, and Tokens
Subhojyoti Mukherjee, Md Mehrab Tanjim. NeurIPS 2026. arXiv:2609.30967. https://arxiv.org/abs/2609.30967

**Summary.** Harness search with a Claude Code proposer that reads prior harness source, per-example traces and scores (it also calls its system "Meta-Harness"; it is a different paper from 2603.28052). The search optimizes a scalarized joint reward over accuracy, behavioral safety and tokens, while the proposer sees each axis raw. It evaluates 17 domains and transfer across a 12-model fleet.

**Key numbers.**
- Replacing per-example traces with scalar scores (MoMHa-scalar) drops overall from 0.611 to 0.604 and safety from 0.781 to 0.754 [full, §1 contributions and App. K summary].
- Joint reward beats two-phase "accuracy then tokens" by +2.7 overall at 95 fewer tokens per example [full, §1].
- Real-world track: 0.461 vs 0.377 for DSPy, winning 5 of 7 columns [abs].

**Relation to Decorum.** Its trace-vs-scalar ablation points the same way as Meta-Harness, but the overall gap (0.007) cannot be called real: the ablation table (App. K) reports no variance, and capability is identical (0.539 vs 0.539), so the whole gap is on safety (0.781 vs 0.754). Its contribution is mainly to the safety axis. It is a template for keeping cost as a visible objective while Decorum treats cost as a hard cap.

**Limitation.** The headline trace effect is small, and the safety objective concerns user requests, not adversarial agents.

## Inefficiencies of Meta Agents for Agent Design
Batu El, Mert Yuksekgonul, James Zou. arXiv:2510.06711, 2025. https://arxiv.org/abs/2510.06711

**Summary.** The paper studies ADAS-style meta-agents that design agents iteratively. It compares context curation: cumulative (all prior designs), parallel (initial library only), and evolutionary (a selected subset). It also measures design diversity and the break-even point at which design cost pays for itself.

**Key numbers.**
- Cumulative context does no better than ignoring prior designs; evolutionary curation gains up to +10% over cumulative on MGSM [full, Table 1 and text].
- Design pays off only on 2 datasets (DROP, MMLU), and only after about 15,000 deployed examples [abs; full, Fig. 4 and text].

**Relation to Decorum.** It cautions against dumping every past rulebook and thread into the optimizer's context. It supports archive selection (GEPA Pareto / evolutionary) or filesystem access (Meta-Harness). Decorum's proposal should report evolution cost against the deployment horizon, not only the per-task token cap.

**Limitation.** It covers single-agent designs on small QA and math benchmarks with one meta-agent family.

---

## Novelty check (theme 03)
Prior work that evolves the coordination *rules or norms* of an LLM MAS (not just graph or prompts):
- **2605.29790 Meta-Team: very close.** It evolves a shared team constitution (coordination rules), roster and organization, plus teammate profiles (protocol), from traces of an open-roster spawn harness, and beats hand-crafted MAS. Its rules are prompts, it has no adversarial tests and no communication-topology-search arm (AgentNet's evolving DAG is the nearest baseline), and it evolves per benchmark, testing transfer only across programming languages and context lengths.
- **2602.00755 Constitutional Evolution: close in object, far in setting.** Evolved prompt-level norms beat human and Opus-written norms (S 0.556 vs 0.249 / 0.332). The setting is a grid-world toy with no enforcement and no transfer.
- **2605.10052 Swarm Skills: medium.** A portable spec for multi-agent coordination (roles, workflows, execution bounds) with self-evolution from trajectories. Its evaluation is qualitative only, with no numbers.
- **2607.25446 IMACS: medium.** It separates organization, coordination and protocol as configurable layers and *learns protocol choice* per task with a contextual bandit. It selects among 6 fixed protocols and does not edit rules.
- **2502.00757 AgentBreeder: relevant to E2 and stretch.** Evolutionary search over multi-agent scaffolds with a safety objective: "blue" mode gives +79.4% average safety uplift; "red" mode yields adversarially weak scaffolds as capability rises [abs].
- **Enforcement as an emergent result:** both AHE (2604.25850, the middleware finish-hook) and Rethinking (2607.12227, the meta-agent "escalates to runtime enforcement through middleware") observe that optimizers drift toward enforcement once prompt rules plateau. Neither turns this into a designed, typed, enforced rule space.

None of these evolves a typed, *harness-enforced* rulebook, compares it against topology search at matched budget, or tests it under saboteur or injection attacks. That gap remains Decorum's.

## Trace vs scalar feedback: evidence for E4
| Paper | Comparison | Result | Source |
|---|---|---|---|
| Meta-Harness 2603.28052 | scores-only vs scores+summary vs full traces (same proposer) | median 34.6 / 34.9 / 50.0; best 41.3 / 38.7 / 56.7 | [full] Table 3 |
| Trace 2406.16218 | OptoPrime with vs without execution trace (Meta-World); OPRO token-matched | "significant decline" when masked (figure only); OPRO plateaus lower | [full] §5.4, App. |
| MoMHa 2609.30967 | per-example traces vs scalar | overall 0.611 vs 0.604 (no variance reported; capability identical); safety 0.781 vs 0.754 | [full] §1 / App. K |
| Meta-Team 2605.29790 | centralized flattened trace vs per-agent vs collaborative (how traces are organized) | 49.8 / 44.5 / 53.9 (Ansible); scalar-reward AgentSquare 50.9 avg vs Meta-Team 62.7 (confounded) | [full] Tables 1–2 |
| GEPA 2507.19457 | reflective (traces+feedback) vs MIPROv2 (score-driven) | GPT-4.1 Mini: +12.19% (GEPA) / +13.33% (GEPA+Merge) vs +5.64% aggregate (confounded by different search spaces) | [full] Table 2, Obs. 2 |
| OptiMAS 2608.21918, AEvo 2605.13821, Evo-Bench 2608.09096, MAS-PromptBench 2606.23664 | — | no trace-vs-scalar ablation found (text searched) | [full] grep |

## Considered, not kept (ids verified)
- TextGrad 2406.07496 (Nature 639:609–616, 2025): the textual-gradient method Decorum's description names. GEPA, Trace and Meta-Harness cover it, and it lost to Pareto selection in GEPA's Table 3. bib entry kept under background.
- OPRO 2309.03409, DSPy 2310.03714, MIPROv2 2406.11695, Promptbreeder 2309.16797: background for score-driven and self-referential prompt search. OPRO is the canonical "scores only" optimizer.
- ACE 2510.04618: evolving context playbooks with incremental delta updates against "context collapse". Relevant to how rulebook edits are applied, but a single-agent context.
- Darwin Gödel Machine 2505.22954 and AlphaEvolve 2506.13131: evolutionary code self-improvement. Relevant to the stretch goal "optimizer writes new enforcement primitives", not the core loop.
- TRAIL 2505.08638: trace-debugging benchmark (best model 11% [abs]). Mostly single-agent; Who&When fits better.
- OptiMAS 2608.21918 (EMNLP 2026): agentic MAS optimizer with trajectories as loss. Its ablations are about memory, not feedback type. Meta-Team is closer.
- Also seen: CANTANTE 2605.13295 (contrastive per-agent credit, beats GEPA/MIPROv2 on MBPP by +18.9 [abs]); HarnessEvo 2609.02889 (value concentrates in the "reflection/control" slot; uniform budget splitting starves slots [abs]); AutoSaddler 2608.23041; MASPO 2605.06623; DoCtOR 2608.28264; Who&When Pro 2607.09996; MP-Bench 2603.25001; Optimas 2507.03041.

## Added by validation

Found by the validation pass (`similar_papers` on 2605.29790, 2026-10-01); abstract read.

### V1. EvolveNet: collaborative harness evolution
Jun Nie, Yonggang Zhang, Qianshu Cai, Yiu-ming Cheung, Xinmei Tian, Bo Han. *EvolveNet: Collaborative Harness Evolution for Agent Self-Improvement.* arXiv:2608.04968, 2026. https://arxiv.org/abs/2608.04968 · PDF: `2026-nie-evolvenet.pdf`

A shared harness is broadcast to separate deployments. Each evolves it on its own workload, and only the resulting program adaptations are merged back, using scope-typed, evidence-guided program aggregation, since program edits cannot be averaged and may conflict.
- Key numbers [abs]: five settings (text-to-SQL, data-science coding, competitive programming, software engineering, agentic workflows). The shared harness improves in all five, with the largest gains under heterogeneous workloads. Ablations attribute the gain to composing adaptations rather than selecting among them.
- **Relation to Decorum:** harness evolution with typed, scoped edits that must be composed is relevant to how a rulebook optimiser should merge edits coming from several training domains or runs. It evolves a single agent's harness program, not inter-agent rules.
- **Limitation:** single-agent harness; no coordination rules, adversaries or enforcement-vs-prompt comparison.
