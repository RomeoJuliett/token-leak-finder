import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultPaths, normalizeLogPath, resolveLogPath } from '../src/paths.js';
import { buildOpenCommand } from '../src/open.js';
import { oneLineSummary } from '../src/terminal.js';
import { analyze } from '../src/analyze.js';
import { privacy } from '../src/privacy.js';
import { shellFiles } from '../src/parser.js';
import { localMetadata } from '../src/local.js';
import { fixtures } from './fixtures/generate.js';
import type { Options } from '../src/types.js';

const exec = promisify(execFile);
const cli = resolve('dist/src/cli.js');
const cleanEnv = { ...process.env, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '', NO_COLOR: '1' };
async function workspace(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), 'tlf-launch-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const d = await fixtures(root);
    const options: Options = { claudeDir: d.claude, codexDir: d.codex, homeDir: d.home, since: Date.now() - 30 * 864e5, until: Date.now(), redact: false, maxLineBytes: 2e6, concurrency: 2, hugeOutputTokens: 10000, contextThreshold: 150000 };
    return { ...d, options };
}

test('default paths use the OS home, with optional XDG Claude projects', async t => {
    const { home } = await workspace(t);
    const plain = await defaultPaths(home, {});
    assert.deepEqual(plain.claudeDirs, [join(home, '.claude', 'projects')]);
    assert.equal(plain.codexDir, join(home, '.codex', 'sessions'));
    await mkdir(join(home, '.config', 'claude', 'projects'), { recursive: true });
    const xdg = await defaultPaths(home, {});
    assert.deepEqual(xdg.claudeDirs, [join(home, '.claude', 'projects'), join(home, '.config', 'claude', 'projects')]);
});

test('environment overrides accept multiple Claude config directories and a Codex home', async t => {
    const { root, home } = await workspace(t);
    await mkdir(join(home, '.config', 'claude', 'projects'), { recursive: true });
    const a = join(root, 'profile a'), b = join(root, 'profile b'), codex = join(root, 'custom codex');
    const paths = await defaultPaths(home, { CLAUDE_CONFIG_DIR: ` ${a},, ${b},${a} `, CODEX_HOME: codex });
    assert.deepEqual(paths.claudeDirs, [join(a, 'projects'), join(b, 'projects')]);
    assert.deepEqual(paths.claudeConfigDirs, [a, b]);
    assert.equal(paths.codexDir, join(codex, 'sessions'));
    assert.deepEqual((await defaultPaths(home, { CLAUDE_CONFIG_DIR: ' , ' })).claudeDirs.length, 2);
});

test('CLI scans all env roots and reads only their config names plus the home config', async t => {
    const { root, home, project } = await workspace(t);
    const a = join(root, 'profile a'), b = join(root, 'profile b'), c = join(root, 'codex home');
    const stamp = new Date(Date.now() - 1000).toISOString();
    for (const [i, dir] of [a, b].entries()) {
        await mkdir(join(dir, 'projects'), { recursive: true });
        await writeFile(join(dir, 'projects', 'session.jsonl'), JSON.stringify({ type: 'assistant', timestamp: stamp, cwd: project, message: { id: `r${i}`, usage: { input_tokens: 100 } } }));
        await writeFile(join(dir, 'settings.json'), JSON.stringify({ mcpServers: { [`profile-${i}`]: { env: { key: 'SECRET_PROMPT_SENTINEL' } } } }));
    }
    await mkdir(join(c, 'sessions'), { recursive: true });
    await writeFile(join(c, 'sessions', 'rollout-env.jsonl'), JSON.stringify({ type: 'token_usage_record', timestamp: stamp, payload: { response_id: 'r', usage: { input_tokens: 100 } } }));
    await writeFile(join(c, 'config.toml'), '[mcp_servers.env-codex]\ncommand = "SECRET_PROMPT_SENTINEL"\n');
    const env = { ...cleanEnv, CLAUDE_CONFIG_DIR: `${a},${b}`, CODEX_HOME: c };
    const result = await exec(process.execPath, [cli, '--home-dir', home, '--json', '-', '--out', join(root, 'env.html')], { env });
    const data = JSON.parse(result.stdout);
    assert.equal(data.sources.claude.filesScanned, 2);
    assert.equal(data.sources.codex.filesScanned, 1);
    for (const name of ['profile-0', 'profile-1', 'env-codex', 'private-company'])
        assert.ok(data.mcps.some((m: any) => m.name === name));
    assert.ok(!result.stdout.includes('SECRET_PROMPT_SENTINEL'));
    assert.match(result.stderr.trim().split('\n').at(-1)!, /limit-weighted tokens.*→/);
    // Explicit flags replace the environment log roots.
    const explicit = await exec(process.execPath, [cli, '--claude-dir', join(root, 'missing'), '--only', 'claude', '--home-dir', home], { env });
    assert.match(explicit.stdout, /No logs found/);
    assert.ok(!explicit.stdout.includes(join(a, 'projects')));
    for (const out of [join(a, 'settings.json'), join(b, 'settings.json'), join(c, 'config.toml'), join(b, 'projects', 'report.html')])
        await assert.rejects(exec(process.execPath, [cli, '--out', out, '--home-dir', home], { env }));
    const unchanged = JSON.parse(await readFile(join(a, 'settings.json'), 'utf8'));
    assert.ok(unchanged.mcpServers['profile-0']);
});

