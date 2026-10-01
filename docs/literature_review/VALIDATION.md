# Validation of the Decorum literature review

**Date:** 2026-10-01
**Validator:** independent validation pass by Kavosh, one of Tawab's agents. The validator did not write the themes, ran one checker per theme, and wrote the coverage search and the merge itself.
**Scope:** all seven themes. Theme 05 and theme 07 were validated after their writers finished; both READMEs existed and were complete when checked.

## What was checked

For each theme:
1. **Identity.** Every arXiv id in `README.md` and `refs.bib` was resolved through Kestrel `get_papers` (pre-2023 ids through the arXiv API), and the title, first author and year were compared with the record. Venues were checked against PDF headers or publisher pages where claimed.
2. **PDFs.** `file` on every PDF, and the first-page title (`pdftotext -l 1`) compared with the paper the file is named for.
3. **Numbers.** Every number tagged [abs] was compared with the Kestrel abstract. Numbers tagged [full] were checked against `pdftotext` output; in practice the checkers covered most of them, not only the 3–4 asked for.
4. **Closest-work claims.** Every differentiating claim about the papers a theme calls closest to Decorum was read against the full text and marked confirmed, wrong or partly.
5. **Coverage.** 11 fresh Kestrel searches (most with 2 paraphrases fused) since 2024-06-01 with phrasings the writers may not have used, plus `similar_papers` on 2602.00755, 2605.29790 and 2602.04431.
6. **Merge.** `references.bib` and the top-level `README.md`.

## Counts

| Theme | arXiv ids | [abs] numbers | [full] numbers | PDFs |
|---|---|---|---|---|
| 01 topology & workflow search | 40 | ~45 | 30+ | 12 |
| 02 coordination protocols & norms | 43 | 26 | ~60 | 13 |
| 03 reflective optimization | 35 | 33 | ~102 | 12 |
| 04 multi-agent safety | 40 | ~45 (incl. qualitative and untagged) | ~74 (+6 from the METR report page) | 12 |
| 05 benchmarks & harnesses | 25 | 16 | ~50 | 12 |
| 06 runtime enforcement | 24 | 27 items (~50 numbers) | 22 items | 12 |
| 07 human in the loop | 23 | 20 | ~35 | 10 |
| Added by validation | 9 | 9 entries (abstract numbers only) | n/a | 9 |
| **Total** | **239 id checks** (~213 unique ids in the review after additions) | **~245** | **~375** | **92** |

**Outcome:**
- Every arXiv id resolves. No PDF is wrong or fake, and none had to be re-downloaded.
- 1 number was wrong: GEPA's two percentages were swapped (theme 03).
- 9 numbers carried the wrong source tag ([abs] where the number is only in the full text or camera-ready).
- Several numbers were scoped more tightly (which model, which subset).
- 9 closest-work claims were wrong or partly wrong, all corrected in place (see "Fixes"). These matter most for the proposal.
- `4916.37645`, found by a regex over theme 06, is not an id: it is a fragment of AgentSpec's DOI 10.1145/3744916.3764546. Nothing to fix.

## Most important fixes (closest-work claims)

| Theme | Paper | Old claim | Status | New wording / evidence |
|---|---|---|---|---|
| 01 | Meta-Team 2605.29790 | Decorum stands apart by comparing against hand-designed topologies at equal budget | **wrong** | Meta-Team compares against hand-crafted multi-agent systems (unevolved MAS, OWL, AOrchestra, AggAgent) under shared per-case limits (App. F.3). Differentiator removed. |
| 01, 03 | Meta-Team | No cross-domain / out-of-distribution evaluation | **partly** | Within-benchmark shifts exist (LoCoBench Python → C/C++/Java; LOCA-Bench 96K → 8K–256K, §4.4); no cross-*domain* transfer. |
| 03 | Meta-Team | No topology-search baseline at equal budget | **partly wrong** | AgentNet (whose graph edges evolve) is a baseline; there is no G-Designer- or MaAS-style communication-topology search. |
| 01 | AFlow on MANTA's benchmarks (51.6 vs 59.3) | "out of domain" | **wrong** | MANTA re-ran AFlow's search in-domain. |
| 01 | AOrchestra 2602.03786 | Nothing constrains the orchestrator except its prompt | **partly wrong** | Its actions are fixed in code (Delegate/Finish) and attempts are capped. |
| 01 | Opening gap | No method separates enforced from prompted coordination | **too strong** | MANTA enforces visibility in code; none *compares* enforced with prompted. |
| 04 | MaMa 2602.04431 | Rules are prompts/topology only | **wrong** | The Meta-Agent can write Python tools implementing approval/voting and a speaker-selection function. |
| 04 | MaMa | Optimises safety rather than task success at a fixed budget | **wrong** | Fitness = clean task quality + safety under attack, equally weighted; 50-action cap. |
| 02 | Swarm Skills 2605.10052 | (implied) not a manager-led task-solving harness | **wrong** | It is: a Leader spawns teammates, Claude-Code-compatible. It differs from Decorum only in enforcement and evaluation. |
| 02 | Niranjani 2605.09128 | "External" reuses item 1's evolved constitution | **wrong** | Evolution is re-run per environment from the same blank constitution. |
| 02, 06 | POLIS 2608.09828 | Filed as a single-agent/security result; "enforced beats prompted" | **corrected** | Multi-agent delegation. Prompt and enforcement tie at 0/384; enforcement wins only in laundering scenarios (22/96 vs 0/96). |
| 05 | OpenCollab 2609.38345 | Adherence as low as 47.2% for "prompt-only" organisations | **partly** | The 47.2% team had gated tools, edges and budgets; nothing forced the lead to delegate. Higher Adherence (94.4%) lowered pass rate (52.8% vs single agent 69.4%). Duo is effectively best-of-two and not budget-matched. |
| 05 | OpenCollab | No review step | **partly wrong** | Duo selects between candidates by a code rule with a read-only adjudicator agent. |
| 06 | Institutional AI 2601.11369 | Rules not optimised, hand-written | **partly** | A staged screening sweep and factorial ablation over candidate institutions, then frozen. |
| 06 | Opening paragraph | Every system hand-authors its rules | **partly** | AgentSpec also has o1 generate rules, scored against risk labels, not task success; GovSim-SelfGovern agents author executable rules themselves. |
| 03 | Constitutional Evolution 2602.00755 | No adversarial tests | **partly** | Its "zero-sum" arm gives an adversarial constitution to every agent; there is no saboteur inside a cooperating team. |

All other closest-work claims were **confirmed**. The per-theme detail is below.

## Coverage additions

Searches run (since 2024-06-01):
- "agent society rules optimization software engineering"
- "protocol search multi-agent LLM" (+2 paraphrases)
- "learning organizational structure for LLM teams"
- "evolving the rules of interaction among LLM agents…" / "message passing rules evolve" / "learned communication norms"
- "governance policy optimization agents task performance" (+2)
- "subagent delegation policy learned" (+2)
- "multi-agent debate protocol optimization" (+2)
- "evolving collaboration norms coding agents" (+2)
- "optimizing the coordination mechanism, not the topology…" (+2)
- "automatically learning coordination rules for orchestrator-subagent coding systems" (+2, since 2025-01-01)
- "norm enforcement sanctions LLM agent society institution design optimized" (+2)

