import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFile, shellFiles } from '../src/parser.js';
import { scrub } from '../src/privacy.js';
import { fixtures, SENTINEL } from './fixtures/generate.js';
const run = promisify(execFile);
async function parse(events: unknown[], source: 'claude' | 'codex' = 'codex', since = 0) { const d = await mkdtemp(join(tmpdir(), 'tlf-edge-')); try {
    const p = join(d, 'log.jsonl');
    await writeFile(p, events.map(x => JSON.stringify(x)).join('\n'));
    return await parseFile(p, source, { since, until: Date.now() + 864e5, maxLineBytes: 1024 * 1024 });
}
finally {
    await rm(d, { recursive: true, force: true });
} }
const timestamp = new Date().toISOString();
test('Claude streaming snapshots take component maxima and requestId aliases', async () => {
    const s = await parse([{ type: 'assistant', timestamp, requestId: 'r', message: { id: 'a', usage: { input_tokens: 20, output_tokens: 2 } } }, { type: 'assistant', timestamp, requestId: 'r', message: { id: 'b', usage: { input_tokens: 20, output_tokens: 10 } } }], 'claude');
    assert.equal(s.turns.length, 1);
    assert.equal(s.turns[0].tokens.total, 30);
});
test('Codex modern usage records and token_count are alternatives', async () => {
    const rec = { type: 'token_usage_record', timestamp, payload: { response_id: 'r1', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 10 } } };
    const s = await parse([rec, rec]);
    assert.equal(s.turns.length, 1);
    assert.equal(s.turns[0].tokens.total, 140);
    const t = await parse([rec, { type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40 }, last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40 } } } }]);
    assert.equal(t.turns.length, 1);
    assert.equal(t.turns[0].tokens.total, 140);
});
test('Codex totals-only deltas, reset and historical baseline', async () => {
    const e = (stamp: string, input: number) => ({ type: 'event_msg', timestamp: stamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: 0 } } } });
    const s = await parse([e('2000-01-01T00:00:00Z', 100), e(timestamp, 150), e(timestamp, 150), e(timestamp, 10)], 'codex', Date.now() - 864e5);
    assert.equal(s.turns.length, 2);
    assert.equal(s.turns.reduce((n, t) => n + t.tokens.total, 0), 60);
});
test('empty and malformed JSON shapes are tolerated', async () => {
    const s = await parse([null, [], 1, {}, { type: 'response_item', timestamp, payload: null }, { type: 'assistant', timestamp, message: { content: [null, 1] } }]);
    assert.ok(s.stats.malformed >= 3);
    assert.ok(s.stats.unknown >= 1);
});
test('shell paths are inferred without storing commands or patterns', () => {
    assert.deepEqual(shellFiles({ cmd: "sed -n '1,80p' src/a.ts && rg -m 3 'SECRET_PATTERN' src/b.ts" }, '/project'), ['/project/src/a.ts', '/project/src/b.ts']);
    assert.deepEqual(shellFiles({ command: ['cat', 'src/a.ts'] }, '/project'), ['/project/src/a.ts']);
});
test('nested Codex exec command literals expose read metadata only', async () => {
    const s = await parse([{ type: 'session_meta', timestamp, payload: { id: 'session', cwd: '/project' } }, { type: 'response_item', timestamp, payload: { type: 'custom_tool_call', name: 'functions.exec', call_id: 'a', input: 'const r = await tools.exec_command({cmd: "cat src/a.ts"}); text(r);' } }, { type: 'response_item', timestamp, payload: { type: 'custom_tool_call_output', call_id: 'a', output: 'SECRET_PROMPT_SENTINEL' } }]);
    assert.equal(s.reads.length, 1);
    assert.equal(s.reads[0].path, '/project/src/a.ts');
});
test('all required secret families scrub from arbitrary metadata', () => {
    const s = scrub('sk-123456789abcdef ghp_123456789abc github_pat_123456789abc AKIA1234567890ABCDEF xoxb-123456789abc eyJabcdefgh.abcdefghijk.abcdefghijk alice@example.test');
    assert.ok(!/sk-|ghp_|github_pat_|AKIA|xoxb-|eyJ|@/.test(s));
});
test('source audit forbids network APIs and non-builtin runtime imports', async () => {
    for (const name of await readdir('src')) {
        if (!name.endsWith('.ts'))
            continue;
        const code = await readFile(join('src', name), 'utf8');
        assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\b(?:https?|net|tls|dns|dgram|undici)\b(?=["'])|import\s*\(\s*["'](?:https?:|node:(?:https?|net|tls|dns|dgram))/.test(code), name);
        for (const m of code.matchAll(/from\s+['"]([^'"]+)['"]/g))
            assert.ok(m[1].startsWith('node:') || m[1].startsWith('./'), m[1]);
    }
});
test('CLI end-to-end emits only aggregates, rules and redacted HTML', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tlf-cli-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const d = await fixtures(root);
    const out = join(root, 'out/report.html'), json = join(root, 'out/data.json'), rules = join(root, 'out/rules.md');
    const result = await run(process.execPath, ['dist/src/cli.js', '--since', '30d', '--claude-dir', d.claude, '--codex-dir', d.codex, '--home-dir', d.home, '--redact', '--out', out, '--json', json, '--rules', rules]);
    assert.ok(result.stderr.includes('Scanning'));
    assert.ok(result.stdout.includes('tokens'));
    const data = JSON.parse(await readFile(json, 'utf8'));
    assert.equal(data.sessions.length, 3);
    assert.ok(data.redacted);
    for (const file of [out, json, rules]) {
        const s = await readFile(file, 'utf8');
        assert.ok(!s.includes('SECRET_PROMPT_SENTINEL'));
        assert.ok(!s.includes(d.home));
        assert.ok(!s.includes('private-project'));
    }
});
test('CLI rejects bad flags, overwriting logs, and overlapping outputs', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tlf-cli-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const d = await fixtures(root);
    for (const args of [['--since', 'oops'], ['--only', 'both'], ['--max-line-bytes', '0'], ['--wat'], ['--out', join(d.claude, 'report.html'), '--claude-dir', d.claude], ['--out', join(root, 'same'), '--json', join(root, 'same')]]) {
        await assert.rejects(run(process.execPath, ['dist/src/cli.js', ...args]));
    }
});
test('nine leak categories and a separate cost lever have numeric evidence on synthetic fixtures', async (t) => {
    const { analyze } = await import('../src/analyze.js');
    const root = await mkdtemp(join(tmpdir(), 'tlf-leaks-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const d = await fixtures(root);
    const a = await analyze({ claudeDir: d.claude, codexDir: d.codex, homeDir: d.home, since: Date.now() - 30 * 864e5, until: Date.now(), redact: true, maxLineBytes: 2e6, concurrency: 2, hugeOutputTokens: 10000, contextThreshold: 100000 });
    for (const category of ['mcp_schema_overhead', 'unused_mcp_servers', 'big_instruction_files', 'repeated_file_reads', 'huge_tool_outputs', 'long_context_no_compaction', 'resumed_idle_sessions', 'subagent_startup', 'expensive_model_share', 'big_baseline_per_session'])
        assert.ok([...a.leaks, ...a.costLevers].some(l => l.category === category && l.estimatedTokens > 0 && l.evidence.length), category);
    assert.ok(!a.mcps.some(m => m.name === 'mcpServers'));
    assert.equal(a.leaks.find(l => l.category === 'repeated_file_reads')!.estimatedTokens, 12000 + Math.ceil(SENTINEL.length / 4) * 7);
});
test('non-redacted reports also exclude raw fixture text', async (t) => {
    const { analyze } = await import('../src/analyze.js');
    const { renderReport, renderRules } = await import('../src/report.js');
    const root = await mkdtemp(join(tmpdir(), 'tlf-plain-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const d = await fixtures(root);
    const a = await analyze({ claudeDir: d.claude, codexDir: d.codex, homeDir: d.home, since: Date.now() - 30 * 864e5, until: Date.now(), redact: false, maxLineBytes: 2e6, concurrency: 1, hugeOutputTokens: 10000, contextThreshold: 100000 });
    for (const s of [JSON.stringify(a), renderReport(a), renderRules(a)])
        assert.ok(!s.includes('SECRET_PROMPT_SENTINEL') && !s.includes('PRIVATE_INSTRUCTION_SENTINEL'));
});
test('MCP config scopes stay within the configured project', async (t) => {
    const { localMetadata } = await import('../src/local.js');
    const { emptyStats } = await import('../src/reader.js');
    const { emptyTokens } = await import('../src/config.js');
    const root = await mkdtemp(join(tmpdir(), 'tlf-scope-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const p1 = join(root, 'p1'), p2 = join(root, 'p2');
    await mkdir(p1);
    await mkdir(p2);
    await writeFile(join(root, '.claude.json'), JSON.stringify({ projects: { [p1]: { mcpServers: { local: { env: { key: 'SECRET_PROMPT_SENTINEL' } } } } } }));
    const options = { claudeDir: '', codexDir: '', homeDir: root, since: 0, until: Date.now(), redact: false, maxLineBytes: 1024, concurrency: 1, hugeOutputTokens: 10000, contextThreshold: 100000 };
    const session = (project: string) => ({ id: project, project, source: 'claude' as const, model: 'x', tokens: emptyTokens(), turns: 1, peakContext: 0, compactions: 0, baseline: 0, baselineReplayed: 0, sidechain: false, contextTokens: 0, contextWeightedTokens: 0, baselineWeightedTokens: 0, longContextWeightedTokens: 0, highContextResponses: 0, highContextRawTokens: 0, highContextWeightedTokens: 0, longContextTokens: 0, longContextTurns: 0, idleRewriteTokens: 0, start: '', end: '' });
    const stats = { ...emptyStats(), files: 0, filesFiltered: 0, fileErrors: 0, configErrors: 0, configSkipped: 0 };
    const m = await localMetadata(options, [session(p1), session(p2)], stats);
    assert.deepEqual(m.mcps[0].projects, [p1]);
});
test('privacy scales to many paths without leaking identifiers through evidence', async () => {
    const { privacy } = await import('../src/privacy.js');
    const { analyze } = await import('../src/analyze.js');
    const a = await analyze({ claudeDir: '/no-such-source', codexDir: '/no-such-source', homeDir: '/no-such-home', since: 0, until: Date.now(), redact: true, maxLineBytes: 1024, concurrency: 1, hugeOutputTokens: 10000, contextThreshold: 100000 });
    a.repeatedReads = Array.from({ length: 20000 }, (_, i) => ({ source: 'claude' as const, project: '/private/acme', session: 'private-session', path: '/private/acme/src/' + i + '.ts', reads: 2, repeated: 1, estimatedTokens: 3 }));
    a.projects = [{ name: '/private/acme', tokens: a.totals, calls: 0, sessions: 1 }];
    a.sessions = [{ id: 'private-session' } as any];
    const start = Date.now();
    const safe = privacy(a, '/private');
    assert.ok(Date.now() - start < 10000);
    assert.ok(!JSON.stringify(safe).includes('/private'));
    assert.ok(safe.repeatedReads[0].path.startsWith('project-a/file-'));
});
test('sidechains outside subdirectories still receive distinct session IDs', async () => {
    const events = [{ type: 'assistant', timestamp, cwd: '/project', sessionId: 'parent', isSidechain: true, message: { id: 'm', usage: { input_tokens: 20, output_tokens: 2 } } }];
    const s = await parse(events, 'claude');
    assert.ok(s.sidechain);
    assert.notEqual(s.id, 'parent');
});
test('rg line-number flags do not consume the search pattern or file', () => {
    assert.deepEqual(shellFiles({ cmd: "rg -n 'SECRET_PATTERN' src/a.ts" }, '/project'), ['/project/src/a.ts']);
});
test('summary markers reset the uncompacted segment', async () => {
    const s = await parse([{ type: 'summary', timestamp }, { type: 'assistant', timestamp, message: { id: 'm', usage: { input_tokens: 20, output_tokens: 2 } } }], 'claude');
    assert.equal(s.compactions, 1);
    assert.equal(s.turns[0].segment, 1);
});
test('one nested MCP tool in Codex exec is attributed to its server', async () => {
 const s = await parse([{type:'response_item',timestamp,payload:{type:'custom_tool_call',name:'functions.exec',call_id:'m',input:'const r = await tools.mcp__private_co__search({query:"SECRET_PROMPT_SENTINEL"}); text(r);'}},{type:'response_item',timestamp,payload:{type:'custom_tool_call_output',call_id:'m',output:'x'.repeat(80)}}]);
 assert.equal(s.tools[0].name,'mcp__private_co__search');assert.equal(s.tools[0].server,'private_co');assert.equal(s.tools[0].resultTokens,20);
});
