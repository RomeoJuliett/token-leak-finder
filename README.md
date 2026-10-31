# Token Leak Finder

Find out **why Claude Code and Codex limits run out**, using the logs already on your machine. Token Leak Finder v0.1 is a local-only CLI that turns cache traffic, repeated reads, oversized tool output and startup overhead into an offline report and practical fixes.

![Token Leak Finder report (synthetic sample data, --redact)](docs/screenshot.png)

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
| `--context-threshold <n>` | `150000` | Context checkpoint for excess-only uncompacted usage. |
| `--top-tier-pattern <glob>` | `*opus*`, `*:high`, `*:xhigh`, `*:ultra`, `*:max` | Repeat to replace the defaults; case-insensitive, `*` wildcard. |
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
| `long_context_no_compaction` | Excess context only: `max(0, context − threshold)` on responses in uncompacted segments with at least five above-threshold responses. | Compact near 150k at a checkpoint, or start fresh with a short handoff. |
| `resumed_idle_sessions` | A gap over one hour was followed by at least 10k cache-write tokens. | Save a handoff before breaks; use it when old context is no longer useful. |
| `subagent_startup` | Sidechain/subagent sessions paid first-response overhead. | Batch related small tasks and pass focused context. |
| `big_baseline_per_session` | First observed fresh input plus cache write exceeded 10k tokens. | Reduce always-loaded tools/instructions and avoid redundant session startup. |

`expensive_model_share` appears separately under **Cost levers**, below the leaks. Detection uses configurable model-name globs, including future model names such as `gpt-6.1-sol:high`. The card names the models actually seen and shows their weighted usage share, not claimed savings. Model choice is excluded from the avoidable total.

Only categories with positive signals appear. Evidence uses counts, identifiers and paths; it never quotes conversations. `--rules` provides CLAUDE.md/AGENTS.md rules, a `.claudeignore` draft, permission-deny examples and output-cap settings. Support for ignore files and environment settings varies by Claude Code version; the drafts explicitly ask you to verify support and merge them manually.

## Measurement and attribution

Claude usage is deduplicated by message ID/request ID. Repeated streaming snapshots are merged with per-field maxima; unique tool calls and results are counted once. Input, output, cache creation and cache reads are separate.

Codex cached input is a **subset of input**, and reasoning is a **subset of output**. We subtract cached input/cache writes from fresh input and never add reasoning a second time. Cumulative usage deltas suppress duplicate counter notifications; `last_token_usage` handles first observed responses and counter resets when available. Last-only notifications are deduplicated by turn marker and usage signature. Modern `token_usage_record` records provide a fallback when a file has no in-range `token_count` events. Formats were checked using **keys/types only** from local logs.

A “response” or “usage turn” is one metered API response, not necessarily one user message. Sessions are log files; subagent files receive separate identifiers. Source coverage reports **files scanned** after the mtime prefilter, **sessions with positive usage** in the selected event window/project, and tool-only sessions separately. Empty, zero-usage or out-of-window files are still scanned files. There is no file cap, top-N slice or cross-source session deduplication. HTML tables are presentation-limited; JSON keeps all aggregate rows. Project attribution uses session cwd. Model mix is measured per response. Tool result estimates are attributed per tool call and MCP server. Literal `Read`, `cat`, `sed` and `rg` file reads are inferred; nested `functions.exec` command literals are also recognized without executing code. Wrappers with a single distinct nested tool name are attributed to that tool, including MCP tools; mixed wrappers remain attributed to `functions.exec`. Results from multi-file shell calls are divided equally across inferred files. Tool sizes are a separate diagnostic and are **not added** to provider usage totals.

All weights and heuristic thresholds live together in `src/config.ts`; configurable thresholds are recorded in JSON. The relative **limit-weighted estimate** is:

```text
fresh input × 1 + output × 5 + cache read × 0.1 + cache write × 1.25
```

These weights are illustrative, **not provider quota rules, prices or a billing estimate**. Token traffic includes cache replay, so it can be much larger than newly generated text. Baseline uses the first observed fresh input plus cache writes. Baseline replay is baseline × metered responses; startup totals are baseline × sessions. Instruction size is bytes / 4; tool text is characters / 4. Metadata size discovery stats `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md` and global Claude/Codex instruction files **without reading their contents**.

MCP schema size is **assumed to be 1,000 tokens per configured server per response**, not inferred from secrets or schema text. The report lists scope and usage so you can investigate. Current config may differ from the historical setup; lazy/deferred schema loading can reduce overhead. Instruction replay assumes files are loaded every response and is an upper bound. Replay diagnostics allocate assumed raw replay using each affected session’s observed weighted-context/raw-context ratio, bounded by observed input/cache usage. A tool result or reread counts one fresh-input insertion at weight 1, capped per session by observed weighted context; future cache replay is excluded. These are attribution heuristics, not provider measurements.

