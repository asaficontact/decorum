# Benchmark candidates and agent harnesses

This theme compares (a) benchmarks Decorum could run on and (b) harnesses it could be built on. Coding is where the rulebook is evolved and tested; multi-hop research is the transfer test. All the coding candidates descend from SWE-bench: a real repository, an issue, and a patch graded by hidden tests. They differ in how they deal with contamination:
- fresh issues (SWE-bench-Live, SWE-rebench);
- copyleft and private repositories (SWE-bench Pro);
- tasks written from scratch and never merged (DeepSWE).

The research candidates descend from BrowseComp: short, verifiable answers that take many search steps to find. They differ in whether the corpus is the live web (BrowseComp, LoHoSearch) or a fixed set of documents (BrowseComp-Plus).

**Shared limitation.** Every benchmark here scores a whole system end to end with one model. None controls for the token budget, and none checks whether the declared organisation of agents actually ran. Two findings make this a real problem for Decorum's claim:
- When thinking tokens are equal, a single agent matches or beats five multi-agent architectures on closed-book multi-hop QA (Tran & Kiela 2026).
- A two-agent workflow that beats a single agent by 14 points on DeepSWE spends 2.2 times the tokens (OpenCollab 2026).

Decorum's E1 and E3 therefore need two things these benchmarks do not provide: a per-instance token cap enforced by the harness, and a check that the runtime did what the rulebook said.

## Papers kept

