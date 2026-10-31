# Token Leak Finder

Find out **why Claude Code and Codex limits run out**, using the logs already on your machine. Token Leak Finder v0.1 is a local-only CLI that turns cache traffic, repeated reads, oversized tool output and startup overhead into an offline report and practical fixes.

![Report screenshot — coming soon](docs/screenshot.png)

Open [the synthetic, redacted sample report](docs/sample-report.html) locally in your browser. No real user logs are included in the repository.

## From source

Requires Node.js **18 or newer**. The application has **zero runtime dependencies**. TypeScript 5 and `@types/node` 22 are the only direct development dependencies.

```sh
git clone <repository-url> token-leak-finder
cd token-leak-finder
npm i
npm run build
node dist/src/cli.js
```

Installing development dependencies needs a registry or local package cache. Building and running the CLI need no network. This workspace already has its development dependencies installed.

The built executable has a Node shebang. `npm link` optionally exposes `token-leaks`; it changes only your local npm links. The future published entry point will be `npx token-leak-finder` (not published yet; `private: true` remains set).

```sh
node dist/src/cli.js --since 30d --redact \
  --out reports/my-report.html \
  --json reports/my-analysis.json \
  --rules reports/suggested-rules.md

node dist/src/cli.js --only codex --project my-project --since 7d
```

Open the HTML file directly. It includes CSS, JavaScript and SVG inline, adapts to light/dark system themes, and works offline. Suggested-rule buttons copy text; if clipboard access is unavailable for local files, a button selects the snippet for manual copying. The report never changes your settings.

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `--since <window/date>` | `30d` | Relative hours/days/weeks (`12h`, `30d`, `4w`) or UTC `YYYY-MM-DD`. End is scan start time. |
| `--claude-dir <path>` | `~/.claude/projects` | Recursively scan Claude `.jsonl` session files, including subagents. |
| `--codex-dir <path>` | `~/.codex/sessions` | Recursively scan `rollout-*.jsonl` files. |
| `--only claude\|codex` | both | Restrict the source. |
| `--project <substring>` | all | Case-insensitive match against session cwd. |
| `--out <path>` | `./token-leaks-report.html` | HTML report. |
| `--json [path]` | off | Write aggregate JSON; omitted path means `./token-leaks-analysis.json`. `--json -` sends JSON to stdout and summary to stderr. |
| `--rules [path]` | off | Write ready-to-paste drafts; omitted path means `./suggested-rules.md`. |
| `--redact` | off | Alias identifiers and paths; scrub common secret patterns from all report strings. |
| `--max-line-bytes <n>` | `8388608` | Maximum physical line size, enforced **before** `readline` buffers it. Whole oversized lines are skipped. Up to 256 MiB. |
| `--concurrency <n>` | `4` | File workers, from 1 to 16. |
| `--huge-output-tokens <n>` | `10000` | Flag tool results larger than this estimate. |
| `--context-threshold <n>` | `100000` | Context size used to detect long uncompacted segments. |
| `--home-dir <path>` | OS home | Override home for instruction-size/config discovery, useful for fixtures. Does not change the two log roots. |
| `--help`, `-h` | | Show help. |
| `--version`, `-v` | | Show version. |

Paths resolve from your current directory. Progress goes to stderr about once a second. File modification times are filtered first, then event timestamps; future events are excluded. Untimed usage is excluded and counted. Source directories, `.jsonl` logs and known instruction/config names cannot be report outputs. Files are written atomically with owner-only permissions where supported.

Missing sources and unreadable files are counted rather than crashing the scan. Check the report's scan-coverage section when the result is unexpectedly empty. Unknown event kinds, malformed JSON and skipped oversized lines are counted. Smaller caps use less memory but may omit important token/tool events.

## What each leak means