test('overlapping and repeated Claude roots do not duplicate usage', async t => {
    const { claude, options } = await workspace(t);
    const a = await analyze(options);
    const b = await analyze({ ...options, claudeDirs: [claude, join(claude, 'project'), claude] });
    assert.deepEqual(b.totals, a.totals);
    assert.equal(b.stats.files, a.stats.files);
});

test('Windows log paths normalize case, separators, dot segments and relative reads', () => {
    const cwd = win32.join('C:\\', 'Users', 'Alice', 'Private Project');
    assert.equal(normalizeLogPath(cwd + '\\'), 'c:/users/alice/private project');
    assert.equal(normalizeLogPath('C:\\'), 'c:/');
    assert.equal(normalizeLogPath('\\\\SERVER\\Share\\Project'), '//server/share/project');
    assert.equal(resolveLogPath(cwd, 'src\\..\\src\\File.ts'), 'c:/users/alice/private project/src/file.ts');
    assert.deepEqual(shellFiles({ command: ['cat', win32.join(cwd, 'src', 'File.ts')] }, cwd), ['c:/users/alice/private project/src/file.ts']);
    assert.deepEqual(shellFiles({ cmd: 'cat "src\\test.ts"' }, cwd), ['c:/users/alice/private project/src/test.ts']);
});

test('Windows cwd variants group together, match project filters and redact paths everywhere', async t => {
    const { root, options } = await workspace(t);
    const logs = join(root, 'windows-logs');
    await mkdir(logs);
    const stamp = new Date(Date.now() - 1000).toISOString();
    for (const [i, cwd] of ['C:\\Users\\Alice\\PrivateProject', 'c:/users/alice/privateproject/'].entries()) {
        const events = [0, 1].flatMap(n => [
            { type: 'assistant', timestamp: stamp, cwd, message: { id: `r${n}`, usage: { input_tokens: 100 }, content: [{ type: 'tool_use', id: `t${n}`, name: 'Read', input: { file_path: 'src\\secret.ts' } }] } },
            { type: 'user', timestamp: stamp, message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'SYNTHETIC_PRIVATE_TEXT' }] } },
        ]);
        await writeFile(join(logs, `${i}.jsonl`), events.map(e => JSON.stringify(e)).join('\n'));
    }
    await writeFile(join(options.homeDir, '.claude.json'), JSON.stringify({ projects: { 'C:\\Users\\Alice\\PrivateProject': { mcpServers: { 'scoped-server': {} } } } }));
    const a = await analyze({ ...options, only: 'claude', claudeDir: logs, project: 'Users\\Alice' });
    assert.equal(a.projects.length, 1);
    assert.equal(a.projects[0].sessions, 2);
    assert.equal(a.repeatedFiles.length, 1);
    assert.equal(a.mcps.find(m => m.name === 'scoped-server')!.projects[0], a.projects[0].name);
    const nativeProject = 'C:\\Users\\Alice\\PrivateProject';
    const metadata = await localMetadata(options, [{ ...a.sessions[0], project: nativeProject }], a.stats);
    assert.deepEqual(metadata.mcps.find(m => m.name === 'scoped-server')!.projects, [nativeProject]);
    const redacted = await analyze({ ...options, only: 'claude', claudeDir: logs, redact: true });
    const json = JSON.stringify(redacted);
    assert.ok(!/alice|privateproject|secret\.ts|SYNTHETIC_PRIVATE_TEXT/i.test(json));
    assert.match(redacted.repeatedFiles[0].path, /^project-a\/file-\d+\.ts$/);
    // Also cover metadata supplied directly with native backslash paths.
    a.redacted = true;
    // privacy() operates before evidence strings are generated by detectLeaks.
    a.leaks = []; a.costLevers = [];
    a.projects[0].name = 'C:\\Users\\Alice\\PrivateProject';
    a.repeatedReads[0].path = 'C:\\Users\\Alice\\PrivateProject\\src\\secret.ts';
    const safe = privacy(a, 'C:\\Users\\Alice');
    assert.match(safe.repeatedReads[0].path, /^project-a\/file-/);
    assert.ok(!/alice|privateproject/i.test(JSON.stringify(safe)));
});