| Paper | Year | Venue | arXiv | What it is | Role for Decorum |
|---|---|---|---|---|---|
| OpenCollab (Hsu et al.) | 2026 | preprint | [2609.38345](https://arxiv.org/abs/2609.38345) | Multi-agent coding runtime that refuses tool calls and messages outside the declared roles/topology, and caps tokens per role before each call; measures "Adherence" | **closest work** (enforcement) |
| Single-agent vs MAS at equal thinking budget (Tran & Kiela) | 2026 | preprint | [2604.02460](https://arxiv.org/abs/2604.02460) | Single agent ≥ 5 MAS designs on FRAMES/MuSiQue when thinking tokens are matched | **threat to the claim**; evidence for equal-budget design |
| SWE-bench Pro (Deng et al.) | 2025 | preprint (Scale AI) | [2509.16941](https://arxiv.org/abs/2509.16941) | 1,865 long-horizon tasks in public, held-out and commercial sets; copyleft repositories | benchmark candidate (coding) |
| SWE-rebench (Badertdinov et al.) | 2025 | NeurIPS 2025 D&B | [2505.20411](https://arxiv.org/abs/2505.20411) | Automated pipeline: 21,336 tasks from 3,468 repositories, plus a monthly decontaminated leaderboard | benchmark candidate (coding) — **recommended** |
| DeepSWE (Huang et al.) | 2026 | preprint | [2607.07946](https://arxiv.org/abs/2607.07946) | 113 tasks written from scratch, 91 repositories, 5 languages, hand-written verifiers | benchmark candidate (coding, held-out stress test) |
| SWE-bench-Live (Zhang et al.) | 2025 | preprint | [2505.23419](https://arxiv.org/abs/2505.23419) | 1,319 post-2024 issues, 93 repositories, automated Docker curation | benchmark candidate (coding) |
| Terminal-Bench 2.0 (Merrill et al.) | 2026 | preprint | [2601.11868](https://arxiv.org/abs/2601.11868) | 89 hard terminal tasks with human-written tests; Harbor harness | benchmark candidate (coding-adjacent) |
| SWE-bench (Jimenez et al.) | 2023 | ICLR 2024 | [2310.06770](https://arxiv.org/abs/2310.06770) | 2,294 issues from 12 Python repositories; the parent of Verified and Lite | background |
| BrowseComp-Plus (Chen et al.) | 2025 | preprint | [2508.06600](https://arxiv.org/abs/2508.06600) | 830 BrowseComp questions over a fixed 100,195-document corpus | benchmark candidate (research) — **recommended** |
| BrowseComp (Wei et al.) | 2025 | preprint (OpenAI) | [2504.12516](https://arxiv.org/abs/2504.12516) | 1,266 hard-to-find, short-answer questions on the live web | benchmark candidate (research) / background |
| LoHoSearch (Zhao et al.) | 2026 | preprint | [2606.12837](https://arxiv.org/abs/2606.12837) | 544 questions generated from a knowledge graph, with unique answers; best model 34.74% | benchmark candidate (research, harder) |
| FRAMES (Krishna et al.) | 2024 | NAACL 2025 | [2409.12941](https://arxiv.org/abs/2409.12941) | 824 multi-hop Wikipedia questions (2–15 articles each); autorater checked against humans | benchmark candidate (research, cheap) |

## Selection criteria: comparison

Columns follow the team's criteria:
1. Best known single-agent result. A single agent should not solve the benchmark reliably.
2. Does the task decompose into subtasks?
3. Scoring: automatic, with no unvalidated LLM judge.
4. Size and cost per instance, plus the smallest usable subset.
5. Contamination risk.
6. Can tasks be split by repository?

Tags: [abs] = from the abstract; [full] = read in the full text; [web] = leaderboard or blog, accessed 2026-10-01.

### (A) Coding

| Benchmark | (1) Best single-agent | (2) Decomposes? | (3) Scoring | (4) Size · cost per instance · smallest usable subset | (5) Contamination | (6) Repo-level split |
|---|---|---|---|---|---|---|
| **SWE-bench Verified** (500) | 76.8% for Claude 4.5 Opus under bash-only mini-swe-agent, at $0.75/instance [web: swebench.com JSON, 2026-02-17]. Leaderboard top 79.2% [web]. | Weakly: 161/500 tasks need 1–2 line edits [full: Pro §1] | Tests. But OpenAI's audit found 59.4% of 138 hard tasks had flawed tests [web: OpenAI, Feb 2026, via Decrypt] | 500 · $0.07–0.75 bash-only [web] · any | **High**: frontier models reproduce gold patches verbatim [web: OpenAI]; buggy file named from the issue alone in 76% vs 53% on other repos [abs: 2506.12286] | Poor: 12 repos, dominated by django/sympy |
| **SWE-bench Lite** (300) | 60.33% (ExpeRepair + Claude 4 Sonnet, 2025-06); no 2026 entries, no bash-only entries [web] | Weakly (1-file tasks by construction) | Tests | 300 · cheap · any | High (same repos) | Poor |
| **SWE-bench Pro, public** (731) | 43.6% (Sonnet 4.5, SWE-agent) [full: Tab. 1]; 61.5% leaderboard top [web: Scale]; 61.7% mini-swe-agent vs 64.3% OpenCollab Duo, GPT-5.6-Luna, 193-task subset [full: 2609.38345 Tab. 2] | Yes: 107.4 LOC across 4.1 files on average [full] | Tests reviewed by humans. A later audit adds anti-leakage fixes (Pro Verified, [abs: 2609.08149]) | 731 · $0.41–2.54/task depending on harness [full: OpenCollab Tab. 2]; paper analysis capped at $2 and 50 turns [full] · 36–193 tasks used in the literature | **Moderate**: GPL repos only, but public since 2025-09; gold-solution leakage channels reported [abs: 2609.08149] | Yes, but only 11 public repos (50–100 tasks each) [full] |
| **SWE-rebench** (21,336-task pool; 860-task public leaderboard set) | 64.5% best model (Fable 5); Claude Code 60.4%; Codex 58.0% on the 2026-05/07 window, 111 tasks / 65 repos [web: swe-rebench.com] | Yes (real issues; difficulty labels per task) | Tests; 5 runs per model, SEM reported [full] | Monthly splits of 30–110 tasks; Jan–Mar 2026 = 215 tasks / 146 repos [web: HF API] · $0.81–4.40 and 0.6–5.5M tokens per problem for frontier configurations [web] · ~100 tasks | **Low** for tasks newer than the model's release date; the leaderboard flags violations [full] | **Excellent**: 3,468 repos in the pool; 146 repos in 215 recent tasks |
| **DeepSWE** (113) | 70.0% gpt-5.5 xhigh; 54.2% Opus 4.7; 31.6% Sonnet 4.6; 0.2% Haiku 4.5 (mini-swe-agent) [full: Fig. 1] | Strongly: reference solutions touch 5.5× more code than Pro's [abs] | Hand-written functional verifiers. An LLM re-review disagrees 1.4% of the time vs 32.4% on Pro [abs] | 113 · $1.19–7.66/task depending on harness [full: OpenCollab Tab. 2] · whole set is small | **Lowest**: never merged upstream [abs] | Natural: 91 repos, 75 of which contribute one task [full] |
| **SWE-bench-Live** (1,319; Lite 300) | 19.25% (OpenHands + Claude 3.7) in 2025 [full]; no current number verified | Yes | Tests | 1,319 or Lite 300 (50 tasks/month) [full] | Low–moderate; a 2025 cut is now old | Yes: 93 repos; 744 tasks from SWE-bench repos vs 383 from others [full] |
| **Terminal-Bench 2.0** (89) | 63% (Codex CLI + GPT-5.2) [full]; 83.15% OpenCollab Duo on TB 2.1 [full: 2609.38345] | Partly (heterogeneous tasks: build, data, security) | Tests per task | 89 · $0.19–2.73/task [full: OpenCollab]; most attempts under 20 min [full] · all 89 | Low–moderate | **No**: each task is its own environment, so only task-level splits |

### (B) Multi-hop research (transfer test)

| Benchmark | (1) Best single-agent | (2) Decomposes? | (3) Scoring | (4) Size · cost per instance · smallest usable subset | (5) Contamination | Reproducible corpus? |
|---|---|---|---|---|---|---|
| **BrowseComp-Plus** (830) | 70.12% GPT-5 + Qwen3-Embed-8B; 55.9% GPT-5 + BM25; 14.3–15.5% Sonnet 4 / Opus 4 + BM25 [full: Tab. 1]. 87.59% GPT-5 + Reason-ModernColBERT [web: LightOn blog, 2026-03] | Yes: 6.1 evidence documents per query [full]; parallel sub-searches are natural | LLM judge (gpt-4.1 in the paper; Qwen3-32B in the repo) comparing a short answer to gold. **No judge validation reported in the parts read** | 830 · about $1.2/query for o3 (derived from the repo's whole-set estimate); 21–26 search calls/query for o3/GPT-5 [full] · 100–150 queries | Moderate: questions public since 2025-04 | **Yes**: fixed 100,195 docs, BM25 and dense indexes shipped |
| **BrowseComp** (1,266) | Deep Research 51.5% in 2025 [full]; "strongest models surpassing 90%" by 2026 [abs: LoHoSearch] | Yes | LLM grader (HLE prompt). Human answers agree with the reference 86.4% of the time [full] | 1,266 · live search API cost · — | Moderate–high (saturating) | No (live web) |
| **LoHoSearch** (544) | 34.74% GPT-5.5; DeepSeek-V4-Flash 10.02% here vs 58.84% on BrowseComp [full] | Strongly (tree-structured subgraphs) | Answers are unique in the knowledge graph [abs], but scored by the average of 2 LLM judges [full] | 544 · unknown; live Google search · — | Low (2026); a static snapshot [full] | **No** (live search). Questions come from a Wikipedia graph, so an offline Wikipedia index such as SimpleWikiSearch (2607.26070) *might* serve. Untested |
| **FRAMES** (824) | 0.66 with multi-step retrieval; 0.729 oracle (Gemini-Pro-1.5) [full]; about 0.70 closed-book Gemini-2.5-Pro [full: 2604.02460 Tab. 1] | Yes: 2–15 articles per question [full] | LLM autorater **validated**: 0.96 accuracy, κ=0.889 vs humans [full] | 824 · cheap (Wikipedia) · 100–200 | **High** (Wikipedia; public since 2024) | Yes (Wikipedia pages listed per question) |
| MuSiQue (25K questions, 2–4 hop [abs]) | Closed-book 4-hop 0.41–0.47 Gemini-2.5-Pro [full: 2604.02460] | Yes (sub-questions given) | **Exact match / F1** | cheap · 100–200 | **High** (2021) | Yes (20 paragraphs per question) |

## Per-paper notes

### OpenCollab (closest work on enforcement)
Hsu, C.-W., Gong, K., Wu, Y., et al. (2026). *OpenCollab: A Multi-Agent Coding Framework with Programmable Collaboration and Controllable Runtime.* arXiv:2609.38345. https://arxiv.org/abs/2609.38345

**Summary.** OpenCollab is a two-layer runtime. Every role is a session running the same state machine, and controllers on top implement single-agent, model-directed "team", and scripted "workflow" organisations. The team controller takes a declarative configuration: role prompts, tools per role, and a directed graph of who may message whom. The runtime gates tool calls and inter-agent messages at invocation time: a request outside the declared permissions or topology is refused and logged. Before each model call, a pre-call admission check enforces a per-role token ceiling. An append-only event stream records every action by role. From it the paper computes **Adherence**, whether the declared organisation actually ran, and uses it to rescale gains (CACE = ITT / Adherence).

**Key numbers.**
- Changing one configuration dimension moves Adherence from 47.2% to 97.2% [abs].
- With an unconstrained "open card", lead agents bypass teammates or spend their budget first: 47.2% Adherence [full].
- Read-only tools for the lead give 94.4% Adherence but a 52.8% pass rate, against 69.4% for a single agent [full: Tab. 3–4].
- Duo vs Base on DeepSWE: 69.91% vs 55.75% at 26.11M vs 11.95M tokens per task. On Terminal-Bench 2.1: 83.15% vs 79.78% [full: Tab. 2].
- Rerunning the single agent unchanged flips 5 of 36 tasks [full].
- Their audit of 10 frameworks, including Claude Code, OpenHands and SWE-agent, finds none that both holds budgets constant and verifies the realised organisation [full: Tab. 1].

**Relation to Decorum.** This is the nearest prior work to "enforce coordination rules in the harness". It enforces role permissions, message topology and budgets with runtime gates rather than prompts, and it shows that a declared organisation is often not realised unless delegation is forced (see the validation note below). That is direct evidence for Decorum's enforced-vs-prompted design. What separates Decorum:
- OpenCollab's organisations are hand-declared static topologies plus one scripted workflow. Nothing is evolved.
- Its declarative rules cover permissions, edges and budgets. It has no general task-lifecycle primitives (close-with-evidence, dissent, escalation) for model-directed teams; the one scripted workflow (Duo) hard-codes a selection step in which a read-only Adjudicator compares the two candidates' evidence, so "no review step at all" would be wrong.
- It has no adversarial agents and no cross-domain transfer.

Decorum should adopt Adherence (or something like it) as a manipulation check, and should not claim novelty for "enforced topology plus budget gates".

*Validation note (2026-10-01).* Three caveats from the full text. (1) The 47.2% reference team is not prompt-only: its tools, budget and message edges were runtime-gated; Adherence is low because nothing forced the lead to delegate (open prompt card, all tools). (2) Raising Adherence did not raise success: the open-card team had the highest Pass@1 (75.0%), and the read-only lead (94.4% Adherence) fell to 52.8% vs 69.4% for a single agent, all on 36 SWE-bench Pro tasks [full: Tab. 3–4]. (3) Duo is two independent coders plus a code-applied selection rule (best-of-two with an adjudicator) [full: App. B], so its +14.2 on DeepSWE is evidence for spending more compute on candidates, not for rules of interaction. The proposal must not cite OpenCollab as showing that enforced collaboration improves success.

**Limitation.** Only one agent runs at a time (a shared lock), only three models were tested, and only one workflow. Duo is not budget-matched to Base.

### Tran & Kiela — single agent beats MAS at equal thinking budget (threat to the claim)
Tran, D., & Kiela, D. (2026). *Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets.* arXiv:2604.02460. https://arxiv.org/abs/2604.02460

**Summary.** The paper argues from the Data Processing Inequality that inter-agent messages are a function of the full context, so a multi-agent system cannot beat a single agent that uses that context perfectly. Multi-agent systems can win only when the single agent's effective use of its context degrades. The single agent (SAS) is compared with Sequential, Subtask-parallel, Parallel-roles, Debate and Ensemble at matched thinking budgets of 100–10,000 tokens. The tasks are FRAMES and 4-hop MuSiQue, closed-book (no retrieval tool), on Qwen3-30B, DeepSeek-R1-70B, Gemini-2.5-Flash and Gemini-2.5-Pro.

**Key numbers.**
- At every budget except the lowest (100 tokens), i.e. 500 tokens and above, SAS is best or within the confidence interval of the best [full: §5.1].
- Average accuracy at 5,000 tokens: SAS 0.427 vs Sequential 0.386 [full: Tab. 1].
- MAS wins only under heavy context corruption (masking or substitution at α=0.7) [full].
- Gemini API budget accounting is unreliable [full].

**Relation to Decorum.** Decorum's claim is "at equal model and token budget", so this is the main counter-evidence, and its scope boundary is the way out. It is text-only and closed-book, and the authors list "MAS advantages with tools" as out of scope [full: App. C]. Decorum's research transfer task should therefore be **agentic and long-context** (BrowseComp-Plus, LoHoSearch), where single-agent context degradation is real, and **not** closed-book FRAMES or MuSiQue, where this paper predicts Decorum loses.

**Limitation.** No tools and no environment. Scoring uses an LLM judge on open answers. Only the upper budget is capped.

### SWE-bench Pro
Deng, X., Da, J., Pan, E., et al. (2025). *SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?* arXiv:2509.16941. https://arxiv.org/abs/2509.16941

**Summary.** SWE-bench Pro has 1,865 human-verified tasks from 41 repositories in three sets:
- public: 731 tasks, 11 GPL repositories;
- held-out: 858 tasks, 12 repositories, private;
- commercial: 276 tasks, 18 startup repositories, private.

Each repository contributes 50–100 tasks, and trivial edits are excluded. Every issue is augmented with written requirements and an interface specification so that the unit tests do not reject valid solutions that use different names. Languages are Python, Go, JavaScript and TypeScript.

**Key numbers.**
- Best result is below 45% Pass@1 under a unified scaffold [full: abstract of PDF v2; absent from the arXiv/Kestrel metadata abstract].
- Sonnet 4.5 43.6%, GPT-5 (high) 41.8% on the public set [full: Tab. 1].
- Best commercial-set result is 17.8% [full: Tab. 2].
- Reference solutions average 107.4 LOC across 4.1 files [full].
- Removing the requirements and interface drops GPT-5 from 25.9% to 8.4% [full: Tab. 3].
- Scale leaderboard top: 61.5% on the public set [web].

**Relation to Decorum.** These are multi-file, long-horizon tasks, which suit decomposition. The repository grouping allows a repo-disjoint evolve/test split, though with only 11 public repositories. OpenAI recommends Pro as the successor to Verified [web]. The authors list multi-agent coordination as future work [full §7.2].

**Limitation.** It covers few languages and relies on tests. A later audit (SWE-Bench Pro Verified, 2609.08149 [abs]) reports leakage channels for gold solutions and flawed tasks.

### SWE-rebench
Badertdinov, I., Golubev, A., Nekrashevich, M., et al. (2025). *SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation of Software Engineering Agents.* NeurIPS 2025 Datasets & Benchmarks. arXiv:2505.20411. https://arxiv.org/abs/2505.20411

**Summary.** An automated pipeline mines GitHub issue/PR pairs, installs dependencies with an LLM, validates them by execution, and labels each task's difficulty and clarity with a fine-tuned LLM. The result is a 21,336-task Python dataset from 3,468 repositories. A monthly leaderboard runs every model in one fixed ReAct scaffold with 128K context, five runs each, and reports SEM and pass@5. Results on issues created before a model's release are flagged as possibly contaminated.

**Key numbers.**
- Leaderboard benchmark at publication: 294 tasks / 169 repositories [full].
- DeepSeek-V3-0324: 39.7% on Verified vs 21.3% on fresh SWE-rebench, the paper's contamination signal [full: Tab. 2].
- Current window (2026-05-15 to 07-01): 111 tasks / 65 repositories; best 64.5%; Claude Code 60.4%; $0.81–4.40 per problem [web].
- Public monthly splits through 2026-03 total 860 tasks; Jan–Mar 2026 has 215 tasks from 146 repositories [web: HF datasets API].

**Relation to Decorum.** This is the best fit for criteria 5 and 6. Draw the evolve set from the large pool and the held-out test set from post-cutoff monthly splits whose repositories do not appear in the evolve set. The standing single-agent and Claude Code/Codex reference numbers give E1 its baselines.

**Limitation.** Python only. Automated curation leaves some tasks under-specified or unsolvable [full §4], so absolute rates are lower and noisier than on human-verified sets.

### DeepSWE
Huang, W., Lee, C., Tng, L., & Ge, S. (2026). *DeepSWE: Measuring Frontier Coding Agents on Original, Long-Horizon Engineering Tasks.* arXiv:2607.07946. https://arxiv.org/abs/2607.07946

**Summary.** DeepSWE has 113 tasks written from scratch in 91 active repositories across five languages (TypeScript, Go, Python, JavaScript, Rust). The tasks are never contributed upstream, and hand-written functional verifiers accept any correct implementation. Every model runs in the fixed mini-swe-agent harness, about four rollouts per task.

**Key numbers.**
- An LLM re-review disagrees with the verifiers 1.4% of the time, vs 32.4% with Pro's inherited tests [abs].
- Reference solutions are 5.5× larger than Pro's, from prompts half as long [abs].
- gpt-5.5 xhigh 70.0%, Opus 4.7 54.2%, Sonnet 4.6 31.6%, Haiku 4.5 0.2% [full: Fig. 1].
- Spread across models is 69.8 points vs 29.7 on Pro [full].

**Relation to Decorum.** It is the strongest held-out test for contamination, because the tasks never entered the public record. It also has the most decomposable tasks, and 75 of its 91 repositories have exactly one task, so any evolve set from another benchmark is repository-disjoint almost automatically. It is too small to also serve as an evolve set.

**Limitation.** Pass/fail only, no partial credit. Small n. Expensive and long tasks.

### SWE-bench-Live
Zhang, L., He, S., Zhang, C., et al. (2025). *SWE-bench Goes Live!* arXiv:2505.23419. https://arxiv.org/abs/2505.23419

**Summary.** An automated curation pipeline (RepoLaunch) builds Docker images for 1,319 issues created since 2024 across 93 repositories. A 300-task Lite subset samples 50 tasks per month.

**Key numbers.**
- Best 19.25% (OpenHands + Claude 3.7) vs 43.20% for the same setup on Verified [full].
- 22.96% on SWE-bench repositories vs 18.89% on new ones [full: Tab. 5].

**Relation to Decorum.** An alternative held-out source with a natural repository-origin split. Its numbers are 2025-era; SWE-rebench now covers the same niche with fresher public splits.

**Limitation.** Python only. The leaderboard numbers in the paper are stale for 2026 models.

### Terminal-Bench 2.0
Merrill, M. A., Shaw, A. G., Carlini, N., et al. (2026). *Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces.* arXiv:2601.11868. https://arxiv.org/abs/2601.11868

**Summary.** 89 curated tasks, each in its own container environment, with a human-written solution and tests. About three reviewer-hours went into each task. Runs use the Harbor harness, which supports Claude Code, Codex CLI, OpenHands, mini-swe-agent and the neutral Terminus 2. The paper reports 32,155 trials.

**Key numbers.**
- Under 65% for frontier agents [abs]; Codex CLI + GPT-5.2 63% [full].
- Turn count and token count do not correlate with success [full].

**Relation to Decorum.** Harbor is a ready way to run Pi or Claude-SDK harnesses against many benchmarks. But the tasks are heterogeneous and do not support a repository-level split, and by 2026 OpenCollab reports 83.15% on TB 2.1 (a lower bound on how close it is to saturation).

**Limitation.** Small. Task-level splits only.

### SWE-bench (and Verified, Lite)
Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2024). *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* ICLR 2024. arXiv:2310.06770. https://arxiv.org/abs/2310.06770

**Summary.** The original benchmark: 2,294 issue/PR pairs from 12 Python repositories, graded by fail-to-pass and pass-to-pass tests. Two later subsets:
- Lite: 300 tasks [web: swebench.com].
- Verified: 500 tasks screened by 93 developers from 1,699 annotated samples [web: OpenAI blog, Aug 2024, via search].

**Key numbers.**
- Claude 2 solved 1.96% at release [abs].
- Verified: 76.8% for Claude 4.5 Opus under bash-only mini-swe-agent [web, 2026-02].
- In Feb 2026 OpenAI stopped reporting Verified: 59.4% of 138 audited hard tasks had flawed tests, and frontier models reproduced gold patches [web].

**Relation to Decorum.** Background only. Verified is saturated and contaminated, and what headroom remains is mostly test noise.

**Limitation.** Contamination, and Django-heavy coverage.

### BrowseComp-Plus
Chen, Z., Ma, X., Zhuang, S., et al. (2025). *BrowseComp-Plus: A More Fair and Transparent Evaluation Benchmark of Deep-Research Agent.* arXiv:2508.06600. https://arxiv.org/abs/2508.06600

**Summary.** BrowseComp questions are re-grounded in a fixed corpus. o3 gathered candidate evidence, then humans verified each clue against document spans; 830 of 1,005 questions passed. Hard negatives were mined from the web. The corpus has 100,195 documents, with 6.1 evidence, 2.9 gold and 76.3 negative documents per query on average. BM25 and Qwen3-Embedding indexes are released, so the retriever can be held fixed.

**Key numbers.**
- GPT-5: 55.9% with BM25 → 70.12% with Qwen3-Embed-8B [abs/full].
- Sonnet 4 + BM25 14.34%; Opus 4 + BM25 15.54%; gpt-oss-120B 28.67% → 42.89% [full: Tab. 1].
- o3 and GPT-5 make more than 20 search calls per query [full].
- 87.59% best reported, GPT-5 + Reason-ModernColBERT (vendor blog, 2026-03) [web].

**Relation to Decorum.** The most reproducible deep-research benchmark. Fixing the corpus and retriever removes live-web variance, so differences between rulebooks are attributable. The questions decompose into independent clue searches that suit parallel subagents, and they produce the long, noisy contexts in which Tran & Kiela predict multi-agent systems can win. Pick the model and retriever so the single agent sits mid-range (for example a mid-tier model with BM25).

**Limitation.** Scoring is an LLM judge on short answers, and the parts read report no human validation. It is near saturation with frontier models and strong retrievers.

### BrowseComp
Wei, J., Sun, Z., Papay, S., et al. (2025). *BrowseComp: A Simple Yet Challenging Benchmark for Browsing Agents.* arXiv:2504.12516. https://arxiv.org/abs/2504.12516

**Summary.** 1,266 questions written so that the answer is short and easy to verify but hard to find. Writers checked that GPT-4o, o1 and early Deep Research failed on them, and that five Google searches did not surface the answer. Grading uses an LLM with the Humanity's Last Exam prompt.

**Key numbers.**
- Human trainers solved 29.2% within two hours; their answers matched the reference 86.4% of the time [full: Tab. 2].
- GPT-4o 0.6%, with browsing 1.9%; o1 9.9%; Deep Research 51.5% [full: Tab. 3].

**Relation to Decorum.** The source of BrowseComp-Plus's questions. On the live web it is not reproducible enough for comparing rulebooks, and it is nearly saturated (>90% per LoHoSearch [abs]).

**Limitation.** Live web, LLM grader, saturating.

### LoHoSearch
Zhao, J., Zhang, R., Liu, L., Yang, H., Cai, X., & Su, X. (2026). *LoHoSearch: Benchmarking Long-Horizon Search Agents Beyond the Human Difficulty Ceiling.* arXiv:2606.12837. https://arxiv.org/abs/2606.12837

**Summary.** 544 human-verified questions in 11 domains, generated by sampling tree-structured subgraphs from a knowledge graph of more than 7 million Wikipedia entities. Each answer is unique within the graph. Agents get live `search` and `browse` tools, and accuracy is the average of two LLM judges.

**Key numbers.**
- Best 34.74% (GPT-5.5) [abs/full].
- DeepSeek-V4-Flash: 58.84% on BrowseComp vs 10.02% on LoHoSearch [full].
- Context-management strategies add at most +6.8 points [abs].

**Relation to Decorum.** A harder transfer test with real headroom for single agents, and its tree structure maps cleanly onto subtasks. It needs a fixed corpus before it can be used reproducibly.

**Limitation.** Live search and LLM judges. Uniqueness is guaranteed only inside the graph [full].

### FRAMES
Krishna, S., Krishna, K., Mohananey, A., et al. (2025). *Fact, Fetch, and Reason: A Unified Evaluation of Retrieval-Augmented Generation.* NAACL 2025. arXiv:2409.12941. https://arxiv.org/abs/2409.12941

**Summary.** 824 human-written questions, each requiring 2–15 Wikipedia articles and listed with those articles. Reasoning types include numerical, tabular, temporal and multiple-constraint questions.

**Key numbers.**
- Gemini-Pro-1.5: 0.408 naive, 0.66 with multi-step retrieval [abs/full], 0.729 with oracle articles [full].
- The LLM autorater agrees with humans at 0.96 accuracy, κ=0.889 [full].

**Relation to Decorum.** The only research candidate whose judge has been validated, and it is cheap. But Tran & Kiela use it (closed-book) as the setting where single agents win, and the questions are contaminated. Use it at most as a secondary, retrieval-required check.

**Limitation.** Wikipedia contamination. Closed-book frontier accuracy is about 0.70.

## Considered, not kept (no PDF)

| Benchmark | arXiv | Why not kept |
|---|---|---|
| SWE-bench Verified (OpenAI 2024 blog) | — | Covered under SWE-bench. Saturated and contaminated; OpenAI stopped reporting it in Feb 2026 [web] |
| Multi-SWE-bench | [2504.02605](https://arxiv.org/abs/2504.02605) | 1,632 tasks in 7 languages [abs]; best 19.32% in 2025 [full: SWE-bench-Live]. Multilingual environments add cost and are not needed for the claim |
| SWE-Gym | [2412.21139](https://arxiv.org/abs/2412.21139) | 2,438 training tasks from 11 repositories not in SWE-bench (pandas, MONAI, moto, …) [full]. A possible evolve pool, but SWE-rebench's pool is larger and fresher |
| SWE-Bench Illusion | [2506.12286](https://arxiv.org/abs/2506.12286) | Contamination evidence: 76% vs 53% file-path identification [abs]; cited above |
| SWE-Bench Pro Verified | [2609.08149](https://arxiv.org/abs/2609.08149) | Fixes Pro's leakage channels [abs]; check whether its data is released before using Pro |
| SWE-MERA | [2507.11059](https://arxiv.org/abs/2507.11059) | Same niche as SWE-rebench; 728 tasks [abs] |
| GAIA | [2311.12983](https://arxiv.org/abs/2311.12983) | 466 questions; 300 answers held back [abs]. Multimodal and general-assistant, not multi-hop research; live web |
| MuSiQue | [2108.00573](https://arxiv.org/abs/2108.00573) | Exact-match scoring and 2–4 hops [abs], but from 2021 and contaminated; the closed-book setting where single agents win (Tran & Kiela) |
| HotpotQA | [1809.09600](https://arxiv.org/abs/1809.09600) | Saturated and contaminated |
| WebWalkerQA | [2501.07572](https://arxiv.org/abs/2501.07572) | Traversal of a live website; not a fixed corpus |
| xbench | [2506.13651](https://arxiv.org/abs/2506.13651) | The paper reports Recruitment and Marketing suites; the DeepSearch set is web-only and continuously updated |
| SimpleWikiSearch | [2607.26070](https://arxiv.org/abs/2607.26070) | Not a benchmark: a fixed offline Wikipedia search environment. A possible substrate for running LoHoSearch or FRAMES reproducibly |

## Harnesses: enforcement points

Decorum's typed primitives (visibility, handoff, closing, review, dissent, escalation, budget) need four hooks in the harness:
1. a gate before a tool call that can **block** or **rewrite** it;
2. a hook after a tool call that can **rewrite** its result;
3. **message/context interception**, to filter which threads an agent sees;
4. **spawn and budget control**.

The survey below is from repository and docs reads on 2026-10-01; the event names were checked against source. Anything not verified directly is marked.

| | **Pi** (first choice) | **Claude Agent SDK** (fallback) | **mini-swe-agent** | **OpenHands SDK** |
|---|---|---|---|---|
| Repository / licence | `badlogic/pi-mono` → redirects to `earendil-works/pi`; MIT; TypeScript; v1.0.0 released 2026-10-01 | Python SDK MIT; TS SDK under Anthropic commercial terms; runs the Claude Code binary | `SWE-agent/mini-swe-agent`; MIT; Python; v2.4.6 | `OpenHands/software-agent-sdk`; MIT; Python |
| Subagents | **Not in core**, by design ("just ask it to run itself via bash", Zechner's blog, 2025-11). An example `subagent` extension spawns separate `pi` processes (scout/planner/reviewer/worker) with per-agent token and cost counts; an experimental durable `subagent` tool exists | Native: `AgentDefinition` + `Agent` tool; nested up to depth 3 by default; up to 20 concurrent; `SendMessage` between agents | None | `TaskToolSet` (synchronous, resumable), `DelegateTool` |
| Pre-tool gate | `tool_call`: can **block** (`{block, reason}`) or **change the input**; a handler that throws blocks the call (verified in docs/extensions.md) | `PreToolUse`: `permissionDecision` allow/deny/ask/defer, plus `updatedInput` (verified in the hooks docs); `canUseTool` callback as the last step | No hooks: subclass `DefaultAgent.execute_actions`; `whitelist_actions` regex in interactive mode | `PreToolUse`: deny only (exit 2), no input rewrite found |
| Post-tool rewrite | `tool_result`: replace content/details/isError; handlers compose | `PostToolUse`: `updatedToolOutput` / `additionalContext` | Subclass | `PostToolUse` observes only |
| Message/context interception | `context` (rewrite the messages sent to the model), `input` (transform/handled), `message_end` (replace), `turn_end`/`agent_before_settle` (force another turn) | `UserPromptSubmit`, `Stop`/`SubagentStop` (block); TS-only `TaskCreated`/`TaskCompleted` (exit 2 rolls back creation or blocks completion; verified in the hooks docs), `SubagentStart` | Subclass | `UserPromptSubmit` (inject only), `Stop` (block) |
| Custom tools | `pi.registerTool()` (TypeBox), `setActiveTools`; tool calls made from inside tools also pass through the gates | In-process MCP (`createSdkMcpServer`) | Subclass | `register_tool` |
| Budget | **None built in** beyond thinking-token caps. Build it in an extension: read usage, then `ctx.abort()` | `maxTurns`, `maxBudgetUsd` (also refuses new spawns), depth and concurrency caps; cost is a client-side estimate | `step_limit`, `cost_limit` | `max_iteration_per_run`, `max_budget_per_run` |
| Models | Any (`pi-ai` unified API) | Claude only; non-Claude models through a gateway are not documented | Any (litellm) | Any (LiteLLM) |
| Programmatic control | SDK (`createAgentSession`), RPC mode (JSONL), JSON event stream | SDK | Python | SDK, event log |

**Can a forum layer with enforced rules be built on Pi?** Yes, as one extension, with the following pieces:
- **Threads and tasks** become custom tools (`thread_post`, `thread_read`, `task_assign`, `task_accept`, `task_close`) backed by a store the extension owns.
- **Handoff and closing** become `tool_call` gates that check the task state machine. For example, `task_close` is blocked unless the domain adapter's evidence check passes (tests green for coding, cited document ids for research), and a review rule blocks it until a reviewer has accepted.
- **Visibility** is enforced twice: `thread_read` results are filtered by `tool_result`, and the `context` event strips threads the agent may not see.
- **Dissent and escalation** use `agent_before_settle`/`turn_end` to keep an agent running while it has an unresolved objection, plus an `escalate` tool routed to the main agent.
- **Budget** is a per-agent ledger fed by usage events, enforced by `ctx.abort()` and by gating the spawn tool.
- **Subagents** are child `pi` processes over RPC mode, adapting the example extension. The parent extension owns the thread store, and children reach it through tools, so the rules run in one place.

What has to be built: the subagent manager, the token ledger and the store. None of them exist in core.

**Claude Agent SDK as fallback.** Most of this comes out of the box: `PreToolUse` deny/rewrite, `PostToolUse` rewrite, `TaskCreated`/`TaskCompleted` blocking (close only with evidence), native subagents and USD caps. The cost is that E1 and E3 would be Claude-only, and evolved rulebooks could not be tested across model families. OpenCollab's audit also rates Claude Code as unable to hold the context factor constant [full: 2609.38345 Tab. 1].

**Baselines.** Use mini-swe-agent as the "single agent, default harness" arm. It is the fixed harness of the SWE-bench bash-only and DeepSWE leaderboards, so published numbers are comparable. OpenHands' pre-hooks can only deny and its post-hooks can only observe, so it is weaker for enforcement.

## Recommendation (for the team to decide)

**Coding: SWE-rebench, repository-disjoint.**
- **Evolve set:** about 60–100 tasks sampled from the SWE-rebench pool (or the 2025 monthly splits), restricted to clarity/difficulty-filtered tasks.
- **Held-out test set:** about 100–150 tasks from the 2026 monthly splits (215 tasks / 146 repositories for Jan–Mar 2026), dropping any repository that appears in the evolve set.
- **Runs:** 3 seeds per arm, with a hard per-instance token cap enforced in the harness. Per-problem cost is about $0.8–4.4 for frontier configurations [web]; a mid-tier model sits lower and further from the ceiling.
- **Optional:** a 113-task DeepSWE pass as a contamination-free stress test on new repositories, at $1.2–7.7 per task.
- **Tradeoff:** SWE-rebench wins on contamination (5) and repository split (6), and has live single-agent and Claude Code/Codex reference numbers. It loses on task quality: automated curation leaves noisier, partly unsolvable tasks, and it is Python only. SWE-bench Pro public (731 tasks, 11 repositories) is better known and human-verified, but its repository split is coarse and leakage has been reported.
- **Noise:** about 14% of tasks flip outcome between identical single-agent runs (5 of 36 in OpenCollab). At n≈100, differences under about 10 points are within noise unless seeds are pooled.

**Research transfer: BrowseComp-Plus, fixed corpus and fixed retriever.**
- **Subset:** 150 queries, stratified, 3 seeds. Use BM25 or Qwen3-Embed-0.6B, with a model tier where the single agent scores about 15–45% (e.g., Sonnet/Opus-4-class with BM25 scored 14–16% [full]).
- **Tradeoff:** BrowseComp-Plus is the only reproducible, cheap, decomposable deep-research set. Its judge is an LLM whose validation was not found in the paper. Validate it on about 100 answers by hand, or add a normalised exact-match score alongside it, before relying on it.
- **Alternative:** LoHoSearch has more headroom (34.74% best) and answers that are unique in the knowledge graph, which makes exact match feasible. But it needs live search, or an offline Wikipedia index that nobody has tested yet.
- **Avoid:** closed-book FRAMES and MuSiQue as the transfer test. Tran & Kiela show single agents win there at equal budget.

## Sources accessed on the web (2026-10-01)
- SWE-bench leaderboards JSON (bash-only entries tagged "Mini"): https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json
- SWE-bench Pro leaderboard: https://labs.scale.com/leaderboard/swe_bench_pro
- SWE-rebench leaderboard: https://swe-rebench.com/ ; splits from https://huggingface.co/datasets/nebius/SWE-rebench-leaderboard
- OpenAI, "Why SWE-bench Verified no longer measures frontier coding capabilities" (Feb 2026), https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ (HTTP 403; numbers via https://decrypt.co/359012/openai-benchmark-measure-ai-coding-supremacy-contaminated)
- BrowseComp-Plus repository: https://github.com/texttron/BrowseComp-Plus ; LightOn blog: https://lighton.ai/lighton-blogs/the-bloated-retriever-era-is-over
- Anthropic, "How we built our multi-agent research system" (2025-06-13), https://www.anthropic.com/engineering/multi-agent-research-system. Token usage alone explains 80% of BrowseComp variance, and multi-agent systems use about 15× the tokens of chat. This is why equal-budget comparisons are mandatory.
- Pi: https://github.com/earendil-works/pi (docs/extensions.md; examples/extensions/subagent) ; https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- Claude Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview , /subagents , /hooks , https://code.claude.com/docs/en/hooks
- mini-swe-agent: https://github.com/SWE-agent/mini-swe-agent ; OpenHands SDK: https://docs.openhands.dev/sdk
