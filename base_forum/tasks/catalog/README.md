# Task catalogues

What the viewer's New run page chooses from: every task of DeepSWE v1.1 and SWE-bench Pro V2, with its title,
repository, language, categories, and how often published attempts solved it (`solve`), cut into quartiles
(`band`: easy, medium, hard, very hard). Built by `scripts/build_catalog.py`, which fetches the public sources named
in its docstring; rebuild it when a benchmark publishes a new version. Last built 2026-10-28.

- `deepswe.json`: DeepSWE's own published trials (deepswe.datacurve.ai), scored attempts only.
- `swebenchpro.json`: Scale's dataset ScaleAI/SWE-bench_Pro (V2) and Scale's 2025 runs on v1 for the solve rate.
  Those are older models, so the bands are relative: 244 tasks were solved by none of them.