Also `similar_papers` on 2602.00755, 2605.29790 and 2602.04431.

Added under "Added by validation" (entry + bib + PDF):

| Theme | Paper | Why |
|---|---|---|
| 02 | **2602.02170 SECP**, Self-Evolving Coordination Protocol | The closest find by wording: governed self-modification of a coordination protocol under invariants. A feasibility demo only (one modification, 2 → 3 accepted proposals, no learning claimed). |
| 02 | **2606.14314 CPE**, Communication Policy Evolution | Evolves a communication policy (prompt-level, LLM optimizer) for task success in Planner–Executor and User–Agent settings. |
| 02 | 2605.27466 AgensFlow | Learns coordination decisions (role, model, topology, verify/skip) as an online policy from trajectories. |
| 02 | 2608.23867 AgentLance | A code-enforced market mechanism for delegation. A centralised LLM allocator can be manipulated (one inserted preference nearly doubles a favoured agent's share). |
| 02 | 2512.02329 Dam et al. | A vision paper: deontic norms governing human–AI software-engineering agent teams. |
| 01 | 2510.18032 OPTAGENT | Verbal RL that optimises the multi-agent collaboration graph using feedback on interaction quality. |
| 03 | 2608.04968 EvolveNet | Harness evolution with scope-typed composition of edits from separate deployments. |
| 06 | **2608.16055 Governance at the Boundary** | The orchestrator–subagent handoff drops policy facts: 85% attenuation vs 0% for a single loop (32B model). Direct motivation for an enforced `handoff` primitive and a measurable E2 failure mode. |
| 06 | 2609.05531 When Agent Governance Helps | Prompt-layer governance benefit is gated by model capacity and domain; a per-task definition-of-done beats a uniform procedure. |

Seen and judged not close enough to add:
- 2601.10599 (Institutional AI position paper by the same group as 2601.11369; cite only if the framing is needed);
- 2607.05477 (decision protocols compared, not optimised);
- 2606.00804 (coordination-strategy routing by problem class);
- 2604.15034 Autogenesis (a self-evolution protocol for resources);
- 2605.14212 MetaAgent-X;
- 2602.13671 MASFly;
- 2609.31963 (symbolic guidance);
- 2603.12229 (LM teams as distributed systems);
- 2609.18929 (social laws, non-LLM);
- debate-protocol papers (2311.17371, 2504.05047, 2509.11035).

None of them evolves an enforced rulebook for a task-solving LLM team.

**Novelty verdict after coverage:** no paper found evolves an *enforced*, typed rulebook in a manager-led LLM harness for task success, with in-team adversaries and cross-domain transfer. But each component has precedent:
- evolved prompt-level rules: Constitutional Evolution, Meta-Team, CPE;
- a self-evolving spec in a manager-led harness: Swarm Skills;
- code-enforced coordination tools co-designed against an adversary: MaMa;
- enforced vs prompted rules: Institutional AI, POLIS, OpenCollab;
- governed protocol self-modification: SECP.

## Merge

- `references.bib`: 101 unique entries from 107 theme entries.
  - Five papers appeared under the same key in two themes and are kept once: `zhou2026multi`, `kumar2026evolving`, `hao2026evolve`, `bracalesyrnikov2026institutional`, `rosser2025agentbreeder`.
  - One alias: `anthropic2025multiagent` (05) is the same blog post as `hadfield2025how` (02), and `hadfield2025how` is kept.
  - Theme 03's `rosser2025agentbreeder` was changed from an arXiv preprint entry to the NeurIPS 2025 entry verified in theme 04, so both themes agree.
- `README.md`: index of themes and the consolidated closest-work table (confirmed claims only), with a "must not claim" list.

## Unresolved issues

- AOrchestra's abstract "16.28% relative improvement" cannot be reproduced from its own Table 1 (71.62 vs 49.49 is +44.7% relative). Do not cite that figure.
- MANTA's 4th author is "Zhengxin" on arXiv and "Zhenxing" in the PDF; the bib follows arXiv.
- Who&When's "spotlight" status is not verifiable from the PDF.
- The number of seeds behind Meta-Harness's Table 3 ablation is not stated.
- MoMHa reports no variance, so its trace-vs-scalar gap can be called neither real nor within noise.
- BrowseComp-Plus reports no human validation of its gpt-4.1 judge.
- Theme 05 numbers tagged [web] (leaderboards, blogs, harness docs) were not re-checked.
- Theme 06 not-kept list: venues "EMNLP 2026 Findings" (2604.09443) and "ICML 2026 workshop" (2607.09766) are unverified.
- Meta-Team significance: in its Appendix E paired t-tests, 3 columns are not significant (SWE-Pro Qute., BeyondSWE CrossRepo, GAIA).
- The 9 coverage additions were read at abstract level (with a method skim). Their entries carry abstract numbers only and were not read in full.

---

## Appendix: per-theme validation logs

Fixes, closest-work verdicts and unresolved notes as recorded by each theme's checker. "Original backed up" notes refer to the validator's scratch copies, which are not in the repo.


### Theme 01-topology-and-workflow-search
#### Counts
- arXiv ids checked: 40 (all in README + 12 in refs.bib) via Kestrel get_papers; 40/40 resolve; titles, first authors, years match for all 12 bib entries and all table rows.
- [abs] numbers checked: ~45 numeric values across 23 [abs]-tagged lines (kept + considered-not-kept); all appear in the Kestrel abstracts.
- [full] numbers checked: 30+ against PDF text (Meta-Team Table 1/3, §1, §4.2; MANTA Tables 1–4; AOrchestra Table 1, App. A.1, §1; Kim §1; So §3.2/§4; ADAS Table 2/§4.3; MaAS Table 8; Puppeteer §3; GPTSwarm §3.1.2; MASS §4). All numbers match.
- PDFs checked: 12/12 real PDFs, first-page titles match the named paper.

#### Fixes (README.md; original saved at scratchpad/val01-README.orig.md)
1. Opening gap (2): "No method separates enforced coordination rules from prompted ones, and none compares the two." → "Only MANTA enforces part of its coordination (information visibility) in code rather than in prompts, and no method compares enforced coordination rules with prompted ones." (MANTA App.: "information visibility is enforced in code when packets are read, not through prompt instructions".)
2. Meta-Team Relation (c): "E2 and E3 have no counterpart here, since Meta-Team evolves and tests within each benchmark" → E2 has no counterpart; E3: Meta-Team does test within-benchmark generalization (LoCoBench Python→C/C++/Java; LOCA-Bench 96K→8K–256K, §4.4), never cross-domain.
3. Meta-Team Relation (d) "Decorum compares against hand-designed topologies at equal budget" REMOVED as a differentiator (WRONG): Meta-Team compares against hand-crafted MAS (unevolved MAS, OWL, AOrchestra, AggAgent) under shared per-case time/message/cost limits (App. F.3). Kept a validation note in place.
4. Meta-Team Relation (a): added caveat — constitution is "the global prompt" (§3.2) but run-time primitives (StartAgent, Finalize…) are fixed code and per-agent tool lists live in editable config.yaml (App. D).
5. Meta-Team Limitation: "no adversarial or cross-domain evaluation" → "no adversarial evaluation; generalization tested only within a benchmark (cross-language, cross-context-length), not across task domains".
6. Meta-Team key number: "6.6% over hand-crafted MAS" → clarified it is 6.6 points (62.7 vs 56.1).
7. AFlow key number: "Out of domain, AFlow topologies degrade, e.g. 51.6 vs 59.3 [MANTA Table 1]" → mislabeled: MANTA ran AFlow with its own optimization procedure on those benchmarks (in-domain). Rewritten as in-domain result on harder agentic tasks, not a transfer test.
8. AOrchestra Claude Code caution: "22.0 / 25.0" → labelled the two backbones (Gemini-3-Flash / Claude-4.5-haiku).
9. AOrchestra Limitation: "Nothing constrains the orchestrator except its prompt" → partly wrong; orchestrator has a code-fixed action space {Delegate, Finish} and an attempt cap (max attempt = 10). Reworded.
10. MANTA Limitation: "enforcement covers visibility only" → "code enforcement covers visibility (plus structural validation of the topology)".
11. Cross-domain transfer list: Meta-Team line updated to include within-benchmark shifts.
refs.bib: no changes needed.

#### Unresolved / notes
- MANTA 4th author: arXiv/Kestrel metadata "Zhengxin Zhang"; PDF first page "Zhenxing Zhang". Bib follows arXiv metadata; left as is.
- AOrchestra's "16.28% relative improvement" [abs] is not reproducible from Table 1 (71.62 vs 49.49 is +44.7% relative, +22.1 pts); the body also calls it "16.28% points". Number is as stated in the abstract; flag if cited.
- Kim et al. venue "reported under revision at a journal; not verified" — left.
- Opening gap (3) (robustness only vs scripted adversaries on MMLU-style tasks) not exhaustively re-verified beyond GPTSwarm/G-Designer abstracts.

#### Closest-work claims
Meta-Team (2605.29790):
- "evolves a shared team constitution and coordination rules from execution traces, runtime-roster harness, SWE-bench Pro" — CONFIRMED (§3.2 L3; App. D StartAgent, append-only bus; Table 1).
- (a) "constitution is a global prompt / rules prompt-only, unenforced" — CONFIRMED for evolved coordination rules ("the shared team constitution, i.e., the global prompt", §3.2); caveat: fixed code primitives + commit gate checking role consistency/tool availability/budget; per-agent tool lists editable.
- (b) "evolution by the team itself, not an outer optimizer" — CONFIRMED (collaborative self-evolution, post-task discussion, Alg. 1).
- (c-E2) "no adversaries" — CONFIRMED (no adversarial/attack content in paper).
- (c-E3) "evolves and tests within each benchmark / no cross-domain evaluation" — PARTLY: no cross-domain, but within-benchmark OOD tests exist (cross-language, cross-context-length, §4.4, Fig. 3).
- (d) "Decorum compares against hand-designed topologies at equal budget" as a differentiator — WRONG (Meta-Team does this, App. F.3).
- "does not adapt environment harnesses, verifiers" — CONFIRMED (App. A Limitations, verbatim).
- "~20 instances per benchmark evolution set; avg@3; Claude Sonnet 4.6" — CONFIRMED (§4.1).
MANTA (2607.28527):
- "visibility enforced by code whenever information is read" — CONFIRMED (§Topology Representation; App. "enforced in code ... not through prompt instructions").
- "playbook from process-derived labels only, never ground truth" — CONFIRMED.
- "object is a per-task topology spec chosen by a planner" — CONFIRMED.
- "no adversaries" — CONFIRMED. "enforcement covers visibility only" — PARTLY (also structural validation; fixed).
- "best evidence that searched topologies transfer badly" — CONFIRMED (Table 3: MASS −58.3, AgentSquare −13.3, ADAS −3.3; n=30, playbook transfer at mutation budget 0).
AOrchestra (2602.03786):
- "orchestrator only Delegate/Finish, same main-spawns-subagents shape" — CONFIRMED.
- "in-context optimization reads trajectories, performance and cost, edits orchestrator instruction" — CONFIRMED (§3.3; Claude Sonnet 4.5 optimizer, 5 rounds).
- "nothing constrains the orchestrator except its prompt" — PARTLY WRONG (fixed action space, attempt cap); fixed.
- "no shared threads, no successor inheritance, no review/dissent" — CONFIRMED (each sub-agent runs in a fresh container; context curated by orchestrator).
Puppeteer (2505.19591):
- "RL-trained (REINFORCE) orchestrator; topology emerges; fixed agent set; 'deceptive agreement'" — CONFIRMED.


### Theme 02-coordination-protocols-and-norms
#### Counts
- arXiv ids checked: 43 unique (all ids in README.md; the 13 in refs.bib are a subset). All 43 resolve in Kestrel (missing: none); every README label (short name) matches the Kestrel title.
- refs.bib: 13 arXiv entries — titles match Kestrel exactly; author counts match (Magentic-One 19 vs Kestrel 20 is a Kestrel artifact splitting "Erkang (Eric) Zhu" into two names; bib is correct). First authors and years match (HiddenBench 2026 = ICML 2026, confirmed from PDF header "Proceedings of the 43rd ICML"; Colas "CogSci 2026" confirmed from arXiv comment). 4 non-arXiv entries (2 Anthropic blogs, Esteva 2001, Boella 2006) not resolvable in Kestrel; blogs checked via WebFetch (dates/authors match).
- [abs] numbers checked: 26 (Kumar 8, Colas 1, Niranjani 2, Fei 1, Institutional AI 6, HiddenBench 2, MAST 1, screened OCL 2, Agensh 2, SEMAP 1). All appear in the Kestrel abstracts. 0 errors.
- [full] numbers checked: ~60 (all [full] numbers for Kumar, Colas, Niranjani, Fei, HiddenBench, Han, Rehm, MAST, Agora, Magentic-One, MetaGPT via pdftotext+grep; 8 Anthropic-blog numbers via WebFetch). All match. 0 wrong numbers; 2 scoped more tightly (below).
- PDFs checked: 13/13 are real PDFs (`file`) and the first-page title matches the named paper. 0 re-downloads.

#### Fixes (all in 02-coordination-protocols-and-norms/README.md)
1. Item 3 summary: "and the *external* evolved constitution of item 1." → "and *external* evolution with item 1's OpenEvolve method (re-run per environment from the same blank seed constitution as deliberation [full])." (Paper: "Both internal and external methods start from the same blank constitution"; it is not item 1's C*.)
2. HiddenBench: "An explicit "share everything" prompt reaches 0.467 [full]." → "... reaches 0.467 (GPT-4.1, 3-task ablation set) [full]." (Ablations use "GPT-4.1 ... on three tasks".)
3. Anthropic research-system blog: "Token usage explains 80% of performance variance, ..." → "On their BrowseComp analysis, token usage explains 80% ..." (blog: "three factors explained 95% of the performance variance in the BrowseComp evaluation").
4. Screened list, 2608.09828: "POLIS: an executable provenance guard vs a constitutional prompt." → expanded: it is multi-agent delegation (mis-filed under "single-agent or security"), and a detailed constitutional prompt AND the provenance guard both give 0/384 violations; laundering: local-state guard 22/96 vs provenance 0/96 [abs]. Caution added: on its main suite prompting matched enforcement.
5. Novelty item 4 (Swarm Skills): added a validation note — its setting is a Leader + spawned-Teammates task-solving harness (Claude-Code-compatible) [full], so "manager-led task solving" is NOT a differentiator against it; enforcement and quantitative evaluation are.

#### Unresolved
- Fei "one run per (model, institution, benchmark) cell": paper says "Each (model, institution, benchmark) triple constitutes one full evaluation run" — consistent, kept.
- Theme paragraph 2 claim "None ... evolves a rulebook enforced by the harness in a manager-led, task-solving system" holds for the papers in this theme, but only within this theme's set (coverage is the parent's job). Swarm Skills is the nearest: evolves coordination specs in a manager-led harness, but specs are prompt/document-driven and unevaluated.
- POLIS (2608.09828) result cuts against a naive "enforced > prompted" claim; the parent should reconcile with theme 04/06 entries that cite it.

#### Closest-work claims
2602.00755 Constitutional Evolution (Kumar et al.)
- "Constitution is only text in each agent's prompt; nothing enforces it" — CONFIRMED. p.5 §4.1.1 "Agent prompts include their team's constitution"; Def. 3.1 natural-language rules "intended to be applied in priority order"; environment enforces only game physics.
- "6×6 grid, 6 agents, fixed teams, scripted Overseer, welfare index; no task solving/manager/spawning/topology" — CONFIRMED (§3.2: "6×6 grid-world simulation with 6 LLM agents split into two teams"; Overseer "eliminates the agent with the lowest cumulative contribution"; S = 0.5P+0.3V−0.2C).
- "Compare only against other constitutions; no topology baseline; no token budget matching" — CONFIRMED ("We evaluate four constitutional approaches": Zero-Sum, HHH, LLM-Generated, C*; no budget matching mentioned).
- "No adversarial agent inside a cooperating group; Zero-Sum is a whole-society constitution" — CONFIRMED (Zero-Sum is "a purely competitive constitution"; Limitations: "Zero-Sum baseline represents an extreme adversarial case").
- "Transfer is future work" — CONFIRMED (§5: "explore whether evolved constitutions transfer across environments").
- "Optimizer sees score plus action logs; no optimizer-input ablation" — CONFIRMED (§3.1 "Stability Score S alongside detailed action logs ... feed into the OpenEvolve LLM Constitutional Optimizer"; only ablation is single vs multi-island).
- Single backbone GPT-OSS-120B for optimizer and agents — CONFIRMED.

2608.24545 Adaptive Transmission Programs (Colas et al.)
- "Main agents are empowerment (human-model) agents, not LLMs; LLM agents only in transfer (+16%)" — CONFIRMED (§Methods: empowerment model; Gemini 3.0 Flash used as mutation LLM and as LLM agents in transfer; "LLM: +16%").
- "Removing content-dependence while keeping topology and timing eliminates the gain" — CONFIRMED (abstract + Fig. ablation).
- "Centralized/top-down routing program, not a rulebook on autonomous LLM agents; no adversaries; no task-solving harness" — CONFIRMED ("deliberate top-down protocols", "state-aware programs that route information and resources"; crafting discovery task).

2605.09128 Internal vs External (Niranjani et al.)
- "Evolved rules invert from best to worst when m shifts 1.5 → 0.75" — CONFIRMED (Table 2: m=0.75 Ctrl .513, Delib .536, Evol .477).
- "Prompt-only rules, social-dilemma games, single backbone" — PARTLY: prompt-only CONFIRMED ({constitution_block} in the agent prompt), single backbone CONFIRMED ("single LLM backbone (GPT-OSS-120B)"); "social-dilemma games" is loose — the bilateral trading market is not a social dilemma.
- "Evolution = the evolved constitution of item 1" — WRONG, fixed (re-evolved from blank per environment).

2605.10052 Swarm Skills
- "No quantitative evaluation" — CONFIRMED (no numeric results in the paper; §Limitations "absence of large-scale, quantitative conformance testing").
- Implied "not in a manager-led task-solving harness" — WRONG by implication in theme paragraph; it IS a Leader/Teammates task-solving harness. Note added.

2604.27691 When Agents Evolve, Institutions Follow
- "Evolves nothing; static hand-designed specs; meta-governance is future work" — CONFIRMED (Limitations: "Institutions are modeled as static specifications"; "Key open directions include building a meta-governance layer").

2601.11369 Institutional AI
- "Runtime Oracle/Controller enforces a hand-written governance graph; graph not evolved" — CONFIRMED ("public, immutable manifest"; revision only proposed as future manifest diffs / RLINF).
- "Prompt-only constitution gives no reliable improvement" — CONFIRMED (abstract; tier 3.10 → 3.02 Constitutional vs 1.82 Institutional).
- "Cournot duopoly; collusion only" — CONFIRMED (Limitations "two-firm Cournot").

2609.22600 GovSim-SelfGovern
- "Agents write executable Python laws, sandbox-validated, voted, enforced; commons game; authored online by governed agents, not optimized offline" — CONFIRMED (abstract).


### Theme 03-reflective-optimization
#### Counts
- arXiv ids checked: 35 (union of README.md + refs.bib), all resolve in Kestrel (`missing: []`); titles, first authors, years in refs.bib match the records. TextGrad bib uses the Nature title/author list (venue version) — correct for the cited venue.
- Venues checked against arXiv comments / PDF: GEPA ICLR 2026 oral, MASS ICLR 2026, MoMHa NeurIPS 2026, Trace NeurIPS 2024, Who&When ICML 2025 (PMLR v267; "spotlight" not verifiable from PDF), ACE ICLR 2026, OptiMAS EMNLP 2026 — all consistent.
- [abs] numbers checked: 33, every one. 31 in the abstract; 2 tagged [abs] but only in the full text (fixed, see below).
- [full] numbers checked: ~102 (all of Meta-Harness, Meta-Team, Constitutional Evolution, GEPA, AHE, Rethinking, MoMHa, MAS-PromptBench, MASS; Trace 10%; El +10%/DROP+MMLU). 1 wrong (GEPA swap).
- PDFs checked: 12; all real PDFs (`file`), first-page titles match their file names / papers. No re-downloads.

#### Fixes (README.md; backup of original at scratchpad/README-03.orig.md)
1. GEPA key numbers: "GEPA +13.33% and GEPA+Merge +12.19% vs MIPROv2 +5.64% [full, Obs. 2]" → "on GPT-4.1 Mini: GEPA +12.19% and GEPA+Merge +13.33% vs MIPROv2 +5.64% [full, Table 2; Obs. 2]. On Qwen3 8B: GEPA +9.62% vs MIPROv2 +2.61% [full, Table 1]". (Table 2: GEPA 65.22 / +12.19, GEPA+Merge 66.36 / +13.33.) Same fix in the E4 table row.
2. GEPA: "Beats GRPO (24k rollouts) … [abs]" → 24k moved out of the [abs] clause: "GRPO used 24,000 rollouts [full, Table 1]".
3. Meta-Harness: "#1 among Haiku 4.5 agents on TerminalBench-2 [abs]" → "[full, §4.3; the abstract says only 'surpass the best hand-engineered baselines']", plus "#2 among Opus 4.6 agents".
4. Intro: "MoMHa's ablation is within noise" → "gap is small and reported without variance (0.611 vs 0.604 overall)". MoMHa relation + E4 row: "within noise" → no variance in App. K ablation table; capability identical (0.539 vs 0.539), whole gap is safety (0.781 vs 0.754).
5. Intro limitation 2: "evolves a team without a topology-search baseline at equal budget (Meta-Team)" → baselines include AgentNet (DAG edges evolve from per-task success) under the same per-case budget; missing is a dedicated communication-topology search (G-Designer, MaAS).
6. Intro limitation 4: "across models, not domains" → "across models, programming languages or context lengths, not task domains".
7. Intro limitation 5: added that Meta-Team ablates how MAS traces are organized (Table 2) but has no scores-only arm.
8. Meta-Team numbers: added AOrchestra 57.8 (strongest baseline overall in Table 1; MASFly is strongest *evolution* baseline).
9. Meta-Team relation (ii) and (iv): added AgentNet nuance; added within-domain transfer (LoCoBench Python → C/C++/Java; LOCA-Bench 96K → 8K–256K, §4.4).
10. Meta-Team limitation: "no variance reported in Table 1" → + "(App. E gives paired t-tests: margins on SWE-Pro Qute., BeyondSWE CrossRepo and GAIA are not significant)".
11. Constitutional Evolution relation: added that its "adversarial" arm is a zero-sum constitution given to all agents, not a saboteur among cooperating agents.
12. AHE limitation: "It is single-agent" → "Its seed is single-agent (sub-agent configs are an editable component, but no multi-agent coordination is studied)" (§3.1: seven component types incl. sub-agent configuration).
13. Rethinking summary: "Baselines are parallel sampling, sequential refinement, and harness scaling" → harness scaling is a second harness-evolution variant (Table 1 groups it under Automatic Harness Evolution).
14. Novelty-check Meta-Team bullet: "no matched topology-search arm … evolves per benchmark" → no communication-topology-search arm (AgentNet nearest), transfer only across languages/context lengths.
refs.bib: no changes needed.

#### Closest-work claims (vs full text)
Meta-Team 2605.29790
- (i) constitution / rules are prompt-only, not enforced — CONFIRMED. §3.2: constitution is "the global prompt that defines common objectives, collaboration principles, and decision rules"; App. D: all evolving components are plain-text files (patches, teammate profiles, collaboration notes). App. A: infrastructure (tool APIs, harnesses, verifiers) not adapted. Nuance: roster/organization also evolve (structural), and pre-commit checks validate updates (role consistency, tool availability, format, budget) — validation of edits, not runtime enforcement of interaction rules.
- (ii) no topology-search baseline at equal budget — PARTLY WRONG. Baselines share "executor, tools, and per-case budget" (§4.1); AgentNet = "decentralized DAG of agents … whose edges evolve from per-task success signals"; §4.5 compares evolution methods under a 1/3 evolution budget. No G-Designer/AFlow/MaAS-style topology search. Fixed.
- (iii) no adversaries — CONFIRMED (no attack/malicious/inject/sabotage/adversarial evaluation in text).
- (iv) no cross-domain transfer — CONFIRMED for task-domain transfer, but "evolves per benchmark" alone understated: it transfers Python→C/C++/Java and across context lengths (§4.4). Fixed.
- Open-roster primitives LISTPOOL/STARTAGENT/STOPAGENT/FINALIZE, append-only bus — CONFIRMED (App. D).
Constitutional Evolution 2602.00755
- prompt-only rules — CONFIRMED ("Agent prompts include their team's constitution", §4 setup).
- toy grid-world survival game, 6 GPT-OSS-120B agents, 2 teams, Overseer every 10 turns — CONFIRMED (§3.2).
- K = 2 rollouts, 30 iterations — CONFIRMED (§3.3, Table 1; K = 10 for final validation).
- no transfer — CONFIRMED (Conclusion: "explore whether evolved constitutions transfer across environments" as future work).
- no adversarial tests — PARTLY: has a Zero-Sum adversarial constitution baseline (S = 0) and sabotage actions; no test of an evolved constitution against a saboteur/injected agent. Fixed wording.
- no topology baselines / not manager-led task solving — CONFIRMED.
Meta-Harness 2603.28052
- single-agent harness (not multi-agent) — CONFIRMED (single-file Python harnesses, §3; no multi-agent setting).
- one proposer (Claude Code, Opus 4.6), flagged by authors — CONFIRMED (§3 impl.; Discussion: "one particularly strong coding-agent proposer").
- proposer-information ablation in one domain only — CONFIRMED (Table 3, online text classification only).
- scores-only 34.6/41.3, summary 34.9/38.7, full 50.0/56.7 — CONFIRMED.
- no parent-selection rule, Pareto frontier — CONFIRMED (§3).
- seed count behind medians not stated — not contradicted (Table 3 reports run counts > zero-shot: 26/23/39).
AHE 2604.25850 (role: enforced vs prompted evidence)
- system-prompt-only −2.3 (67.4), middleware finish-hook +2.2 (71.9), memory 75.3, tool 73.0 — CONFIRMED (Table 3, §4.4.1). Note tool and memory gain more than middleware; the "enforced beats prompted" reading is an interpretation.
- "single-agent" — PARTLY (seed single-agent; sub-agents editable). Fixed.
Rethinking 2607.12227: matched TTS beats harness evolution; held-out +0.6 avg; "escalates to runtime enforcement through middleware" — CONFIRMED (Tables 1, 3; §5.1).

#### Unresolved
- Who&When "spotlight" not checked against ICML listing (PDF does not say).
- Meta-Harness: number of seeds per condition in Table 3 not found.
- 2609.02889 (HarnessEvo, "also seen") has Kestrel date 2026-06-25 despite a 2609 id — record oddity, not used.


### Theme 04-multi-agent-safety
#### Counts
- arXiv ids checked: 40 (all ids in README.md, incl. 12 in refs.bib) via Kestrel get_papers — 40/40 resolve, 0 missing; titles / first authors / years in README and refs.bib match the records. Venues checked against PDF headers: AgentBreeder = NeurIPS 2025, MaMa = ICML 2026 PMLR 306, Huang = ICML 2025 PMLR 267 — all correct.
- [abs] numbers checked: ~30 tagged numbers (+7 qualitative [abs] claims, +8 untagged numbers in "Also considered" and the cross-reference) — all found in Kestrel abstracts. Two tagging errors (numbers tagged [abs] that are only in the full text) fixed.
- [full] numbers checked: ~74 (AgentBreeder 17, MaMa 22, SHE 13, Misevolve 7, ORBIT 7, Prompt Infection 7, Async Control 1) — all found in PDF text. METR report (not arXiv): 6 numbers checked against the live report page (1200 agents, >70,000 messages, 700 attackers, ~7% spoofed, ~10% assignments, board re-created ~2 days after the 6 July Artifactory reset) — all match.
- PDFs checked: 12/12 real PDFs (pdfinfo page counts 6–66) and first-page titles match the named paper.

#### Fixes (README.md)
1. Opening paragraph: "what is optimized is the agent graph, roles and prompts (AgentBreeder, MaMa, ResMAS)" → adds "per-task scaffold code" and "MaMa's design space also lets the Meta-Agent write Python tools such as approval and voting and a Python speaker-selection function".
2. Opening paragraph: "none checks whether such rules transfer across domains" → "across task domains (MaMa and SHE test transfer only to other models, attack types or a held-out safety benchmark)".
3. AgentBreeder key numbers: "79.4% … 110.7% maximum … [abs][full]" → "79.4% … [abs]; 110.7% maximum [full, §5.1]" (110.7% is not in the abstract).
4. MaMa summary: added that a design includes Python code — new tools "that implement safety features, such as approval, voting" plus a scratchpad, and a Python `selector_fn` choosing the next speaker [full, App. B.4].
5. MaMa "Relation to Decorum": replaced "these live in agents' system messages and in the graph (prompt-level and topological) … optimized for safety rather than task success at a fixed budget" with the verified description (prompts + graph + optional Python tools/selector; objective = clean quality + η·safety, η=1, 50-action budget; attacker overwrites ε agents, cannot change G or T) and restated Decorum's differentiators as: typed domain-agnostic rulebook on a dynamically spawning manager; enforced-vs-prompted comparison; cross-domain transfer; fitness = task success alone.
6. SHE key numbers: "[abs][full, Table 1]" → "[full, Table 1; the abstract gives only the 3.1×]" (8.6→5.5, 17.1→5.5, 33.5→47.6 are in the intro/Table 1, not the abstract).
No changes to refs.bib or PDFs were needed.

#### Closest-work claims
| Paper | Claim in README | Status | Evidence |
|---|---|---|---|
| AgentBreeder 2502.00757 | Evolved object is arbitrary Python scaffold code, not a rulebook | confirmed | §4: Meta Agent writes `forward()` scaffolds; mutation operators are hand-written text |
| AgentBreeder | Safety = refusing harmful user prompts (SaladData), no agent compromised, single-turn QA | confirmed | §4.4: 100 attack-enhanced prompts judged against the Claude constitution; capability DROP/MMLU/GPQA |
| AgentBreeder | No long-horizon agentic coding, no cross-domain transfer | confirmed | benchmarks are DROP/MMLU/GPQA/SaladData/TruthfulQA only |
| AgentBreeder | Red mode: capability search drifts to unsafe; blue reward hacking via refusals | confirmed | §5.2 "Unsafe Scaffolds are Easier to Find"; §5.1 95.2±2.4 safety, −43% helpfulness |
| MaMa 2602.04431 | Rules live in system messages and graph (prompt-level and topological) | **wrong as written → fixed** | App. B.4 Meta-Agent prompt: "Tools: Python functions that … implement safety features, such as approval, voting"; scratchpad "to implement variables, such as approvals of actions or votes"; Python `selector_fn` picks next speaker |
| MaMa | Optimized for safety rather than task success at a fixed budget | **wrong → fixed** | §3.3 objective max E[q(τβ) + η s(τα)], η=1 (§4.2); 50 tool executions/messages per episode |
| MaMa | Designed per environment | confirmed | Fig. 4 "best discovered system for each environment" |
| MaMa | Attacker overwrites agents in a fixed graph; cannot touch tools/graph | confirmed | §3.2 dist = ∞ if G or T differ; §6 future work: "adversaries that are able to manipulate … tools or communication graphs" |
| MaMa | No enforced-vs-prompted comparison | confirmed (no such ablation in paper) | baselines are LPTG+TF, Guardian Agents, quality-only MaMa |
| MaMa | No cross-domain transfer | confirmed | §5.3 transfer = other LLMs, more adversaries, targeted attack, indirect tool injection |
| MaMa | Discovered rules include propose/approve chains, reviewers, mutual monitoring, a "Governor" | confirmed | §5.4 "at least three agents must be involved … a third agent approves"; Fig. 4 shows "Governor" |
| SHE 2608.09885 | Single agent | confirmed | base "tool-using agent" DeepSeek-V3.2 throughout |
| SHE | Rule Bank and Tool Policy are enforced (allow/warn/block/sanitize/judge); System Prompt and Safety Memory are text | confirmed | §3.3 |
| SHE | Keep edit only if safety rises and utility does not fall; validity check vs reward hacking | confirmed | Eq. 7, Eq. 9 |
| SHE | 20 rounds, 15 tasks, GPT-5.5 evolution model | confirmed | §4.1 / App.: "20 evolution rounds over 15 fixed Agent-SafetyBench" tasks |
| SHE | No explicit limitations section | confirmed | no "Limitation" string in PDF text |

#### Unresolved / notes
- None blocking. "Also considered" one-liners spot-checked against abstracts (AgentDojo, AgentMonitor, Ev-Trust, BAD-ACTS, BashArena, Architecture Matters): all consistent.
- METR report numbers verified against the web page, not a PDF (report is not on arXiv).


### Theme 05-benchmarks-and-harnesses
#### Counts
- arXiv ids checked: 25 (12 kept + 11 "considered" + 2 cited in tables: 2506.12286, 2609.08149 among them; 2607.26070). 23 resolved via Kestrel get_papers; 2 pre-2023 ids (2108.00573 MuSiQue, 1809.09600 HotpotQA) resolved via the arXiv API. All titles/first authors/years in README and refs.bib match. 3 web-only bib entries (OpenAI x2, Anthropic) not checkable by id.
- [abs] numbers checked: 16 distinct (about 20 occurrences). 15 found in the Kestrel abstract; 1 not (SWE-bench Pro "<45%"), retagged.
- [full] numbers checked: about 50 (OpenCollab 14, Tran & Kiela 6, SWE-bench Pro 7, SWE-rebench 5, BrowseComp-Plus 10, DeepSWE 6, LoHoSearch 2, BrowseComp 6, FRAMES 5, SWE-bench-Live 6, Terminal-Bench 2). All matched, apart from the understatement fixed below.
- PDFs checked: 12/12 real PDFs (pdfinfo page counts 11–84). The first-page title matches the paper each is named for, including 2026-hsu-opencollab.pdf = 2609.38345 and 2026-tran-single-agent-outperforms-mas.pdf = 2604.02460.

#### Fixes (all in 05-benchmarks-and-harnesses/README.md)
1. SWE-bench Pro: "Best result is below 45% Pass@1 under a unified scaffold [abs]." → "[full: abstract of PDF v2; absent from the arXiv/Kestrel metadata abstract]". The number appears in the PDF v2 abstract (line 30), not in the metadata abstract.
2. Tran & Kiela: "At budgets of 1,000 tokens and above, SAS is best or within CI" → "At every budget except the lowest (100 tokens), i.e. 500 tokens and above … [full: §5.1]". The paper says "for all budgets except the lowest one (100 tokens)".
3. OpenCollab, Relation: "it shows that prompt-only organisation is often not realised" → "it shows that a declared organisation is often not realised unless delegation is forced".
4. OpenCollab, the bullet "rules cover permissions and edges, not task-lifecycle norms such as closing with evidence, review…": rewritten. The Duo workflow does contain a code-applied selection step with a read-only Adjudicator that compares the candidates' evidence, so "no review" was partly wrong.
5. OpenCollab: added "Validation note" with three full-text caveats (see claims below).
- refs.bib: no changes needed.

#### Priority claims
- OpenCollab: the runtime enforces roles/tools, topology and per-role token caps. **Confirmed.** Tool/message outside the declaration is "refused and recorded" (§3, App. C, lines 309–311, 1661, 1846). Pre-call admission is refused if the call would exceed the per-role token ceiling.
- "Adherence as low as 47.2% for prompt-only orgs": **partly.** 47.2% is right [abs + Tab. 3]. But the 47.2% reference team is NOT prompt-only: its edges, tools and budgets are gated. It is low because the open prompt card and full tools let the lead solve alone. The constraint that maximises Adherence (read-only lead, 94.4%) drops Pass@1 to 52.8% vs 69.4% single. The open-card team (47.2%) has the highest Pass@1, 75.0%. n = 36 SWE-bench Pro tasks.
- Duo +14.2 on DeepSWE at 26.1M vs 12.0M tokens: **confirmed.** 69.91 vs 55.75; 26.11M vs 11.95M avg tokens/task; Tab. 2. Caveat: Duo is two independent coders plus a code-applied selection (best-of-two with adjudicator), not interacting agents. It is not budget-matched.
- Nothing evolves: **confirmed.** No optimisation or evolution of organisations anywhere; configurations are hand-declared.
- No adversaries: **confirmed.** No saboteur or injection experiments.
- No cross-domain transfer: **confirmed.** Coding only: SWE-bench Pro, TB 2.1, DeepSWE.
- Audit of 10 frameworks, none both holding factors constant and verifying the realised organisation; Claude Code × on Context: **confirmed** (Tab. 1).
- Limitations (one shared lock, 3 models, one workflow): **confirmed** (App., lines 1523–1528).
- Tran & Kiela: single agent matches or beats MAS at equal thinking budget on FRAMES/MuSiQue: **confirmed.** It holds for all budgets ≥500; average at 5k is 0.427 vs Seq 0.386; 5 MAS architectures; 4 models. Closed-book is confirmed: a single direct pass with the question only, no retrieval.
- "Tool-using MAS out of scope": **confirmed.** App. C: "MAS advantages with tools/vision or safety constraints are out of scope."
- MAS wins under heavy masking/substitution (α=0.7): **confirmed** (§5.3; Qwen3-30B, MuSiQue, 1k budget only).

#### Benchmark-size facts
- SWE-rebench 21,336 tasks / 3,468 repos: **confirmed** [full, line 107]. The abstract says only ">21,000".
- BrowseComp-Plus 830 queries / 100,195 docs: **confirmed** [full]. 830 of 1,005 passed human verification; 6.1 evidence, 2.9 gold and 76.28 negatives per query.
- SWE-bench Pro 731 public / 11 repos: **confirmed.** 731 [full]; 11 repos [abs]. Held-out 858 / 12 repos; commercial 276 / 18 repos.
- DeepSWE 113 tasks / 91 repos: **confirmed** [abs]. 75 of 91 repos contribute one task [full].

#### Unresolved
- BrowseComp-Plus judge (gpt-4.1) validation against humans: not found in the paper (the README already says so).
- [web] numbers (leaderboards, OpenAI audit via Decrypt, LightOn blog, harness docs) were not re-checked; out of scope for the id/PDF checks.
- FRAMES year: the table says 2024 (arXiv) and the bib says 2025 (NAACL). Consistent with the convention; left as is.


### Theme 06-runtime-enforcement
#### Counts
- arXiv ids checked: 24 (12 kept papers + 12 "considered/novelty" ids), all resolve in Kestrel; titles, first authors, years in README and refs.bib match. AgentSpec DOI 10.1145/3744916.3764546 and pages 2938–2950 confirmed via Crossref (ICSE 2026).
- `4916.37645` is NOT an arXiv id: it is a regex artifact of the AgentSpec DOI (10.1145/374**4916.3764**546). No fix needed.
- "Abdullah X" is the real author string of 2608.09828 (Kestrel, arXiv API, PDF page 1). The bib key `x2026multi` and PDF name `2026-x-...` are correct by the naming rule.
- PDFs checked: 12/12 are real PDFs and their first pages match the paper. One note: the ContextCov PDF (v2) prints the title "ContextCov: Bridging the Gap Between Developer Intent and Autonomous Agent Execution"; the arXiv metadata title is "...Deriving and Enforcing Executable Constraints from Agent Instruction Files". The bib uses the arXiv title, which is correct. No re-download.
- [abs] numbers: 27 tagged items (~50 individual numbers) checked against the Kestrel abstracts. All are present, except one attribution (OCL, below).
- [full] numbers: 22 tagged items checked against pdftotext. POLIS Tables 4–5, 6.46 pp, 20.8%, 63.5/95.8/100%, 40.3/13.9/25.0%. Institutional AI Table 6 (3.10/3.02/1.82, p = 4.67e-15, 50.0/44.4/5.6%), 303/427/12 and GPT-5 Mini. XFlow Tables 2–3. OCL Table 2 and intercepts 94/82/60%. Recuse 0/20 vs 20/20. ContextCov Table 3 (57.3/53.0/52.3, p = 0.031). Gamage STD 10.6 / 7.1 and 3 of 4. The Agent-C "explicitly given in the system prompt" quote. All correct.

#### Fixes (06-runtime-enforcement/README.md)
1. Opening paragraph: "And no one has optimised the enforced rule set automatically… The closest is 2601.11369, which hand-screened its governance manifest's parameters. Every system in this group hand-authors its rules (AgentSpec, Agent-C, XFlow, OCL, OBPE) or compiles them… and evaluates single-agent or two-party settings." becomes a version that:
   - is scoped to "among the papers found for this theme";
   - describes 2601.11369 as selecting parameters by a "staged screening sweep and factorial ablation against collusion outcomes, then froze them";
   - says AgentSpec "generates [rules] once with an LLM and scores them against risk labels, not task success" (the old text said AgentSpec hand-authors, which contradicts its own §11);
   - adds that in 2609.22600 the governed agents author and vote on executable rules, with no outer-loop optimizer;
   - says "Most evaluate…".
2. OCL key numbers: "[abs]" becomes "[abs; abstract says 'across multiple frontier LLM backends', but Table 1 shows these are the main GPT-5.4 run]". The attribution to GPT-5.4 comes from the full text.
3. XFlow Limitation: "The baseline is a bare agent, not the same rules given as a prompt" becomes "bare ReAct / mini-SWE-agent (Table 2 caption); on τ³-bench that baseline presumably sees the benchmark's NL domain policy (τ-bench convention; paper does not say), but nothing matches its information to the XFlow protocol". The old claim that the baseline had no rules in its prompt is likely wrong for τ-bench.

refs.bib: no changes.

#### Unresolved
- The venue "EMNLP 2026 Findings" for 2604.09443 and "ICML 2026 workshop" for 2607.09766 were not verified (they are in the not-kept list only).
- Whether the τ³-bench ReAct baseline in XFlow receives the domain policy is not stated in the paper.

#### Closest-work claims
- **POLIS 2608.09828**
  - "Only the planner is an LLM; delegation is terminal": CONFIRMED. p. ~4: "successful delegation to a capable specialist is terminal… only Agent A generates model actions"; Fig. 1 caption.
  - "≤6 actions, temperature 0, four model families": CONFIRMED (l.117, l.203, §2.3).
  - "No adversarial agents": CONFIRMED. Pressure and laundering scenarios exist, but there is no saboteur or injected agent; the paper excludes "open-ended dialogue, coalitions… long-horizon social emergence".
  - "Prompt and guard arms differ in information as well as mechanism (authors admit)": CONFIRMED. "differ in both information and enforcement architecture… cannot isolate language versus code".
  - "Constitutional prompt matched provenance guard at 0/384; local guard 22/384": CONFIRMED (Table 4).
- **Institutional AI 2601.11369**
  - "Competitive Cournot duopoly, no explicit communication channel": CONFIRMED (§6 "no direct inter-agent communication"; §9 lists explicit communication as further work).
  - "Prompt-only constitution arm; enforced manifest via Oracle/Controller": CONFIRMED (abstract, Table 2).
  - "Sanction-based rather than regimentation": CONFIRMED. "operates through incentive gradients rather than action rewriting" (§8).
  - "Not optimised automatically; hand-screened": PARTLY. There was a staged screening sweep over a small candidate set, then a factorial ablation selecting for reduced severe collusion, then a lock. That is a manual selection over candidates, not an automated optimizer. The proposal should not say "hand-written with no search".
  - "Authors list meta-governance as future work": CONFIRMED in substance. §8 names "meta-governance rules for safe institutional updates" on the research agenda.
- **XFlow 2606.14790**
  - "Protocols hand-authored per workflow": CONFIRMED (limitations: authors must decompose workflows, and the future work is authoring tooling).
  - "Baseline is a bare agent, not the same rules as a prompt": PARTLY. The baseline is a bare ReAct agent, but on τ³-bench it likely sees the domain policy. Fixed.
  - "Most experiments wrap one agent": CONFIRMED (ReAct, XpandA and mini-SWE-agent baselines).
  - "Enforcement does not cost task success": CONFIRMED. pass^1 changes by −2.3 to +0.8 pp (Qwen), and SWE-bench Verified goes 77.4 → 79.8.
- **OCL 2606.04306**: the six-arm ablation is CONFIRMED (prompt-policy 98% violations / 2% valid; block-only 0% / 60–62%; full 0% / 94%). It covers a single bilateral negotiation with the seller governed: CONFIRMED.
- **Group claim "Every system hand-authors its rules"**: WRONG as written for AgentSpec, which also generates rules with o1. Fixed.


### Theme 07-human-in-the-loop
#### Counts
- arXiv ids: 23 unique (README + refs.bib) checked via Kestrel get_papers; all resolve; titles / first authors / years match. refs.bib (10 entries) matches; venues confirmed from PDF headers (HILA ICLR 2026, Co-Gym ICLR 2026, Ambig-SWE ICLR 2026, Sim2Real COLM 2026) and ACL Anthology (ReHAC Findings EMNLP 2024, pp. 1336–1357).
- PDFs: 10/10 real PDFs (`file`), page-1 titles match.
- [abs] numbers: 20 checked (Calibration 0.506→0.110; Ask Early 10%, 0.78, ~50%, 84 variants, 6,000+, τ 0.78–0.87, 300 sessions, 52%; Ambig-SWE 74%; Sim2Real 451/165/31; Co-Gym 86/74/66, 65/40; MINT 2–17%; CONVOLVE 26.7→57.4; AgentRadio 62.1 vs 32.3; 2603.26233 69.4%; 2510.05307 −13.54%) — all in the Kestrel abstracts.
- [full] numbers: ~35 checked against pdftotext (Magentic-UI 30.3/51.9/10%/1.1/18%/42.6/4.3%/1.7/6%/162 tasks/24 scenarios; HiL-Bench 75–89/4–24, 38/12, 40.5/37.4, 1131 blockers, 3.8; Sim2Real 63.6/77.8; Calibration 0.245→0.169, ECE 0.463→0.006, regret 0.318; Turan κ=0.52, AURC 0.374±0.002, Table 2 64/64/72, 56/42/22 vs 69/57/39; ReHAC λ=0.06 ~30% more / λ=0.1 ~20% fewer interventions, GPT-4-trained beats human-trained at λ=0.06/0.08, 14 annotators; HILA 3.7–15.4 pts on Llama3-8B, Table 5 DEFER shares). All correct after fixes below.

#### Fixes
1. README.md, ReHAC key numbers: source tag "[ACL Anthology abstract, via web; not in the arXiv abstract]" → "[full: Findings-EMNLP camera-ready PDF, §1. Not in the arXiv v1 PDF or in either abstract; ...]". The Anthology abstract does not contain 25.8%; the camera-ready PDF body does (§1, "average 25.8% relative improvement over baselines on the HotpotQA dataset").
2. (Fixed by the writer during validation, verified): HILA DEFER shares. An earlier README version had "28% → 17%, 24% → 12%, 21% → 5%" (mixing CREATE values); current text "29% → 17% (GSM8K), 24% → 12% (AMC), 19% → 5% (MMLU)" matches Table 5 exactly.

#### Closest-work / priority claims
- ReHAC 2402.12914 — CONFIRMED. Policy = LLaMA-2 7B/13B, REINFORCE, reward T − λ·C; agent gpt-3.5-turbo (ReAct); HotpotQA/StrategyQA/InterCode; GPT-4 substitutes the human in later experiments, validated only by consistency of relative method ranking (Fig. 2a vs 2b, "relative performance of various methods is generally consistent"). 14 annotators allowed to reference GPT-4 answers (App.). 25.8% relative improvement: confirmed in camera-ready (tag fixed).
- HILA 2603.07972 — CONFIRMED. ICLR 2026 header; +3.7 to 15.4 absolute over strongest autonomous baseline on Llama3-8B (§4); baselines include DyLAN, GPTSwarm, AFlow; GPT-4o-mini as proxy expert in most experiments; real-human study = 20 PhD students, "offline expert collection protocol: each human expert answers the selected questions in advance" on GSM8K/AMC/MMLU; DEFER "adopts the authoritative solution" (replaces output). Per-agent policy in weights (GRPO + SFT) — confirmed.
- Magentic-UI 2507.22358 — CONFIRMED. 30.3%→51.9% (+71%), help in 10% of tasks (1.1×), simulated user gives final answer in 18%; o4-mini user 42.6% / 4.3% / 1.7×; GPT-4o user with GAIA human-written plan as side info; leakage "in all but 6% of tasks"; 162 GAIA validation tasks; action guard always/maybe/never irreversibility heuristic set by developer, "maybe" → ActionGuard LLM judge; default config: no adversarial scenario succeeded (24 internal); mitigations disabled in code → prompt injection exfiltrated SSH keys and created a persistent GitHub API key.
- Sim2Real 2603.11245 — CONFIRMED. Human baseline 63.6%, top simulators up to 77.8% (§5); 451 participants / 165 tasks / 31 simulators.
- HiL-Bench 2604.09408 — CONFIRMED. 300 tasks (150 SWE / 150 SQL), 1131 blockers (3.8/task), Llama-3.3-70B frozen judge returning "irrelevant question"; 75–89% vs 4–24% (Fig. 1); 38% SQL / 12% SWE best; Ask-F1 40.5 / 37.4.
- Turan 2606.08919 — CAVEAT CONFIRMED. "Three reviewer personas ... These are LLM personas, a proxy for human annotators" (§5.2); inverted-U and flooding attack are explicitly "modeling results that motivate a human study" (abstract).
- Theme novelty claim (no paper evolves the escalation rule as an editable, harness-enforced rule in a MAS; none measures recovery per intervention under attack) — scoped to the papers in this theme and consistent with what was read; not independently exhaustively searched beyond the parent's coverage searches.

#### Unresolved
- None blocking. ReHAC's arXiv v1 lacks the 25.8% figure; cite the Findings version if used.
