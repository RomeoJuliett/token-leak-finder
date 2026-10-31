#!/usr/bin/env node
import { mkdir, writeFile, rename, unlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { analyze } from './analyze.js';
import { renderReport, renderRules } from './report.js';
import { scrub } from './privacy.js';
import { defaultPaths } from './paths.js';
import { oneLineSummary, noLogsMessage } from './terminal.js';
import { openReport } from './open.js';
import type { Options } from './types.js';
const HELP = `Token Leak Finder v0.1.0 — local-only agent usage analysis

Usage: token-leak-finder [options] (alias: token-leaks)
  --since <30d|YYYY-MM-DD>     Date window (default: 30d; h/d/w units accepted)
  --claude-dir <path>          Override Claude projects roots (see defaults below)
  --codex-dir <path>           Override Codex sessions root (see defaults below)
  --only <claude|codex>        Analyze one source
  --project <substring>       Filter cwd paths (case insensitive)
  --out <path>                HTML (default: ./token-leaks-report.html)
  --json [path|-]             Aggregate JSON (default: ./token-leaks-analysis.json)
  --rules [path]              Rules draft (default: ./suggested-rules.md)
  --redact                    Screenshot-safe aliases and secret scrubbing
  --open                      Launch the local HTML file in your default browser
  --max-line-bytes <n>        Skip larger lines before buffering (default: 8388608)
  --concurrency <1..16>       Bounded file workers (default: 4)
  --huge-output-tokens <n>    Large result threshold (default: 10000)
  --context-threshold <n>     Compaction checkpoint (default: 150000)
  --top-tier-pattern <glob>    Repeatable model-tier override (* wildcard; case-insensitive)
  --home-dir <path>           Override home for config/size checks (fixture support)
  --help, -h                  Show help
  --version, -v               Show version

Claude defaults: $CLAUDE_CONFIG_DIR/projects (comma-separated config directories),
otherwise ~/.claude/projects plus ~/.config/claude/projects when it exists.
Codex default: $CODEX_HOME/sessions, otherwise ~/.codex/sessions.
--home-dir changes config discovery only; explicit log flags override env defaults.
No network, telemetry, uploads or log modifications. Costs are estimates.
--open only launches a local browser on a local file.
`;
function since(value: string, now: number): number { const m = /^(\d+(?:\.\d+)?)(h|d|w)$/.exec(value); if (m) {
    const ms = Number(m[1]) * ({ h: 3600000, d: 86400000, w: 604800000 }[m[2]]!);
    if (ms > 0 && ms <= now)
        return now - ms;
} if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = Date.parse(value + 'T00:00:00Z');
    if (Number.isFinite(t) && t <= now && new Date(t).toISOString().slice(0, 10) === value)
        return t;
} throw new Error('Invalid --since: use 30d or YYYY-MM-DD in the past.'); }
async function canonical(p: string): Promise<string> { try {
    return await realpath(p);
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Cannot resolve an output path.');
    const parent = dirname(p);
    if (parent === p)
        return p;
    return join(await canonical(parent), basename(p));
} }
const inside = (parent: string, child: string) => { const r = relative(parent, child); return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)); };
async function atomic(file: string, body: string) { await mkdir(dirname(file), { recursive: true }); const temp = file + '.' + process.pid + '.tmp'; try {
    await writeFile(temp, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temp, file);
}
finally {
    await unlink(temp).catch(() => { });
} }
async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        process.stdout.write(HELP);
        return;
    }
    if (args.includes('--version') || args.includes('-v')) {
        process.stdout.write('0.1.0\n');
        return;
    }
    const now = Date.now(), home = homedir(), defaults = await defaultPaths(home);
    const o: Options = { ...defaults, claudeDir: defaults.claudeDirs[0], homeDir: home, since: now - 30 * 86400000, until: now, redact: false, maxLineBytes: 8 * 1024 * 1024, concurrency: 4, hugeOutputTokens: 10000, contextThreshold: 150000 };
    let out = resolve('token-leaks-report.html'), json: string | undefined, rules: string | undefined, open = false;
    const required = () => { const v = args.shift(); if (v === undefined || v.startsWith('--'))
        throw new Error('Missing flag value. Use --help.'); return v; };
    while (args.length) {
        let flag = args.shift()!;
        if (flag.startsWith('--') && flag.includes('=')) {
            const at = flag.indexOf('=');
            args.unshift(flag.slice(at + 1));
            flag = flag.slice(0, at);
        }
        switch (flag) {
            case '--redact':
                o.redact = true;
                break;
            case '--open':
                open = true;
                break;
            case '--since':
                o.since = since(required(), now);
                break;
            case '--claude-dir':
                o.claudeDir = resolve(required());
                o.claudeDirs = [o.claudeDir];
                break;
            case '--codex-dir':
                o.codexDir = resolve(required());
                break;
            case '--top-tier-pattern': {
                const pattern = required();
                if (!pattern.length || pattern.length > 180 || !/^[\w*.:/+@-]+$/.test(pattern)) throw new Error('Invalid model-tier glob.');
                (o.topTierPatterns ??= []).push(pattern);
                break;
            }
            case '--home-dir':
                o.homeDir = resolve(required());
                break;
            case '--project':
                o.project = required();
                break;
            case '--only': {
                const value = required();
                if (value !== 'claude' && value !== 'codex')
                    throw new Error('--only must be claude or codex.');
                o.only = value;
                break;
            }
            case '--out':
                out = resolve(required());
                break;
            case '--json':
                json = args[0] && !args[0].startsWith('--') ? args.shift()! : 'token-leaks-analysis.json';
                break;
            case '--rules':
                rules = args[0] && !args[0].startsWith('--') ? args.shift()! : 'suggested-rules.md';
                break;
            case '--max-line-bytes':
            case '--concurrency':
            case '--huge-output-tokens':
            case '--context-threshold': {
                const n = Number(required());
                const max = flag === '--concurrency' ? 16 : flag === '--max-line-bytes' ? 256 * 1024 * 1024 : Number.MAX_SAFE_INTEGER;
                if (!Number.isSafeInteger(n) || n < 1 || n > max)
                    throw new Error('Invalid numeric flag value. Use --help for bounds.');
                const key = ({ '--max-line-bytes': 'maxLineBytes', '--concurrency': 'concurrency', '--huge-output-tokens': 'hugeOutputTokens', '--context-threshold': 'contextThreshold' } as const)[flag];
                o[key] = n;
                break;
            }
            default: throw new Error('Unknown argument. Use --help.');
        }
    }
    if (json && json !== '-')
        json = resolve(json);
    if (rules)
        rules = resolve(rules);
    // A fixture home scopes config discovery without changing the log roots.
    const configDefaults = await defaultPaths(o.homeDir);
    o.claudeConfigDirs = configDefaults.claudeConfigDirs;
    o.codexHome = configDefaults.codexHome;
    const outputs = [out, ...json && json !== '-' ? [json] : [], ...rules ? [rules] : []];
    const roots = await Promise.all([...(o.claudeDirs ?? [o.claudeDir]), o.codexDir].map(canonical));
    const paths = await Promise.all(outputs.map(canonical));
    if (new Set(paths).size !== paths.length)
        throw new Error('Output files must have different paths.');
    const protectedFiles = await Promise.all([join(o.homeDir, '.claude.json'), ...o.claudeConfigDirs.map(dir => join(dir, 'settings.json')), join(o.codexHome, 'config.toml')].map(canonical));
    for (const p of paths)
        if (roots.some(root => inside(root, p)) || p.toLowerCase().endsWith('.jsonl') || protectedFiles.includes(p) || ['agents.md', 'claude.md', '.mcp.json'].includes(basename(p).toLowerCase()))
            throw new Error('Output would overwrite logs, instructions or configuration. Choose a report path outside source directories.');
    process.stderr.write('Scanning local logs (read-only)…\n');
    let last = 0;
    const started = Date.now();
    o.progress = (done, total, bytes) => { if (Date.now() - last > 1000 || done === total) {
        last = Date.now();
        process.stderr.write(`  ${done}/${total} files · ${(bytes / 1024 / 1024).toFixed(0)} MiB\n`);
    } };
    const a = await analyze(o);
    if (!a.stats.files) {
        const searched = [
            ...o.only !== 'codex' ? (o.claudeDirs ?? [o.claudeDir]).map(path => ({ source: 'Claude', path })) : [],
            ...o.only !== 'claude' ? [{ source: 'Codex', path: o.codexDir }] : [],
        ];
        (json === '-' ? process.stderr : process.stdout).write(noLogsMessage(searched, o.redact));
        if (json === '-') process.stdout.write(JSON.stringify(a, null, 2) + '\n');
        return;
    }
    await atomic(out, renderReport(a));
    if (json && json !== '-')
        await atomic(json, JSON.stringify(a, null, 2) + '\n');
    if (rules)
        await atomic(rules, renderRules(a));
    if (open) {
        try { await openReport(out); }
        catch { process.stderr.write('Report saved. Could not launch a browser; open the HTML file manually.\n'); }
    }
    const summary = [
        `Token Leak Finder v${a.version}${o.redact ? ' · Redacted' : ''}`,
        `${a.sessions.length} sessions · ${a.projects.length} projects · ${((Date.now() - started) / 1000).toFixed(2)}s`,
        `${a.totals.total.toLocaleString('en-US')} raw tokens · ~${Math.round(a.avoidableTokens).toLocaleString('en-US')} weighted opportunity (estimate)`,
        ...(['claude', 'codex'] as const).filter(source => !o.only || o.only === source).map(source => `${source}: ${a.sources[source].filesScanned} files scanned · ${a.sources[source].sessionsWithUsage} sessions with usage · ${a.sources[source].toolOnlySessions} tool-only sessions`),
        ...a.leaks.slice(0, 3).map((l, i) => `${i + 1}. ${l.title}: ${l.percent}% of weighted usage`),
        `Coverage: ${a.stats.malformed} malformed · ${a.stats.unknown} unknown · ${a.stats.oversized} oversized · ${a.stats.fileErrors} file errors`,
        ...!a.sessions.length ? ['No matching usage found. Check --since, --project and scan coverage.'] : [],
        'Nothing uploaded. Cards overlap; headline uses one signal per session × 50%. All amounts are estimates.',
        oneLineSummary(a, out),
    ].join('\n') + '\n';
    if (json === '-') {
        process.stdout.write(JSON.stringify(a, null, 2) + '\n');
        process.stderr.write(summary);
    }
    else
        process.stdout.write(summary);
}
main().catch(error => {
    const message = error instanceof Error ? error.message : 'Unexpected failure'; // Avoid printing file-system error paths or any input values.
    process.stderr.write('token-leaks: ' + scrub(message.startsWith('E') ? 'Cannot read or write the requested files. Check paths and permissions.' : message) + '\n');
    process.exitCode = 1;
});
