# Decorum

**Evolving the rules, not the graph, of multi-agent collaboration.**
Course project for MAS.S62 Self-Evolving AI (Fall 2026): Anthony Baez, Max Holschneider, Tawab Safi.

Coding agents such as Claude Code and Codex now work as teams: a main agent spawns subagents, delegates and merges their work. Prior work automates the design of such teams by searching over *who talks to whom* (graphs, workflows, rosters). Decorum evolves *how agents talk* instead:

- **Forum.** The main agent manages threads (the full discussion of one task) and tasks (assign, accept, close with evidence). Several subagents may share a thread, and a successor inherits it. The topology emerges at runtime.
- **Rulebook.** A YAML file of typed primitives: visibility, handoff, closing, review, dissent, escalation and budget. The harness enforces them through tools and hooks. A free-text `norms:` field is prompt-only.
- **Outer loop.** A reflective optimizer reads scores, threads and traces, attributes failures to rules, and edits the rulebook.
- **Questions.** Does an evolved rulebook beat hand-designed topologies at equal budget (E1)? Does it resist a saboteur or a prompt-injected subagent, and is enforcement what protects it (E2)? Does it transfer from coding to multi-hop research (E3)? What does the optimizer need to read (E4)?

## Repository layout

| Path | What |
|---|---|
| [`docs/proposal/`](docs/proposal/) | Project proposal: NeurIPS 2026 style LaTeX (`main.tex`, `figure.tex`, `references.bib`) and the compiled `main.pdf` |
| [`docs/literature_review/`](docs/literature_review/) | Literature review in 7 themes, with notes, BibTeX and PDFs per theme, a merged `references.bib`, and `VALIDATION.md` |

There is no implementation yet. The harness will be built on the Pi coding agent, with the Claude Agent SDK as the fallback.

## Building the proposal

```bash
cd docs/proposal
tectonic -X compile main.tex   # or: latexmk -pdf main.tex
```

The PDFs under `docs/literature_review/` are arXiv preprints, kept for the team's reading. If this repository is made public, replace them with links.
