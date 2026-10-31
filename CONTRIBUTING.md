# Contributing

Use Node.js 18+ and keep application runtime dependencies at zero.

```sh
npm ci
npm test
npm run demo
npm run test:package
```

`npm test` builds TypeScript and runs `node:test` with explicit filenames, including on Windows. CI checks macOS/Linux/Windows on Node 18/20/22 and separately checks the installed tarball. Package checks use offline npm operations; initial development dependency installation needs a registry or local cache.

## Fixtures and privacy

Use **synthetic fixtures only**. Never add real session logs, conversations, tool bodies, config values, credentials, or real-log reports to a commit, issue, or PR—even when redacted. `reports/` and generated `test/fixtures/data/` stay gitignored. `docs/sample-report.html` and `docs/screenshot.png` must remain synthetic.

Tests generate temporary fixtures and clean them up. Extend `test/fixtures/generate.ts` or create small synthetic events within a test. Include private-text/secret sentinels and assert that HTML, JSON, and rules do not contain them. Clear `CLAUDE_CONFIG_DIR` and `CODEX_HOME` in fixture commands; use explicit source roots and `--home-dir` so tests never inspect your real configuration.

Application code may import Node builtins and local modules only. Do not add network modules, clients, telemetry, uploads, external report assets, or runtime package dependencies. The source audit in `test/edge.test.ts` enforces the network/import boundary; report tests also check offline rendering. `--open` is a local detached browser launcher, tested through its command builder without actually spawning a browser.

## Supporting a new log version

1. Describe the new record's **keys and types**, without pasting any real values or log lines. Note tool/version and whether counters are cumulative, per-response, or streaming snapshots.
2. Build the smallest synthetic fixture that exercises it. Cover duplicates, counter resets, missing timestamps, malformed input, compaction boundaries, and cache/reasoning subset semantics where applicable.
3. Update `src/parser.ts` to normalize into `ParsedSession`/`Tokens` from `src/types.ts`. Never put prompt, reasoning, command, or tool-result text into the report model. Retain only validated identifiers/paths, numeric counters, and inferred metadata.
4. Verify totals against hand-calculated expected numbers. Avoid adding alternate counter formats together when they describe the same response. Count unknown/skipped coverage rather than guessing.
5. Add end-to-end privacy assertions and update README format limitations. Run `npm test` and `npm run test:package`.

Keep estimation assumptions in `src/config.ts`. Leak cards can overlap; preserve the per-session maximum and 50% actionable allowance for the headline unless an explicitly documented methodology change is intended. Model choice and uncertain replay/startup diagnostics stay outside that headline.

## Pull requests

Explain the behavior change and validation. Include OS, Node/tool versions, and only synthetic examples or carefully reviewed **aggregate** excerpts from `--redact --json`. Never attach raw logs or private reports. Check diffs and attachments for local paths, names, tokens, and sentinels before submitting. Do not weaken redaction, output-overwrite protections, or the network audit to make a test pass.

Refresh the sample with the README fixture commands after report-visible changes. Public publishing and release tagging are maintainer actions; `private: true` remains until launch approval.