The headline, leak ranking, leak percentages, daily/project charts and model mix use **limit-weighted tokens (estimate)**. Raw tokens remain secondary; tool-size charts and context bands explicitly use raw units. JSON `weightedTokens` is the primary card amount; `estimatedTokens` is an alias in the same weighted unit, and `rawEstimatedTokens` preserves the raw estimate. Percentages divide by `totals.weighted`, not raw traffic.

Long context counts **only excess above the configured checkpoint** (150k by default), in segments with at least five above-threshold metered responses. For each qualifying response:

```text
excess raw = max(0, fresh input + cache read + cache write − threshold)
excess weighted = excess raw / context × (input × 1 + cache read × 0.1 + cache write × 1.25)
```

This proportional allocation does not assume which context could be removed. Four bands show responses and distinct sessions at `<100k`, `100–200k`, `200–500k` (including exactly 500k), and `>500k`. The adjacent scenario counts responses above 500k and estimates their excess if compacted to 150k. That scenario overlaps the long-context finding and is never added to it.

Leak cards **overlap and must not be summed**. The headline uses this conservative scenario for each session:

```text
supported = max(weighted excess context, weighted repeated reads,
                weighted huge outputs, weighted idle cache rewrites)
session opportunity = min(supported, observed weighted input/cache) × 0.50
headline opportunity = sum(session opportunity across distinct sessions)
headline percent = headline opportunity / total weighted usage × 100
```

The 50% actionable allowance acknowledges that some context, rereads and output remain useful; it is an explicit assumption, not a measured removal rate or provider rule. Repeated-read/huge-output estimates are capped within each session before comparison. JSON `avoidableContributions` records the winning signal, session and weighted/raw amounts; raw savings follow that same winning signal and allowance. Disjoint sessions can contribute independently; all signals within one session are treated as overlapping. Schema replay, instruction replay, baseline, subagent startup and model choice are **excluded from the headline** because useful startup, historical loading and removable content cannot be inferred reliably. They remain visible diagnostics. No percentage claims verified quota savings.

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

`npm test` builds with TypeScript and runs `node:test`. Tests cover excess-only weighted context, per-session overlap, context bands, source coverage, model patterns, usage math, duplicate events, compaction, sidechains, file reads, huge output, filters, nine leak diagnostics and the separate cost lever, private MCP scope, the network audit, string scrubbing, report privacy and CLI integration. Tests generate fixtures in temporary directories and remove them afterward.

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
367,370 limit-weighted tokens (estimate) · ~29% potentially avoidable
3,105,950 raw tokens · ~106,517 weighted opportunity (estimate)
claude: 2 files scanned · 2 sessions with usage · 0 tool-only sessions
codex: 1 files scanned · 1 sessions with usage · 0 tool-only sessions
3 sessions · 1 projects
1. long_context_no_compaction: ~212,973 weighted tokens (58%) · ~2,102,000 raw
2. resumed_idle_sessions: ~25,000 weighted tokens (6.8%) · ~20,000 raw
3. big_baseline_per_session: ~16,000 weighted tokens (4.4%) · ~13,000 raw
HTML: demo.html
Coverage: 1 malformed, 1 unknown, 0 oversized, 0 file errors.
Local only. No conversation text in reports. Cards overlap; headline uses one supported signal per session × 50%.
```

## Limitations and roadmap

Log formats change. Unknown events are counted instead of failing the run; skipped lines, missing counters and unavailable files reduce coverage. Mixed Codex usage formats use counters preferentially and may undercount if some responses only have modern records. Identical last-only usage snapshots without turn markers cannot reliably distinguish two responses. Historical cumulative-only first events may represent more than the first observed response.

Usage within a session that changes cwd is attributed to its last observed cwd. Shell inference cannot resolve variables, dynamically built commands, pipes, arbitrary scripts or exact output shares. It can miss reads and can mistake a literal path operand for a read. Rereads after edits can be useful; big output and subagents can be justified. Expensive-model “tiny task” detection uses response count/output size, not task content. Cache expiry and actual provider limit accounting cannot be proved from these logs.

No tokenizer, provider billing lookup, quota API, archive decompression or persistent database is included. Line buffers and file workers are bounded; per-file metadata and aggregate result tables grow with the number of responses, calls and files. JSON keeps all aggregate rows; HTML limits sessions to 20 and repeated reads/huge outputs/instruction files to 100 each.

Next: explicit format-version coverage, measured schema-size metadata where safely available, incremental local indexing, per-turn cwd attribution, better shell-read recognition and richer model-tier profiles. Publishing to npm is pending an owner decision.

MIT © 2026 Reco Jefferson.
