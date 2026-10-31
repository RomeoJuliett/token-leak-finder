import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyze } from '../src/analyze.js';
import { renderReport } from '../src/report.js';

async function workspace(t: any) {
    const root = await mkdtemp(join(tmpdir(), 'tlf-pass2-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const claudeDir = join(root, 'claude'), codexDir = join(root, 'codex');
    await mkdir(claudeDir); await mkdir(codexDir);
    const options = { claudeDir, codexDir, homeDir: root, since: Date.now() - 864e5, until: Date.now() + 1000, redact: true, maxLineBytes: 2e6, concurrency: 3, hugeOutputTokens: 10000, contextThreshold: 150000 };
    const put = async (name: string, events: unknown[], source = 'claude') => {
        const path = join(source === 'claude' ? claudeDir : codexDir, name);
        await writeFile(path, events.map(e => JSON.stringify(e)).join('\n') + '\n'); return path;
    };
    return { options, put };
}
const timestamp = new Date().toISOString();
const response = (id: number, usage: object, model = 'claude-opus-test') => ({ type: 'assistant', timestamp, cwd: '/synthetic/private-project', message: { id: 'r' + id, model, usage } });

test('context savings count only excess with proportional input/cache weights', async t => {
    const { options, put } = await workspace(t);
    await put('usage.jsonl', Array.from({ length: 5 }, (_, i) => response(i, { input_tokens: 20000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 80000, output_tokens: 1000 })));
    const a: any = await analyze(options);
    const l = a.leaks.find((l: any) => l.category === 'long_context_no_compaction');
    assert.equal(l.estimatedTokens, 162500); // 5 × 50k / 200k × (20k + 10k + 100k)
    assert.equal(l.weightedTokens, 162500);
    assert.equal(l.rawEstimatedTokens, 250000);
    assert.equal(a.totals.weighted, 675000);
    assert.equal(l.percent, 24.1);
    assert.equal(a.avoidableTokens, 81250);
    assert.equal(a.avoidablePercent, 12);
    assert.equal(a.contextBands.reduce((n: number, b: any) => n + b.responses, 0), 5);
});

test('source coverage distinguishes files, positive usage and tool-only sessions without source dedupe', async t => {
    const { options, put } = await workspace(t);
    await put('same.jsonl', [response(0, { input_tokens: 10 })]);
    await put('zero.jsonl', [response(0, { input_tokens: 0 })]);
    await put('tools.jsonl', [{ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id: 'c', name: 'Read', input: { file_path: '/synthetic/a.ts' } }] } }]);
    await put('empty.jsonl', []);
    const old = await put('old.jsonl', [response(0, { input_tokens: 100 })]);
    await utimes(old, new Date(0), new Date(0));
    await put('rollout-same.jsonl', [{ type: 'session_meta', timestamp, payload: { id: 'same' } }, { type: 'token_usage_record', timestamp, payload: { response_id: 'x', usage: { input_tokens: 20 } } }], 'codex');
    const a: any = await analyze(options);
    assert.equal(a.sources.claude.filesScanned, 4);
    assert.equal(a.sources.codex.filesScanned, 1);
    assert.equal(a.sources.claude.sessionsWithUsage, 1);
    assert.equal(a.sources.codex.sessionsWithUsage, 1);
    assert.equal(a.sources.claude.toolOnlySessions, 1);
    assert.equal(a.totals.total, 30);
    assert.equal(a.stats.files, 5);
});

test('context bands and >500k scenario make 1M context sessions concrete', async t => {
    const { options, put } = await workspace(t);
    const sizes = [99999, 100000, 199999, 200000, 500000, 500001, 600000, 700000, 800000, 967000];
    await put('large.jsonl', sizes.map((n, i) => response(i, { cache_read_input_tokens: n })));
    const a: any = await analyze(options);
    assert.deepEqual(a.contextBands.map((b: any) => b.responses), [1, 2, 2, 5]);
    assert.equal(a.highContext.sessions, 1);
    assert.equal(a.highContext.responses, 5);
    assert.equal(a.highContext.compactAt, 150000);
    assert.equal(a.highContext.rawEstimatedTokens, 2817001);
    assert.equal(a.highContext.weightedTokens, 281700.1);
    assert.ok(a.leaks.find((l: any) => l.category === 'long_context_no_compaction').evidence.some((e: string) => e.includes('967000')));
});

