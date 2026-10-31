import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures } from './fixtures/generate.js';
test('Claude usage deduplicates response IDs; tools, compaction and sidechains survive', async (t) => {
    const { parseFile } = await import('../src/parser.js');
    const f = await mkdtemp(join(tmpdir(), 'tlf-'));
    t.after(() => rm(f, { recursive: true, force: true }));
    const d = await fixtures(f);
    const s = await parseFile(join(d.claude, 'project/main.jsonl'), 'claude', { since: 0, maxLineBytes: 2e6 });
    assert.equal(s.turns.length, 8);
    assert.equal(s.turns.reduce((n, x) => n + x.tokens.output, 0), 750);
    assert.equal(s.tools.length, 7);
    assert.equal(s.reads.length, 6);
    assert.equal(s.compactions, 1);
    assert.equal(s.stats.malformed, 1);
    assert.ok(s.stats.unknown >= 1);
    const side = await parseFile(join(d.claude, 'project/subagents/agent.jsonl'), 'claude', { since: 0, maxLineBytes: 2e6 });
    assert.ok(side.sidechain);
    assert.notEqual(s.id, side.id);
});
test('Codex cached input and reasoning are subsets; duplicate counters do not add turns', async (t) => {
    const { parseFile } = await import('../src/parser.js');
    const f = await mkdtemp(join(tmpdir(), 'tlf-'));
    t.after(() => rm(f, { recursive: true, force: true }));
    const d = await fixtures(f);
    const s = await parseFile(join(d.codex, '2026/10/31/rollout-fixture.jsonl'), 'codex', { since: 0, maxLineBytes: 2e6 });
    assert.equal(s.turns.length, 3);
    assert.equal(s.turns.reduce((n, x) => n + x.tokens.total, 0), 3600);
    assert.equal(s.turns[0].tokens.input, 600);
    assert.equal(s.turns[0].tokens.cacheRead, 400);
    assert.equal(s.turns[0].tokens.reasoning, 100);
    assert.equal(s.reads.length, 3);
    assert.equal(s.compactions, 1);
});
test('bounded line reader skips giant lines and resumes; event time filter', async (t) => {
    const { parseFile } = await import('../src/parser.js');
    const f = await mkdtemp(join(tmpdir(), 'tlf-'));
    t.after(() => rm(f, { recursive: true, force: true }));
    const p = join(f, 'a.jsonl');
    await writeFile(p, 'X'.repeat(200000) + '\n' + JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'a', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n' + JSON.stringify({ type: 'assistant', timestamp: '2000-01-01T00:00:00Z', message: { id: 'b', usage: { input_tokens: 100 } } }) + '\n');
    const s = await parseFile(p, 'claude', { since: Date.now() - 100000, maxLineBytes: 1024 });
    assert.equal(s.stats.oversized, 1);
    assert.equal(s.turns.length, 1);
    assert.equal(s.turns[0].tokens.total, 12);
});
test('analysis and report remain aggregate-only, ranked, redacted and offline', async (t) => {
    const { analyze } = await import('../src/analyze.js');
    const { renderReport, renderRules } = await import('../src/report.js');
    const f = await mkdtemp(join(tmpdir(), 'tlf-'));
    t.after(() => rm(f, { recursive: true, force: true }));
    const d = await fixtures(f);
    const a = await analyze({ claudeDir: d.claude, codexDir: d.codex, homeDir: d.home, since: 0, until: Date.now() + 2e7, redact: true, maxLineBytes: 2e6, concurrency: 2, hugeOutputTokens: 10000, contextThreshold: 100000 });
    const json = JSON.stringify(a), html = renderReport(a), rules = renderRules(a);
    assert.equal(a.totals.total, 7 * (1000 + 100 + 120000) + 12000 + 30550 + 5100 + 3600);
    assert.equal(a.sessions.length, 3);
    assert.ok(a.leaks.find(x => x.category === 'repeated_file_reads')!.estimatedTokens > 0);
    assert.ok(a.leaks.some(x => x.category === 'huge_tool_outputs'));
    assert.ok(a.leaks.some(x => x.category === 'long_context_no_compaction'));
    assert.ok(a.leaks.some(x => x.category === 'unused_mcp_servers'));
    assert.ok(a.leaks.every((x, i) => i === 0 || a.leaks[i - 1].estimatedTokens >= x.estimatedTokens));
    for (const s of [json, html, rules]) {
        for (const secret of ['SECRET_PROMPT_SENTINEL', 'PRIVATE_INSTRUCTION_SENTINEL', d.home, 'private-project', 'private-company', 'session-secret', 'alice@example.test'])
            assert.ok(!s.includes(secret), secret);
        assert.ok(!/sk-[A-Za-z0-9]{10}|ghp_[A-Za-z0-9]{10}/.test(s));
    }
    assert.ok(html.includes('Redacted'));
    assert.ok(!/https?:\/\/|<link|<script\s+src/i.test(html));
    assert.ok(a.avoidablePercent <= 100);
    assert.ok(a.mcps.some(x => x.calls === 0));
});
test('mtime and project/source filters exclude irrelevant files', async (t) => {
    const { analyze } = await import('../src/analyze.js');
    const f = await mkdtemp(join(tmpdir(), 'tlf-'));
    t.after(() => rm(f, { recursive: true, force: true }));
    const d = await fixtures(f);
    await utimes(join(d.claude, 'project/main.jsonl'), new Date(0), new Date(0));
    const base = { claudeDir: d.claude, codexDir: d.codex, homeDir: d.home, since: Date.now() - 864e5, until: Date.now() + 2e7, redact: false, maxLineBytes: 2e6, concurrency: 2, hugeOutputTokens: 10000, contextThreshold: 100000 };
    const a = await analyze({ ...base, only: 'claude' });
    assert.equal(a.sessions.length, 1);
    assert.equal(a.stats.filesFiltered, 1);
    const b = await analyze({ ...base, project: 'no-such-project' });
    assert.equal(b.sessions.length, 0);
});
