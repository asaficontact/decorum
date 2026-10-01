# Project proposal

- `main.tex`: the proposal (NeurIPS 2026 style, `[preprint]` option with a course footer). At most 4 pages of content, plus references.
- `figure.tex`: Figure 1 (TikZ), included by `main.tex`.
- `references.bib`: a copy of `../literature_review/references.bib` (merged and validated).
- `neurips_2026.sty`: the official NeurIPS 2026 style file.
- `main.pdf`: the compiled proposal.

Build with `tectonic -X compile main.tex`, or `latexmk -pdf main.tex`. On Overleaf, upload all files in this directory and set `main.tex` as the main document.

Before submitting, fill in the idea leads (`[lead TBD]`).