test('headline dedupes overlapping signals per session and sums disjoint sessions', async t => {
    const { options, put } = await workspace(t);
    for (const name of ['a.jsonl', 'b.jsonl']) {
        const events: any[] = [];
        for (let i = 0; i < 5; i++) {
            const e: any = response(i, { cache_read_input_tokens: 200000 });
            e.message.content = [{ type: 'tool_use', id: 'c' + i, name: 'Read', input: { file_path: '/synthetic/a.ts' } }];
            events.push(e, { type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: 'c' + i, content: 'X'.repeat(48000) }] } });
        }
        await put(name, events);
    }
    const a: any = await analyze(options);
    // Per session max(25k context excess, 48k rereads, 60k huge outputs) × 50%.
    assert.equal(a.avoidableTokens, 60000);
    assert.equal(a.avoidableRawTokens, 60000);
    assert.equal(a.avoidablePercent, 30);
    assert.equal(a.avoidableContributions.length, 2);
    assert.ok(a.avoidableContributions.every((c: any) => c.category === 'huge_tool_outputs' && c.weightedTokens === 30000));
});

test('top-tier detection names actual models and stays outside leaks and headline', async t => {
    const { options, put } = await workspace(t);
    await put('models.jsonl', ['claude-opus-new', 'gpt-6.1-sol:high', 'future:xhigh', 'gpt-6.1-sol:medium', 'custom-premium'].map((m, i) => response(i, { input_tokens: 100 }, m)));
    const a: any = await analyze(options);
    assert.ok(!a.leaks.some((l: any) => l.category === 'expensive_model_share'));
    assert.equal(a.avoidableTokens, 0);
    const lever = a.costLevers[0];
    assert.equal(lever.weightedTokens, 300);
    assert.equal(lever.percent, 60);
    assert.ok(lever.why.includes('gpt-6.1-sol:high'));
    assert.ok(!lever.why.includes('GPT-5'));
    const custom: any = await analyze({ ...options, topTierPatterns: ['custom-*'] } as any);
    assert.equal(custom.costLevers[0].weightedTokens, 100);
});

test('report exposes evidence, snippets, weighted labels and separate cost levers offline', async t => {
    const { fixtures } = await import('./fixtures/generate.js');
    const { options } = await workspace(t);
    const f = await fixtures(options.homeDir);
    const a: any = await analyze({ ...options, claudeDir: f.claude, codexDir: f.codex, homeDir: f.home, since: options.until - 30 * 864e5, contextThreshold: 100000 });
    const html = renderReport(a);
    assert.ok(html.includes('limit-weighted tokens (estimate)'));
    assert.ok(html.indexOf('Cost levers') > html.indexOf('Top leaks'));
    assert.ok(html.includes('Context bands'));
    assert.ok(html.includes('Calls in 30 days'));
    assert.ok(html.includes('Top files by repeat count'));
    assert.ok(!html.includes('<details><summary>Evidence'));
    // Permit only the offline SVG favicon, retaining the network-surface guard.
    assert.ok(!/https?:\/\/|<link|<script\s+src/i.test(html.replace(/<link rel="icon" href="data:image\/svg\+xml,[^"<>]+">/g, '')));
    assert.ok(a.repeatedFiles[0].repeated >= a.repeatedFiles.at(-1).repeated);
    for (const leak of a.leaks) {
        assert.ok(leak.fix && leak.snippet && leak.evidence.length);
        assert.ok(leak.weightedTokens <= a.totals.weighted);
    }
});

test('unmeasured replay diagnostics cannot increase the headline or exceed observed context', async t => {
    const { options, put } = await workspace(t);
    await writeFile(join(options.homeDir, '.claude.json'), JSON.stringify({ mcpServers: { one: {}, two: {}, three: {} } }));
    await put('small.jsonl', [response(0, { input_tokens: 100 })]);
    const a = await analyze(options);
    assert.equal(a.avoidableTokens, 0);
    assert.ok(a.leaks.some(l => l.category === 'mcp_schema_overhead'));
    assert.ok(a.leaks.every(l => l.weightedTokens <= 100));
    assert.equal(a.avoidableContributions.length, 0);
});

test('compaction splits segments before the minimum large-response count', async t => {
    const { options, put } = await workspace(t);
    await put('compacted.jsonl', [
        ...Array.from({ length: 4 }, (_, i) => response(i, { cache_read_input_tokens: 200000 })),
        { type: 'system', subtype: 'compact_boundary', timestamp },
        ...Array.from({ length: 4 }, (_, i) => response(i + 4, { cache_read_input_tokens: 200000 }))
    ]);
    const a = await analyze(options);
    assert.ok(!a.leaks.some(l => l.category === 'long_context_no_compaction'));
    assert.equal(a.avoidableTokens, 0);
});

test('fractional weighted budgets never round cards above observed usage or 100 percent', async t => {
    const { options, put } = await workspace(t);
    await writeFile(join(options.homeDir, '.claude.json'), JSON.stringify({ mcpServers: { one: {} } }));
    await put('fractional.jsonl', [response(0, { cache_creation_input_tokens: 1 })]);
    const a = await analyze(options);
    assert.equal(a.totals.weighted, 1.25);
    for (const card of [...a.leaks, ...a.costLevers]) {
        assert.ok(card.weightedTokens <= a.totals.weighted);
        assert.ok(card.percent <= 100);
    }
});