test('no-logs CLI succeeds, lists searched paths and guidance, and writes no report', async t => {
    const { root, home } = await workspace(t);
    const claude = join(root, 'missing-claude'), codex = join(root, 'missing-codex'), out = join(root, 'empty.html');
    const result = await exec(process.execPath, [cli, '--claude-dir', claude, '--codex-dir', codex, '--home-dir', home, '--out', out], { env: cleanEnv });
    for (const expected of ['No logs found', claude, codex, '--claude-dir', '--codex-dir', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'Nothing was uploaded'])
        assert.ok(result.stdout.includes(expected), expected);
    await assert.rejects(access(out));
});

test('no-logs --json - stays valid JSON with guidance only on stderr', async t => {
    const { root, home } = await workspace(t);
    const result = await exec(process.execPath, [cli, '--only', 'codex', '--codex-dir', join(root, 'missing'), '--home-dir', home, '--redact', '--json', '-', '--out', join(root, 'none.html')], { env: cleanEnv });
    assert.equal(JSON.parse(result.stdout).stats.files, 0);
    assert.match(result.stderr, /No logs found/);
    assert.ok(!result.stderr.includes(root));
    assert.ok(!result.stderr.includes('  Claude:'));
});

test('one-line summary uses weighted estimates, readable top leak and redacted filename', async t => {
    const { options } = await workspace(t);
    const a = await analyze(options);
    a.totals.weighted = 3.62e9; a.avoidablePercent = 25.9; a.redacted = true;
    a.leaks = [{ ...a.leaks[0], category: 'long_context_no_compaction', percent: 51.6 }];
    assert.equal(oneLineSummary(a, join('private', 'token-leaks-report.html')), '3.62B limit-weighted tokens · ~25.9% likely avoidable · top leak: long chats without compaction (51.6%) → token-leaks-report.html');
    a.leaks = [];
    assert.match(oneLineSummary(a, 'report.html'), /top leak: none detected/);
});

test('CLI ends with one-line summary and has no ANSI colors when redirected or NO_COLOR is set', async t => {
    const { root, claude, codex, home } = await workspace(t);
    const args = [cli, '--claude-dir', claude, '--codex-dir', codex, '--home-dir', home, '--redact', '--out', join(root, 'report.html')];
    for (const env of [cleanEnv, { ...cleanEnv, NO_COLOR: undefined }]) {
        const result = await exec(process.execPath, args, { env });
        const last = result.stdout.trim().split('\n').at(-1)!;
        assert.match(last, /^\d.*limit-weighted tokens · ~[\d.]+% likely avoidable · top leak: .*→ report.html$/);
        assert.ok(!/[\x1b]/.test(result.stdout + result.stderr));
        assert.ok(!result.stdout.includes(root));
    }
});

test('--open builds detached local-browser commands for each OS without spawning', () => {
    const file = resolve('report & 50% "example".html');
    const url = pathToFileURL(file).href;
    const mac = buildOpenCommand(file, 'darwin'), linux = buildOpenCommand(file, 'linux'), windows = buildOpenCommand(file, 'win32');
    assert.equal(mac.command, 'open'); assert.deepEqual(mac.args, [url]);
    assert.equal(linux.command, 'xdg-open'); assert.deepEqual(linux.args, [url]);
    assert.equal(windows.command, 'cmd');
    assert.deepEqual(windows.args, ['/d', '/v:off', '/s', '/c', 'start "" "%TOKEN_LEAK_FINDER_REPORT_URL%"']);
    assert.equal(windows.env!.TOKEN_LEAK_FINDER_REPORT_URL, url);
    assert.ok(windows.windowsVerbatimArguments);
    assert.ok(!windows.args.some(arg => arg.includes('50%')));
});

test('package exposes both bins, builds on pack, and ships only runtime source and public docs', async () => {
    const p = JSON.parse(await readFile('package.json', 'utf8'));
    assert.deepEqual(p.bin, { 'token-leak-finder': 'dist/src/cli.js', 'token-leaks': 'dist/src/cli.js' });
    assert.deepEqual(p.files, ['dist/src/', 'README.md', 'LICENSE', 'CHANGELOG.md']);
    assert.notEqual(p.private, true);
    assert.equal(p.publishConfig.access, 'public');
    assert.equal(p.engines.node, '>=18');
    assert.equal(p.scripts.prepack, 'npm run build');
    assert.ok((await readFile('dist/src/cli.js', 'utf8')).startsWith('#!/usr/bin/env node\n'));
    assert.ok(!p.dependencies || !Object.keys(p.dependencies).length);
});

test('help documents the 30-day default, environment overrides and local-only --open', async () => {
    const { stdout } = await exec(process.execPath, [cli, '--help'], { env: cleanEnv });
    for (const value of ['default: 30d', '--open', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', '.config/claude/projects', 'local browser on a local file'])
        assert.ok(stdout.includes(value), value);
});