| Category | Signal | Concrete next step |
| --- | --- | --- |
| `mcp_schema_overhead` | Configured servers may contribute schemas on every response. | Enable only the servers needed for the current task and project. |
| `unused_mcp_servers` | Configured server had 0–2 observed calls in the window. | Disable it in those project settings until needed. |
| `big_instruction_files` | Instruction file is at least 4k estimated tokens. | Keep core rules short; load reference guides on demand. |
| `repeated_file_reads` | The same file was read more than once in one session. | Reuse notes; after edits, read the diff or changed lines. |
| `huge_tool_outputs` | One tool result exceeded the configured threshold. | Use `head`, `rg -m`, narrow ranges and small JSON projections. |
| `long_context_no_compaction` | At least five responses exceeded the context threshold in one uncompacted segment. | Run `/compact` at a checkpoint, or start fresh with a short handoff. |
| `resumed_idle_sessions` | A gap over one hour was followed by at least 10k cache-write tokens. | Save a handoff before breaks; use it when old context is no longer useful. |
| `subagent_startup` | Sidechain/subagent sessions paid first-response overhead. | Batch related small tasks and pass focused context. |
| `expensive_model_share` | Token traffic used Opus or GPT-5 with high reasoning. | Use Sonnet or lower reasoning for routine work. Short low-output sessions are flagged as possible tiny tasks. |
| `big_baseline_per_session` | First observed fresh input plus cache write exceeded 10k tokens. | Reduce always-loaded tools/instructions and avoid redundant session startup. |

Only categories with positive signals appear. Evidence uses counts, identifiers and paths; it never quotes conversations. `--rules` provides CLAUDE.md/AGENTS.md rules, a `.claudeignore` draft, permission-deny examples and output-cap settings. Support for ignore files and environment settings varies by Claude Code version; the drafts explicitly ask you to verify support and merge them manually.

## Measurement and attribution

Claude usage is deduplicated by message ID/request ID. Repeated streaming snapshots are merged with per-field maxima; unique tool calls and results are counted once. Input, output, cache creation and cache reads are separate.

Codex cached input is a **subset of input**, and reasoning is a **subset of output**. We subtract cached input/cache writes from fresh input and never add reasoning a second time. Cumulative usage deltas suppress duplicate counter notifications; `last_token_usage` handles first observed responses and counter resets when available. Last-only notifications are deduplicated by turn marker and usage signature. Modern `token_usage_record` records provide a fallback when a file has no in-range `token_count` events. Formats were checked using **keys/types only** from local logs.

A “response” or “usage turn” is one metered API response, not necessarily one user message. Sessions are log files; subagent files receive separate identifiers. Project attribution uses session cwd. Model mix is measured per response. Tool result estimates are attributed per tool call and MCP server. Literal `Read`, `cat`, `sed` and `rg` file reads are inferred; nested `functions.exec` command literals are also recognized without executing code. Wrappers with a single distinct nested tool name are attributed to that tool, including MCP tools; mixed wrappers remain attributed to `functions.exec`. Results from multi-file shell calls are divided equally across inferred files. Tool sizes are a separate diagnostic and are **not added** to provider usage totals.

All weights and heuristic thresholds live together in `src/config.ts`; configurable thresholds are recorded in JSON. The relative **limit-weighted estimate** is:

```text
fresh input × 1 + output × 5 + cache read × 0.1 + cache write × 1.25
```

These weights are illustrative, **not provider quota rules, prices or a billing estimate**. Token traffic includes cache replay, so it can be much larger than newly generated text. Baseline uses the first observed fresh input plus cache writes. Baseline replay is baseline × metered responses; startup totals are baseline × sessions. Instruction size is bytes / 4; tool text is characters / 4. Metadata size discovery stats `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md` and global Claude/Codex instruction files **without reading their contents**.

MCP schema size is **assumed to be 1,000 tokens per configured server per response**, not inferred from secrets or schema text. The report lists scope and usage so you can investigate. Current config may differ from the historical setup; lazy/deferred schema loading can reduce overhead. Instruction replay assumes files are loaded every response and is an upper bound. The model-choice estimate assumes 25% of top-tier traffic could move to a cheaper tier; this would change cost/limits, not raw token counts.

Leak estimates **overlap**. The “may be avoidable” headline uses the **largest single actionable token estimate**, capped at total traffic, rather than adding categories together. It is an opportunity signal, not measured savings. Even a large long-context signal does not mean all that context can safely be removed.

## Privacy promise

