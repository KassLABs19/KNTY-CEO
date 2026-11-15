# Working on this repo

## Code graph (Graphify)
- `graphify-out/` holds a Graphify knowledge graph of this codebase (code-only, no LLM).
- Before searching files for architecture or "how does X connect to Y" questions, read
  `graphify-out/GRAPH_REPORT.md` (god nodes, communities) and query `graphify-out/graph.json`.
- The graph records the commit it was built from; if it is stale, regenerate with
  `graphify update .` (needs `pip install graphifyy`), or ignore it.
