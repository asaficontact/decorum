# Decorum: literature review

Decorum's claim: in a manager-led multi-agent harness, *evolving an enforced, domain-agnostic rulebook of interaction rules* beats hand-designed communication topologies at equal model and token budget. It should solve more tasks, be more robust to bad actors, and transfer better across domains. The review is organised by the question each part of that claim raises:
- What has been searched over instead of rules (01)?
- Which coordination rules and norms exist and which have been evolved (02)?
- Which reflective optimisers could drive the outer loop (03)?
- How multi-agent systems fail under saboteurs and injection (04)?
- Which benchmarks and harnesses to run on (05)?
- Whether enforcing a rule in the harness differs from stating it in the prompt (06)?
- How a human fits in as an escalation target (07)?

Each theme directory holds a `README.md` with:
- a framing paragraph;
- a summary table;
- one section per paper, with key numbers tagged by source: [abs] from the abstract, [full] from the full text, [unverified] where no source could be traced;
- "Relation to Decorum" and "Limitation" notes;
- a `refs.bib` and the PDFs.

All themes were checked by an independent validation pass (see [`VALIDATION.md`](VALIDATION.md)): identities, PDFs, [abs] numbers, spot-checked [full] numbers, and the closest-work claims read against the full text. Papers that the validation pass's searches found were added under "Added by validation" in the most fitting theme. [`references.bib`](references.bib) merges all theme bibliographies with unique keys.

## Themes

| Dir | Title | # papers | One-line summary |
|---|---|---|---|
| [01-topology-and-workflow-search](01-topology-and-workflow-search/) | Searching over multi-agent topologies and workflows | 12 + 1 added | Automated search over graphs, workflow code, architecture distributions and runtime orchestration produces a topology or program per task or query. Only Meta-Team evolves coordination rules, and only as prompt text. Searched topologies transfer poorly. |
| [02-coordination-protocols-and-norms](02-coordination-protocols-and-norms/) | Coordination substrates, protocols and enforced norms | 17 rows (13 arXiv) + 5 added | How multi-agent LLM systems structure their talk (SOPs, ledgers, protocols, governance graphs), plus the 2026 cluster that evolves natural-language constitutions in toy social games. Failure evidence (MAST, HiddenBench) motivates explicit rules. |
| [03-reflective-optimization](03-reflective-optimization/) | Reflective optimization of agent systems from execution traces | 12 + 1 added | LLM optimisers read scores and traces to edit prompts, programs, harnesses or team constitutions. In the one controlled ablation (Meta-Harness), raw traces beat scores. Evolved rules stay prompt text, adversaries are untested, and harness evolution often fails matched test-time-scaling and held-out checks. |
| [04-multi-agent-safety](04-multi-agent-safety/) | Safety and robustness of multi-agent systems under bad actors | 13 (12 arXiv + METR report) | Faulty, sabotaging or injected members; evolution vs safety (AgentBreeder, Misevolve, MaMa, SHE); structural defenses; contagion; sabotage monitoring. Defenses are hand-designed or optimised graphs, prompts or code, never a transferable enforced rulebook. |
| [05-benchmarks-and-harnesses](05-benchmarks-and-harnesses/) | Benchmark candidates and agent harnesses | 12 | Coding benchmarks (SWE-rebench recommended, DeepSWE as stress test) and deep-research transfer benchmarks (BrowseComp-Plus recommended), plus a hook-level survey of harnesses. Two papers bound the claim: OpenCollab (runtime enforcement + Adherence) and Tran & Kiela (single agent ≥ MAS at equal budget). |
| [06-runtime-enforcement](06-runtime-enforcement/) | Enforcing rules in the harness vs. stating them in the prompt | 12 + 2 added | Monitors, DSLs, proxies and governance interpreters against prompt-stated rules. Enforcement usually wins on compliance, with task success held or raised, but a strong prompt can match it on short horizons (POLIS). |
| [07-human-in-the-loop](07-human-in-the-loop/) | Humans in the loop of agent teams: when to escalate, and what it buys | 10 | Escalation to a human is either hand-written guards (Magentic-UI) or a policy trained with RL (ReHAC, HILA). Simulated humans inflate success (Sim2Real: 63.6% real vs up to 77.8% simulated). No paper evolves an enforced escalation rule or tests one under attack. |

