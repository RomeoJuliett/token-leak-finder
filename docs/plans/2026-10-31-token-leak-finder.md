# Token Leak Finder v0.1 implementation plan

Goal: Explain local Claude Code and Codex token usage without retaining conversation content or making network calls.

Architecture: bounded line streaming → tolerant source adapters → numeric/session/tool/path aggregates → leak estimates → privacy projection → offline HTML, JSON, and suggested rules. Node built-ins only, TypeScript ESM/ES2022/NodeNext. Work directly on main as requested.

1. Write synthetic fixture generator and tests for deduplication, counter deltas, compaction, file reads, oversized/malformed lines and privacy. Run to establish failing behavior.
2. Implement bounded reader and parsers. Deduplicate Claude response usage, merge streaming usage snapshots, use Codex cumulative deltas to suppress duplicate token notifications. Handle modern response usage metadata without double counting event_msg counters. Verify math; commit.
3. Implement discovery, bounded workers, local instruction byte counts and config name-only extraction. Add all ranked leak categories with explicit assumptions, overlap caveat and conservative headline estimate. Test and commit.
4. Implement redaction and string scrubbing before any serialization, inline SVG/CSS/JS report and CLI flags/progress. Test offline/privacy/CLI behavior and commit.
5. Document usage, all flags, privacy, limits and fixture results; add MIT license and redacted sample. Run demo and tests.
6. Run the requested real redacted and non-redacted commands, measure runtime and inspect aggregate numbers only. Fix and regression-test any discovered issue. Confirm ignored artifacts, clean status, commit history; never push or add remotes.

Design: follow the supplied headline/cards/charts/tables brief. Responsive warm-neutral background, coral/violet/teal SVG charts, high-contrast typography and light/dark color schemes; system fonts only. Numbers and identifiers are the only log-derived values allowed to cross the parser boundary. Snippets use static text plus validated identifiers. Raw instructions/config properties never enter reports.

Verification: node:test synthetic fixtures only; no-network source audit; sentinel exclusion in HTML/JSON/rules; CLI subprocess integration; two local-only 30-day real-log scans. Reports stay gitignored. Known costs (MCP schema size, baseline, model tier and repeated-output tokens) are heuristics, not provider billing or quota measurements.
