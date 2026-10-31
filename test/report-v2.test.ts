import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, runInNewContext } from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyze, downsampleContext, localDay } from '../src/analyze.js';
import { renderReport } from '../src/report.js';
import { reportScript, themeScript } from '../src/report-script.js';
import { reportStyle } from '../src/report-style.js';
import { contextBands } from '../src/report-charts.js';
import { fixtures } from './fixtures/generate.js';
import type { Options } from '../src/types.js';

async function workspace(t: TestContext) {
    const root = await mkdtemp(join(tmpdir(), 'tlf-v2-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const claudeDir = join(root, 'claude'), codexDir = join(root, 'codex');
    await mkdir(claudeDir); await mkdir(codexDir);
    const start = new Date(); start.setDate(start.getDate() - 5); start.setHours(0, 0, 0, 0);
    const options: Options = { claudeDir, codexDir, homeDir: root, since: start.getTime(), until: Date.now(), redact: true, maxLineBytes: 2e6, concurrency: 2, hugeOutputTokens: 10000, contextThreshold: 150000 };
    const event = (id: number, day: number, context: number, output = 0) => {
        const date = new Date(start); date.setDate(date.getDate() + day); date.setHours(12, id % 60);
        return { type: 'assistant', timestamp: date.toISOString(), sessionId: 'private-session', cwd: '/synthetic/private-project', message: { id: 'response-' + id, usage: { input_tokens: context, output_tokens: output } } };
    };
    const put = (name: string, events: unknown[]) => writeFile(join(claudeDir, name), events.map(e => JSON.stringify(e)).join('\n'));
    return { root, options, event, put, start };
}

test('daily weighted sums, local zero days and session allocation reconcile with headline', async t => {
    const { options, event, put } = await workspace(t);
    // A 5-response, multi-day long-context session: day 1 has 20% of input/cache,
    // day 3 has 80%. Output on day 1 must not affect the avoidable allocation.
    await put('long.jsonl', [event(0, 1, 200000, 90000), ...Array.from({ length: 4 }, (_, i) => event(i + 1, 3, 200000))]);
    await put('output-only.jsonl', [event(0, 2, 0, 10000)]);
    const a = await analyze(options);
    assert.equal(a.days.length, 6);
    assert.equal(a.days.reduce((n, d) => n + d.tokens.weighted, 0), a.totals.weighted);
    assert.ok(Math.abs(a.days.reduce((n, d) => n + d.avoidableTokens, 0) - a.avoidableTokens) < 1e-7);
    assert.equal(a.days[1].avoidableTokens, a.avoidableTokens * .2);
    assert.equal(a.days[3].avoidableTokens, a.avoidableTokens * .8);
    for (const i of [0, 4]) assert.equal(a.days[i].tokens.total, 0);
    for (const i of [0, 2, 4, 5]) assert.equal(a.days[i].avoidableTokens, 0);
    assert.ok(a.days.every(d => d.avoidableTokens >= 0 && d.avoidableTokens <= d.tokens.weighted));
    assert.ok(a.days.every((d, i) => !i || d.name > a.days[i - 1].name));
    const json = JSON.parse(JSON.stringify(a));
    assert.equal(json.days[3].avoidableTokens, a.avoidableTokens * .8);
});

test('local day keys follow calendar dates across month and year boundaries', () => {
    assert.equal(localDay(new Date(2026, 0, 1, 0, 1).getTime()), '2026-01-01');
    assert.equal(localDay(new Date(2025, 11, 31, 23, 59).getTime()), '2025-12-31');
});

test('sparkline downsampling caps at 40 numeric points and preserves endpoints', () => {
    for (const length of [0, 1, 39, 40, 41, 800, 10000]) {
        const input = Array.from({ length }, (_, i) => i * 37);
        const points = downsampleContext(input);
        assert.equal(points.length, Math.min(length, 40));
        assert.ok(points.every(Number.isFinite));
        if (length) { assert.equal(points[0], input[0]); assert.equal(points.at(-1), input.at(-1)); }
        assert.notEqual(points, input);
    }
});

test('only listed top offenders retain numeric sparkline data using existing redacted aliases', async t => {
    const { options, event, put } = await workspace(t);
    for (let s = 0; s < 9; s++) {
        await put(`long-${s}.jsonl`, Array.from({ length: 65 }, (_, i) => {
            const e = event(i, 1, 200000 + s * 10000); e.sessionId = 'secret-session-' + s;
            // Ordered timestamps let every response survive parser deduplication.
            e.timestamp = new Date(new Date(e.timestamp).getTime() + i * 60000).toISOString();
            return e;
        }));
    }
    const a = await analyze(options);
    const listed = a.sessions.filter(s => s.longContextTokens > 0).sort((a, b) => b.longContextWeightedTokens - a.longContextWeightedTokens).slice(0, 6);
    assert.equal(a.sessions.filter(s => s.contextSparkline).length, 6);
    for (const s of a.sessions) {
        assert.equal(!!s.contextSparkline, listed.includes(s));
        if (s.contextSparkline) {
            assert.equal(s.contextSparkline.length, 40);
            assert.ok(s.contextSparkline.every(v => typeof v === 'number' && Number.isFinite(v)));
            assert.match(s.id, /^session-\d+$/);
            assert.match(s.project, /^project-/);
        }
    }
    const html = renderReport(a), json = JSON.stringify(a);
    for (const secret of ['secret-session-', 'private-project', options.homeDir, '@']) assert.ok(!json.includes(secret));
    assert.ok(!html.includes('secret-session-'));
    assert.match(html, /Context per response/);
});

test('report v2 and checked-in sample forbid network surfaces and retain one shared tooltip', async t => {
    const { root, options } = await workspace(t), f = await fixtures(root);
    const a = await analyze({ ...options, claudeDir: f.claude, codexDir: f.codex, homeDir: f.home });
    for (const html of [renderReport(a), await readFile('docs/sample-report.html', 'utf8')]) {
        assert.doesNotMatch(html, /https?:\/\/|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bimport\s*\(|src\s*=\s*["']http|@import|url\s*\(\s*["']?http|<link\b|<script\s+src/i);
        assert.match(html, /connect-src 'none'/);
        assert.equal([...html.matchAll(/id="chart-tooltip"/g)].length, 1);
        const marks = [...html.matchAll(/<[^>]+data-tip="[^"]*"[^>]*>/g)];
        assert.ok(marks.length > 20);
        for (const [mark] of marks) { assert.match(mark, /tabindex="0"/); assert.match(mark, /aria-label="[^"<>]+"/); }
        for (const content of ['SECRET_PROMPT_SENTINEL', 'PRIVATE_INSTRUCTION_SENTINEL', 'private-project', 'session-secret', 'alice@example.test']) assert.ok(!html.includes(content));
        for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(script[1]);
    }
});

test('theme boot respects stored preference, system preference and unavailable storage', () => {
    for (const saved of ['light', 'dark', null, 'invalid']) for (const light of [false, true]) {
        const document = { documentElement: { dataset: {} as Record<string, string> } };
        runInNewContext(themeScript, { document, localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: light }) });
        assert.equal(document.documentElement.dataset.theme, saved === 'light' || saved === 'dark' ? saved : light ? 'light' : 'dark');
    }
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(themeScript, { document, get localStorage() { throw new Error('blocked'); } });
    assert.equal(document.documentElement.dataset.theme, 'dark');
});

test('inline JS/CSS stays small and final headline values are rendered without JS', async t => {
    const { options, put, event } = await workspace(t);
    await put('small.jsonl', [event(0, 1, 1000)]);
    const html = renderReport(await analyze(options));
    const size = Buffer.byteLength(reportStyle + reportScript + themeScript);
    assert.ok(size < 300000, `Inline template is ${size} bytes`);
    assert.match(html, /id="headline-total" data-count="1000">1\.0k</);
    assert.match(html, /id="headline-percent" data-count="0">~0%/);
    assert.match(reportScript, /requestAnimationFrame/);
    assert.match(reportStyle, /prefers-reduced-motion:reduce/);
});

test('empty and single-day reports contain finite chart geometry', async t => {
    const { options } = await workspace(t);
    const a = await analyze({ ...options, since: Date.now() - 1000 });
    assert.equal(a.days.length, 1);
    assert.equal(a.days[0].avoidableTokens, 0);
    assert.doesNotMatch(renderReport(a), /NaN|Infinity/);
});

function scriptHarness(reduce = false, observer?: unknown) {
    const nodes = new Map<string, any>(), listeners = new Map<string, (e: any) => void>();
    const frames: ((time: number) => void)[] = [];
    const element = (content = '', dataset: Record<string, string> = {}) => {
        const classes = new Set<string>(), events = new Map<string, () => void>(), attrs = new Map<string, string>();
        return { textContent: content, dataset, hidden: true, style: {} as Record<string, string>,
            classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
            addEventListener: (name: string, cb: () => void) => events.set(name, cb),
            setAttribute: (name: string, value: string) => attrs.set(name, value), attrs, events,
            getBoundingClientRect: () => ({ left: 10, top: 1100, bottom: 1150, width: 180, height: 42 }) };
    };
    nodes.set('theme-toggle', element()); nodes.set('headline-total', element('3.62B', { count: '3620000000' }));
    nodes.set('headline-percent', element('~25.9%', { count: '25.9' })); nodes.set('sweep-path', element()); nodes.set('chart-tooltip', element());
    const root = element('', { theme: 'dark' }), card = element();
    const document = { documentElement: root, getElementById: (id: string) => nodes.get(id), querySelectorAll: (selector: string) => selector === '.leak' || selector === '.reveal-pending' && card.classList.contains('reveal-pending') ? [card] : [], addEventListener: (name: string, cb: (e: any) => void) => listeners.set(name, cb) };
    const media = { matches: reduce, addEventListener: (_name: string, cb: (e: any) => void) => listeners.set('motion-change', cb) };
    runInNewContext(reportScript, { document, window: { addEventListener: () => {} }, localStorage: { setItem: () => { throw new Error('blocked'); } }, matchMedia: () => media, requestAnimationFrame: (cb: (time: number) => void) => { frames.push(cb); return frames.length; }, cancelAnimationFrame: () => { frames.length = 0; }, innerWidth: 430, innerHeight: 800, IntersectionObserver: observer });
    return { nodes, root, card, listeners, frames };
}

test('count-up sequences totals before percentage, and reduced motion leaves final HTML intact', () => {
    const h = scriptHarness();
    assert.ok(h.root.classList.contains('motion'));
    h.frames.shift()!(0);
    assert.equal(h.nodes.get('headline-total').textContent, '0');
    h.frames.shift()!(1400);
    assert.equal(h.nodes.get('headline-total').textContent, '3.62B');
    assert.equal(h.nodes.get('headline-percent').textContent, '~0.0%');
    h.frames.shift()!(2700);
    assert.equal(h.nodes.get('headline-percent').textContent, '~25.9%');
    assert.equal(h.frames.length, 0);
    const reduced = scriptHarness(true);
    assert.equal(reduced.frames.length, 0);
    assert.equal(reduced.root.classList.contains('motion'), false);
    assert.equal(reduced.nodes.get('headline-total').textContent, '3.62B');
    assert.equal(reduced.nodes.get('headline-percent').textContent, '~25.9%');
});

test('theme toggle tolerates blocked storage; missing or failing observer keeps cards visible', () => {
    for (const observer of [undefined, class { constructor() { throw new Error('unavailable'); } }]) {
        const h = scriptHarness(false, observer);
        h.nodes.get('theme-toggle').events.get('click')();
        assert.equal(h.root.dataset.theme, 'light');
        assert.equal(h.nodes.get('theme-toggle').attrs.get('aria-label'), 'Switch to dark mode');
        assert.equal(h.card.classList.contains('reveal-pending'), false);
    }
});

test('switching to reduced motion cancels animation and exposes the final chart state', () => {
    const h = scriptHarness();
    h.frames.shift()!(0);
    h.listeners.get('motion-change')!({ matches: true });
    assert.equal(h.frames.length, 0);
    assert.equal(h.nodes.get('headline-total').textContent, '3.62B');
    assert.equal(h.nodes.get('headline-percent').textContent, '~25.9%');
    assert.equal(h.root.classList.contains('motion'), false);
    assert.match(h.nodes.get('sweep-path').attrs.get('d'), /119\.99/);
});

test('shared tooltip supports focus, stays inside mobile viewport and dismisses with Escape', () => {
    const h = scriptHarness(true);
    const mark: any = { dataset: { tip: '2026-10-30: 12,000 weighted tokens' }, closest: () => mark, classList: { remove: () => {} }, getBoundingClientRect: () => ({ left: 410, bottom: 790, width: 20 }) };
    h.listeners.get('focusin')!({ target: mark });
    const tooltip = h.nodes.get('chart-tooltip');
    assert.equal(tooltip.hidden, false);
    assert.equal(tooltip.textContent, mark.dataset.tip);
    assert.ok(parseFloat(tooltip.style.left) + 180 <= 430);
    assert.ok(parseFloat(tooltip.style.top) + 42 <= 800);
    h.listeners.get('keydown')!({ key: 'Escape' });
    assert.equal(tooltip.hidden, true);
});

test('daily allocation keeps separate log-file budgets even when session IDs collide', async t => {
    const { options, event, put } = await workspace(t);
    // Both logs deliberately share private-session. Their supported opportunities differ.
    await put('one.jsonl', Array.from({ length: 5 }, (_, i) => event(i, 1, 200000)));
    await put('two.jsonl', Array.from({ length: 5 }, (_, i) => event(i, 3, 300000)));
    const a = await analyze(options);
    assert.equal(a.days[1].avoidableTokens, 125000);
    assert.equal(a.days[3].avoidableTokens, 375000);
    assert.equal(a.days.reduce((n, d) => n + d.avoidableTokens, 0), a.avoidableTokens);
});

test('fractional daily allocations reconcile headline rounding and keep zero days empty', async t => {
    const { options, event, put } = await workspace(t);
    await put('fractional.jsonl', Array.from({ length: 5 }, (_, i) => {
        const e = event(i, i < 2 ? 1 : 3, 0);
        e.message.usage = { cache_read_input_tokens: 200001, cache_creation_input_tokens: 1 } as any;
        return e;
    }));
    const a = await analyze(options);
    assert.ok(Math.abs(a.days.reduce((n, d) => n + d.avoidableTokens, 0) - a.avoidableTokens) < 1e-7);
    assert.ok(Math.abs(a.days.reduce((n, d) => n + d.tokens.weighted, 0) - a.totals.weighted) < 1e-7);
    assert.ok(a.days.every(d => d.tokens.weighted || d.avoidableTokens === 0));
    assert.equal(a.range.timeZone, 'local');
});

function evidenceTable(html: string, heading: string): string {
    return html.split(`<h3>${heading}</h3>`)[1].split('</section>')[0];
}

test('list cells show at most five escaped items and the remaining count', async t => {
    const { options } = await workspace(t), a = await analyze(options);
    for (const count of [0, 1, 5, 8]) {
        a.mcps = [{ name: 'server', source: 'claude', configured: true, calls: 12345, projects: Array.from({ length: count }, (_, i) => `item-${i + 1}<"&>`), estimatedSchemaTokens: 0, estimatedResentTokens: 0, resultTokens: 0 }];
        const html = evidenceTable(renderReport(a), 'MCP inventory · configured vs observed');
        for (let i = 1; i <= Math.min(5, count); i++) assert.ok(html.includes(`item-${i}&lt;&quot;&amp;&gt;`));
        assert.equal(html.includes('+3 more'), count === 8);
        assert.doesNotMatch(html, /item-[678]/);
        assert.doesNotMatch(html, /item-\d+<"&>/);
        assert.match(html, /<td class="numeric">12,345<\/td>/);
        assert.match(html, /class="cell-text" title="server">server<\/span>/);
    }
});

test('long tables keep ten preview rows and disclose every remaining row without duplication', async t => {
    const { options } = await workspace(t), a = await analyze(options);
    for (const count of [0, 1, 10, 11, 25]) {
        a.repeatedFiles = Array.from({ length: count }, (_, i) => ({ path: `file-${i + 1}.ts`, projects: [], sessions: 1, reads: 30 - i, repeated: 29 - i, estimatedTokens: 1000 }));
        const html = evidenceTable(renderReport(a), 'Top files by repeat count');
        const [preview, rest = ''] = html.split('<details class="table-details">');
        assert.equal([...preview.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0][1].match(/<tr>/g)?.length, Math.max(1, Math.min(10, count)));
        assert.equal(!!rest, count > 10);
        if (count > 10) {
            assert.match(rest, new RegExp(`^<summary>Show all ${count} rows</summary>`));
            assert.doesNotMatch(rest, /<details[^>]*\bopen/);
            assert.equal(rest.match(/<tbody>([\s\S]*?)<\/tbody>/)![1].match(/<tr>/g)?.length, count - 10);
            assert.ok(!preview.includes('>file-11.ts<'));
            assert.ok(rest.includes('>file-11.ts<'));
        }
        for (let i = 1; i <= count; i++) assert.equal(html.split(`>file-${i}.ts</span>`).length - 1, 1);
        if (!count) assert.match(html, /No matching activity/);
    }
});

test('redacted HTML and JSON conceal the local IANA time zone while ordinary JSON retains it', async t => {
    const { options } = await workspace(t);
    // Exercise a non-UTC machine even when the test runner itself uses UTC.
    const script = `import { analyze } from './dist/src/analyze.js';
import { renderReport } from './dist/src/report.js';
const options = JSON.parse(process.argv[1]);
const a = await analyze(options), plain = await analyze({ ...options, redact: false });
console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, json: JSON.stringify(a), html: renderReport(a), plainZone: plain.range.timeZone }));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(options)], { env: { ...process.env, TZ: 'America/New_York' }, maxBuffer: 2e6 });
    const { zone, json, html, plainZone } = JSON.parse(stdout);
    assert.notEqual(zone, 'UTC');
    assert.equal(plainZone, zone);
    assert.equal(JSON.parse(json).range.timeZone, 'local');
    for (const artifact of [json, html]) {
        assert.ok(!artifact.includes(zone));
        const currentZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (currentZone !== 'UTC') assert.ok(!artifact.includes(currentZone));
    }
    assert.match(html, /Local calendar days \(local time zone\)/);
    assert.doesNotMatch(await readFile('docs/sample-report.html', 'utf8'), /Local calendar days \((?!UTC\)|local time zone\))[^)]+\)/);
});

test('context bands use solid palette fills and a separate stripe overlay after the checkpoint', async t => {
    const { options } = await workspace(t), a = await analyze(options);
    a.contextBands.forEach(b => { b.responses = 10; b.sessions = 2; });
    const html = contextBands(a);
    const fills = [...html.matchAll(/<rect class="context-band"[^>]*fill="([^"]+)"[^>]*>/g)];
    assert.deepEqual(fills.map(m => m[1]), ['#3b82f6', '#a855f7', '#ff8a3d', '#ff2d78']);
    for (const [rect] of fills) assert.doesNotMatch(rect, /opacity/);
    assert.match(html, /<pattern id="context-checkpoint-stripes"/);
    assert.match(html, /<rect[^>]*x="304"[^>]*width="68"[^>]*fill="url\(#context-checkpoint-stripes\)"/);
    assert.equal([...html.matchAll(/fill="url\(#context-checkpoint-stripes\)"/g)].length, 3);
});