## Closest prior work to Decorum

Only claims confirmed against the full text in validation are listed. "Decorum adds" names what the cited paper does *not* do.

| Paper | Theme | What it does | What Decorum adds (confirmed) |
|---|---|---|---|
| **Meta-Team** 2605.29790 | 01, 03 | Evolves a team constitution, profiles and roster of an open-roster multi-agent system by team self-reflection. Compared with hand-crafted multi-agent systems under shared per-case limits. | Rules enforced by tools/hooks (Meta-Team's constitution is "the global prompt"); an outer optimiser rather than team self-reflection; saboteur and prompt-injected subagents (none in Meta-Team); cross-*domain* transfer, coding → research (Meta-Team tests only within-benchmark shifts: Python → C/C++/Java, 96K → 8K–256K context). |
| **Constitutional Evolution** 2602.00755 | 02, 03 | Evolves a prompt-level rule list for 6 agents in a 6×6 grid-world survival game. | Enforced typed primitives; real task solving in a manager-led harness; topology baselines (it compares constitutions only); a saboteur inside a cooperating team (its "zero-sum" arm is a constitution given to all agents); transfer (its stated future work); an optimiser-input ablation. |
| **Internal vs External** 2605.09128 | 02 | Deliberation vs evolution of prompt-only constitutions in toy multi-agent games, one backbone. | Domain transfer of an enforced rulebook. They show an evolved constitution flips from best to worst under a one-parameter incentive shift, which is a warning for E3. |
| **Swarm Skills** 2605.10052 | 02 | A portable, self-evolving multi-agent specification for a lead agent that spawns teammates (Claude-Code-compatible). | Enforcement (the Leader only reads the spec) and a quantitative evaluation (none reported). **Not** a differentiator: a manager-led, task-solving harness. |
| **Institutional AI** 2601.11369 | 02, 06 | An enforced governance manifest against a prompt-only constitution in a competitive two-firm Cournot market without communication. Sanctions, not blocking; parameters chosen by a manual screening sweep and factorial ablation, then frozen. | Cooperative task solving in a manager-led harness; regimentation by tools; an automated optimiser over the rulebook against task success. |
| **POLIS** 2608.09828 | 02, 06 | Prompted vs executable institutions in delegation. Only the planner is an LLM; delegation is terminal; at most 6 actions; no adversaries. A strong constitutional prompt ties enforcement (0/384 vs 0/384); enforcement wins only in "laundering" cases (22/96 local guard vs 0/96 provenance). | Long-horizon threads with several LLM agents, saboteur and injected subagents, and an information-matched prompted vs enforced ablation. |
| **MaMa** 2602.04431 | 04 | Co-designs per-environment agent systems (prompts, graph, *optional Python approval/voting tools*, speaker selector) against an agent-overwriting adversary. Fitness is quality + safety under a 50-action cap. | One domain-agnostic typed rulebook for a manager that spawns subagents dynamically; a controlled enforced vs prompted comparison; transfer across task domains (MaMa transfers only across models, adversary counts and attack types); task-success-only fitness with safety tested at test time. |
| **AgentBreeder** 2502.00757 | 03, 04 | Evolves Python scaffolds for QA capability and jailbreak refusal (NeurIPS 2025). | A domain-agnostic rulebook on long-horizon coding, tested against compromised agents inside the system and across domains. |
| **SHE** 2608.09885 | 04 | Reflective evolution of a *single agent's* safety harness, including an enforced rule bank and tool policy (allow, warn, block, sanitize, judge). | Rules *between* agents (visibility, handoff, review, dissent, escalation), evolved for task success. |
| **Meta-Harness** 2603.28052 | 03 | A trace-reading proposer with filesystem access that evolves single-agent harness code. Raw traces beat scores in its one-domain ablation. | The scores / +threads / +traces ablation (E4) applied to a multi-agent rulebook, in more than one domain. |
| **OpenCollab** 2609.38345 | 05 | The runtime enforces declared roles, tools, message edges and per-role token caps, and measures Adherence. | Evolved (not hand-declared) rules; adversarial agents; cross-domain transfer; lifecycle primitives (close-with-evidence, dissent, escalation). |
| **MANTA** 2607.28527 | 01 | Per-task topology planning; information visibility enforced in code; cross-run memory. | One cross-task rulebook over a free manager; enforcement of handoff, closing and review, not only visibility; adversaries. |
| **AOrchestra** 2602.03786 | 01 | Same main-agent-spawns-subagents shape; optimises the orchestrator prompt from traces and cost. Its actions are fixed to Delegate/Finish in code. | Optimised, enforced interaction rules with shared threads, successor inheritance, review and dissent. |
| **SECP** 2602.02170 *(added by validation)* | 02 | Governed self-modification of a coordination protocol under fixed formal invariants. One modification, 2 → 3 accepted proposals; no learning claimed. | An optimiser over task-solving runs with a real evaluation; the idea of governed, evolvable coordination rules was floated there. |
| **HILA** 2603.07972 | 07 | A learned metacognitive policy decides when a multi-agent system defers to a (simulated, GPT-4o-mini) expert; ICLR 2026, +3.7–15.4 pts on Llama3-8B. On DEFER, the expert's solution replaces the system's output. | A team-level, enforced, evolved escalation rule; the human joins a thread rather than replacing the output; tests under attack. |
| **ReHAC** 2402.12914 | 07 | An RL-trained (REINFORCE) policy decides when a single ReAct agent asks a human; reward = task − λ·interventions; GPT-4 stands in for the human. | An evolved, readable escalation rule inside a multi-agent harness with a hard budget. |
| **Magentic-UI** 2507.22358 | 07 | Human-in-the-loop agentic system with code-enforced action guards (developer-set irreversibility tags); 30.3% → 51.9% task completion with a simulated user. | An escalation trigger that is evolved rather than set by hand. |

### What the proposal must not claim

These were found wrong or unsupported in validation:
- That no prior work evolves interaction rules or coordination specifications. Constitutional Evolution, Internal vs External, Meta-Team, Swarm Skills (in a manager-led harness) and SECP all do. Decorum's novelty is the combination: an *enforced*, typed, domain-agnostic rulebook, evolved by an outer optimiser for task success, tested against in-team adversaries and across task domains.
- That Meta-Team's or MaMa's rules are *all* prompt-only:
  - Meta-Team's evolved constitution is prompt text, but its runtime commands are fixed code.
  - MaMa's designer can write Python approval/voting tools.
  - Do not claim "no prior work evolves code-enforced coordination mechanisms against adversaries" (MaMa).
- That prior work lacks equal-budget comparisons with hand-designed multi-agent systems (Meta-Team has them), or that Meta-Team has no out-of-distribution evaluation (it has within-benchmark shifts). Defensible: "no communication-topology search baseline (G-Designer/MaAS style) and no cross-domain transfer".
- That "enforced beats prompted" is a new finding or always holds. Institutional AI already shows it in a market. POLIS shows a tie on its main suite. OpenCollab's highest-Adherence variant lost to a single agent.
- Novelty for enforcing topology, permissions or budgets in the harness (OpenCollab, MANTA, XFlow).
- That Institutional AI did no search over its rules (it ran a manual screening sweep).
- That Tran & Kiela covers tool-using multi-agent systems (it is closed-book and text-only; tool use is out of scope).
- That MoMHa's trace vs scalar gap is real or "within noise" (no variance reported), or that AHE is strictly single-agent.
- That enforced escalation to a human is new (Magentic-UI enforces it), or that learned escalation in multi-agent systems is new (HILA, ReHAC). Also that simulated-human results are unbiased estimates of real recovery (Sim2Real), or that Turan 2606.08919's oversight-fatigue result comes from humans (its reviewers are LLM personas).