- **Zero network calls.** No network clients, `fetch`, HTTP/HTTPS or socket imports in application source. A source-audit test enforces this. No telemetry, uploads, remote fonts, CDNs or external report assets. The HTML also has a restrictive content security policy with network connections disabled.
- **Logs are read-only.** Only explicitly requested output artifacts are written. No configurations, agent permissions or instruction files are changed.
- **No conversation content in reports.** Prompts, assistant text, reasoning text, tool inputs and tool outputs never enter the report model. Outputs are reduced to numeric lengths; shell commands are reduced to inferred file paths. Only numbers, tool/model/server names, session IDs, project paths and file paths are retained, plus fixed explanatory text.
- Only MCP server **names** are retained from `~/.claude.json`, `~/.claude/settings.json`, project `.mcp.json` and `~/.codex/config.toml`. JSON values are parsed transiently and discarded; environment variables, arguments, headers, commands, URLs and secrets are never copied. Config files over 4 MiB are skipped and counted. Instructions are statted, never read.
- **`--redact` is screenshot-safe mode.** Projects become `project-a`, `project-b`, …; sessions become `session-1`, …; file paths become aliased directories plus `file-1.ts` style names. Home paths become `~`. Private MCP server names are aliased, including in MCP tool names. The small public-name allowlist is in `src/privacy.ts`.
- Every redacted report string passes a scrubber for common `sk-`, GitHub, AWS, Slack, JWT-like and email patterns. Redaction applies equally to HTML, JSON and rules. It is a heuristic; inspect any artifact before sharing. Default reports intentionally retain local identifiers and paths.
- Tests use **synthetic fixtures only**, with embedded secret/prompt sentinels that must never appear in HTML, JSON or rules. The included sample is synthetic and redacted.
- `reports/` is gitignored. Never commit real reports, including redacted ones. The separate non-redacted report is for private local inspection.

## Tests and demo

```sh
npm test
npm run demo
```

`npm test` builds with TypeScript and runs `node:test`. Tests cover usage math, duplicate events, compaction, sidechains, file reads, huge output, filters, all ten leaks, private MCP scope, the network audit, string scrubbing, report privacy and CLI integration. Tests generate fixtures in temporary directories and remove them afterward.

`npm run demo` generates fake log/config files under ignored `test/fixtures/data/` and writes `reports/demo.html`, `reports/demo.json` and `reports/suggested-rules.md`. Its `--home-dir` keeps configuration discovery scoped to the fixtures. To refresh the shareable sample:

```sh
node dist/src/cli.js --since 30d --redact \
  --claude-dir test/fixtures/data/claude \
  --codex-dir test/fixtures/data/codex \
  --home-dir test/fixtures/data/home \
  --out docs/sample-report.html
```

Example terminal output **from fixtures**, with timing omitted:

```text
Token Leak Finder v0.1.0 · Redacted
898,950 tokens · ~94.2% potential avoidable traffic (estimate)
3 sessions · 1 projects
1. long_context_no_compaction: ~847,000 tokens (94.2%)
2. expensive_model_share: ~215,825 tokens (24%)
3. big_instruction_files: ~84,000 tokens (9.3%)
HTML: demo.html
Coverage: 1 malformed, 1 unknown, 0 oversized, 0 file errors.
Local only. No conversation text in reports. Estimates overlap.
```

## Limitations and roadmap

Log formats change. Unknown events are counted instead of failing the run; skipped lines, missing counters and unavailable files reduce coverage. Mixed Codex usage formats use counters preferentially and may undercount if some responses only have modern records. Identical last-only usage snapshots without turn markers cannot reliably distinguish two responses. Historical cumulative-only first events may represent more than the first observed response.

Usage within a session that changes cwd is attributed to its last observed cwd. Shell inference cannot resolve variables, dynamically built commands, pipes, arbitrary scripts or exact output shares. It can miss reads and can mistake a literal path operand for a read. Rereads after edits can be useful; big output and subagents can be justified. Expensive-model “tiny task” detection uses response count/output size, not task content. Cache expiry and actual provider limit accounting cannot be proved from these logs.

No tokenizer, provider billing lookup, quota API, archive decompression or persistent database is included. Line buffers and file workers are bounded; per-file metadata and aggregate result tables grow with the number of responses, calls and files. JSON keeps all aggregate rows; HTML limits sessions to 20 and repeated reads/huge outputs/instruction files to 100 each.

Next: explicit format-version coverage, measured schema-size metadata where safely available, incremental local indexing, per-turn cwd attribution, better shell-read recognition and configurable model-tier profiles. Publishing to npm and the screenshot are pending owner actions.

MIT © 2026 Reco Jefferson.
