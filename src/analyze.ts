import { emptyStats } from './reader.js';
import { parseFile } from './parser.js';
import { discover, localMetadata } from './local.js';
import { privacy } from './privacy.js';
import { ESTIMATES, emptyTokens, addTokens } from './config.js';
import type { Analysis, Options, Group, Tokens, SessionSummary, Leak } from './types.js';
const round = (n: number) => Math.round(n * 10) / 10;
export async function analyze(o: Options): Promise<Analysis> {
    const a: Analysis = { version: '0.1.0', redacted: o.redact, range: { since: new Date(o.since).toISOString(), until: new Date(o.until).toISOString(), days: Math.ceil((o.until - o.since) / 86400000) }, sources: { claude: 0, codex: 0 }, totals: emptyTokens(), avoidableTokens: 0, avoidablePercent: 0, sessions: [], projects: [], models: [], tools: [], days: [], mcps: [], instructions: [], repeatedReads: [], hugeOutputs: [], leaks: [], stats: { ...emptyStats(), files: 0, filesFiltered: 0, fileErrors: 0, configErrors: 0, configSkipped: 0 }, estimates: { ...ESTIMATES, contextThreshold: o.contextThreshold, hugeOutputTokens: o.hugeOutputTokens, maxLineBytes: o.maxLineBytes }, notes: [
            'Usage turns mean metered API responses, not user messages. All token totals include cache traffic; reasoning is a subset of output and is never added twice.',
            'Limit-weighted tokens are an estimate, not provider quota rules, money or exact savings. Weights: fresh input 1, output 5, cache read 0.1, cache write 1.25.',
            'Tool output and file-read sizes use chars / 4. Shell file inference is conservative. Repeated reads can be necessary after edits.',
            'Leak estimates overlap and are not additive. The headline uses the largest single actionable estimate, capped at total tokens; it is an opportunity signal, not verified avoidable usage.',
            'MCP schema costs assume 1,000 tokens per configured server per metered response. Actual schemas, lazy loading and enabled scope are unknown. Config files reflect current state, not history.',
            'Instruction sizes are byte counts / 4; assumed per-response replay is an upper-bound estimate. Baseline uses first observed fresh input plus cache write, excluding cache hits; partial sessions may not show startup.',
            'Unknown, malformed, oversized and untimed lines are counted. Untimed usage is excluded. File mtime prefilter can omit historical files with stale modification times.',
            'Codex cumulative deltas take precedence over last_token_usage; first in-range counts use last usage when possible. Modern token_usage_record is used only when no in-range token_count events exist; partial mixed-format coverage can undercount.'
        ] };
    const jobs: {
        file: string;
        source: 'claude' | 'codex';
    }[] = [];
    if (o.only !== 'codex')
        jobs.push(...await discover(o.claudeDir, 'claude', o.since, a.stats));
    if (o.only !== 'claude')
        jobs.push(...await discover(o.codexDir, 'codex', o.since, a.stats));
    jobs.sort((x, y) => x.file.localeCompare(y.file));
    a.stats.files = jobs.length;
    const groups = { projects: new Map<string, Group>(), models: new Map<string, Group>(), tools: new Map<string, Group>(), days: new Map<string, Group>() };
    function group(type: keyof typeof groups, name: string, tokens: Tokens, calls = 0, session = false) { let g = groups[type].get(name); if (!g) {
        g = { name, tokens: emptyTokens(), calls: 0, sessions: 0 };
        groups[type].set(name, g);
    } addTokens(g.tokens, tokens); g.calls += calls; if (session)
        g.sessions++; }
    let next = 0, completed = 0;
    async function worker() {
        while (next < jobs.length) {
            const job = jobs[next++];
            const s = await parseFile(job.file, job.source, o);
            for (const k of Object.keys(s.stats) as (keyof typeof s.stats)[])
                a.stats[k] += s.stats[k];
            if (s.stats.errors)
                a.stats.fileErrors++;
            if ((s.turns.length || s.tools.length) && (!o.project || s.project.toLowerCase().includes(o.project.toLowerCase()))) {
                a.sources[s.source]++;
                const tokens = emptyTokens();
                const models = new Set<string>(), daySet = new Set<string>();
                for (const t of s.turns) {
                    addTokens(tokens, t.tokens);
                    group('models', t.model, t.tokens, 0, !models.has(t.model));
                    models.add(t.model);
                    const day = new Date(t.timestamp).toISOString().slice(0, 10);
                    group('days', day, t.tokens, 0, !daySet.has(day));
                    daySet.add(day);
                }
                addTokens(a.totals, tokens);
                group('projects', s.project, tokens, 0, true);
                const first = s.turns[0];
                const baseline = first ? first.tokens.input + first.tokens.cacheWrite : 0;
                const bySegment = new Map<number, typeof s.turns>();
                for (const t of s.turns) {
                    if (t.context > o.contextThreshold) {
                        const list = bySegment.get(t.segment) ?? [];
                        list.push(t);
                        bySegment.set(t.segment, list);
                    }
                }
                const long = [...bySegment.values()].filter(v => v.length >= ESTIMATES.longContextMinTurns).flat();
                let idle = 0;
                for (let i = 1; i < s.turns.length; i++)
                    if (s.turns[i].timestamp - s.turns[i - 1].timestamp > ESTIMATES.idleGapMs && s.turns[i].tokens.cacheWrite >= ESTIMATES.idleRewriteMinTokens)
                        idle += s.turns[i].tokens.cacheWrite;
                const sum: SessionSummary = { id: s.id, source: s.source, project: s.project, model: models.size === 1 ? [...models][0] : models.size ? 'multiple' : 'unknown', tokens, turns: s.turns.length, peakContext: s.turns.reduce((n, t) => Math.max(n, t.context), 0), compactions: s.compactions, baseline, baselineReplayed: baseline * s.turns.length, sidechain: s.sidechain, longContextTokens: long.reduce((n, t) => n + t.tokens.input + t.tokens.cacheRead, 0), longContextTurns: long.length, idleRewriteTokens: idle, start: first ? new Date(first.timestamp).toISOString() : 'unknown', end: s.turns.length ? new Date(s.turns.at(-1)!.timestamp).toISOString() : 'unknown' };
                a.sessions.push(sum);
                const toolNames = new Set<string>();
                for (const c of s.tools) {
                    const t = emptyTokens();
                    t.output = c.resultTokens;
                    t.total = c.resultTokens;
                    t.weighted = c.resultTokens;
                    group('tools', c.name, t, 1, !toolNames.has(c.name));
                    toolNames.add(c.name);
                    if (c.server) {
                        let m = a.mcps.find(v => v.name === c.server && v.source === s.source);
                        if (!m) {
                            m = { name: c.server, source: s.source, projects: [], configured: false, calls: 0, estimatedSchemaTokens: 0, estimatedResentTokens: 0, resultTokens: 0 };
                            a.mcps.push(m);
                        }
                        m.calls++;
                        m.resultTokens += c.resultTokens;
                        if (!m.projects.includes(s.project))
                            m.projects.push(s.project);
                    }
                    if (c.resultTokens > o.hugeOutputTokens)
                        a.hugeOutputs.push({ project: s.project, session: s.id, tool: c.name, estimatedTokens: c.resultTokens });
                }
                const reads = new Map<string, {
                    count: number;
                    waste: number;
                }>();
                for (const r of s.reads) {
                    const prev = reads.get(r.path) ?? { count: 0, waste: 0 };
                    if (prev.count)
                        prev.waste += r.tokens;
                    prev.count++;
                    reads.set(r.path, prev);
                }
                for (const [path, r] of reads)
                    if (r.count > 1)
                        a.repeatedReads.push({ project: s.project, session: s.id, path, reads: r.count, repeated: r.count - 1, estimatedTokens: r.waste });
            }
            completed++;
            o.progress?.(completed, jobs.length, a.stats.bytes);
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(16, o.concurrency, jobs.length)) }, worker));
    for (const type of Object.keys(groups) as (keyof typeof groups)[])
        a[type] = [...groups[type].values()].sort((x, y) => y.tokens.total - x.tokens.total || x.name.localeCompare(y.name));
    a.sessions.sort((x, y) => y.tokens.total - x.tokens.total || x.id.localeCompare(y.id));
    a.repeatedReads.sort((x, y) => y.estimatedTokens - x.estimatedTokens);
    a.hugeOutputs.sort((x, y) => y.estimatedTokens - x.estimatedTokens);
    const metadata = await localMetadata(o, a.sessions, a.stats);
    a.instructions = metadata.instructions;
    for (const m of metadata.mcps) {
        const old = a.mcps.find(v => v.name === m.name && v.source === m.source);
        if (old) {
            old.configured = true;
            old.projects = [...new Set([...old.projects, ...m.projects])];
        }
        else
            a.mcps.push(m);
    }
    for (const m of a.mcps)
        if (m.configured) {
            m.estimatedSchemaTokens = ESTIMATES.schemaTokensPerServer;
            m.estimatedResentTokens = m.estimatedSchemaTokens * a.sessions.filter(s => s.source === m.source && m.projects.includes(s.project)).reduce((n, s) => n + s.turns, 0);
        }
    a.mcps.sort((x, y) => y.calls - x.calls || x.name.localeCompare(y.name));
    const safe = privacy(a, o.homeDir);
    detectLeaks(safe);
    return safe;
}
function detectLeaks(a: Analysis): void {
    const total = a.totals.total;
    function leak(category: string, title: string, estimatedTokens: number, why: string, fix: string, evidence: string[], snippet: string, confidence: Leak['confidence'] = 'heuristic') { if (estimatedTokens <= 0)
        return; a.leaks.push({ category, title, estimatedTokens: Math.round(estimatedTokens), percent: total ? round(estimatedTokens / total * 100) : 0, why, fix, evidence: evidence.slice(0, 8), snippet, confidence }); }
    const scope = (sessions: SessionSummary[]) => sessions.slice(0, 5).map(s => s.project + ' · ' + s.id + ' · ' + s.turns + ' responses');
    const configured = a.mcps.filter(m => m.configured), unused = configured.filter(m => m.calls <= ESTIMATES.rarelyUsedCalls);
    leak('mcp_schema_overhead', 'MCP schemas travel with context', configured.reduce((n, m) => n + m.estimatedResentTokens, 0), `${configured.length} configured servers may add tool schemas to every response. Schema size is assumed, not measured.`, `Review MCP servers per project; keep only the ones needed for the current task. Budget ~${ESTIMATES.schemaTokensPerServer} tokens per server per response until measured.`, configured.map(m => `${m.name}: ${m.calls} calls; ~${m.estimatedSchemaTokens} tokens/response; ${m.projects.slice(0, 3).join(', ')}`), 'Enable only task-relevant MCP servers. Disable the rest in the project MCP settings.');
    leak('unused_mcp_servers', 'Configured MCP servers barely used', unused.reduce((n, m) => n + m.estimatedResentTokens, 0), `${unused.length} configured servers have at most ${ESTIMATES.rarelyUsedCalls} calls in this date range. They may still add schema overhead.`, `Disable ${unused.slice(0, 4).map(m => m.name).join(', ')} in the listed project settings until needed; ~${ESTIMATES.schemaTokensPerServer} assumed tokens per server per response.`, unused.map(m => `${m.name}: ${m.calls} calls; ${m.projects.slice(0, 3).join(', ')}`), '# MCP review\nDisable unused servers in your MCP configuration; re-enable them for tasks that need them.');
    const big = a.instructions.filter(i => i.estimatedTokens >= ESTIMATES.bigInstructionTokens);
    leak('big_instruction_files', 'Instruction files use a large context budget', big.reduce((n, i) => n + i.estimatedResentTokens, 0), 'Large instruction files may be included repeatedly. File contents were never read; this is an upper-bound estimate from disk size.', 'Trim the listed instruction files. Keep short project rules in AGENTS.md / CLAUDE.md and move detailed reference material into files loaded on demand.', big.map(i => `${i.project}: ${i.path}, ${i.bytes} bytes (~${i.estimatedTokens} tokens), ${i.turns} responses`), 'Keep always-loaded instructions concise. Load detailed guides only when the task needs them.', 'observed-size');
    leak('repeated_file_reads', 'The same files were read again', a.repeatedReads.reduce((n, r) => n + r.estimatedTokens, 0), 'Second and later reads of the same file in a session replay output. Some rereads are useful after edits.', 'Reuse earlier findings and request a small line range or diff after changes. Avoid dumping whole files repeatedly.', a.repeatedReads.slice(0, 8).map(r => `${r.project} · ${r.session}: ${r.path}, ${r.reads} reads, ~${r.estimatedTokens} repeated tokens`), 'Before rereading a file, reuse existing notes. After edits, inspect the diff or only the changed lines.', 'observed-size');
    leak('huge_tool_outputs', 'Large tool results flood context', a.hugeOutputs.reduce((n, r) => n + r.estimatedTokens, 0), `${a.hugeOutputs.length} individual tool results exceeded ${a.estimates.hugeOutputTokens} estimated tokens.`, 'Cap output: use head, rg -m 20, narrow file ranges and compact JSON projections. If supported by your Claude Code version, set MAX_MCP_OUTPUT_TOKENS or BASH_MAX_OUTPUT_LENGTH.', a.hugeOutputs.slice(0, 8).map(r => `${r.project} · ${r.session}: ${r.tool}, ~${r.estimatedTokens} tokens`), '# CLAUDE.md / AGENTS.md\nLimit tool output to relevant lines. Use rg -m 20, head -n 80, or sed -n \'1,80p\'.\n# Claude settings.json draft; merge into your existing env object\n{"env":{"MAX_MCP_OUTPUT_TOKENS":"8000","BASH_MAX_OUTPUT_LENGTH":"20000"}}', 'observed-size');
    const long = a.sessions.filter(s => s.longContextTokens > 0);
    leak('long_context_no_compaction', 'Long sessions keep replaying context', long.reduce((n, s) => n + s.longContextTokens, 0), `${long.length} sessions had at least ${ESTIMATES.longContextMinTurns} responses above ${a.estimates.contextThreshold} context tokens within one uncompacted segment.`, 'Run /compact at a natural checkpoint, or start a new chat with a short handoff after about 5 responses above the context threshold.', long.slice(0, 8).map(s => `${s.project} · ${s.id}: ${s.longContextTurns} large-context responses; peak ${s.peakContext}`), `After roughly 5 responses above ${a.estimates.contextThreshold} context tokens, summarize decisions and compact or start a fresh session.`);
    const idle = a.sessions.filter(s => s.idleRewriteTokens > 0);
    leak('resumed_idle_sessions', 'Idle sessions rewrote a large cache', idle.reduce((n, s) => n + s.idleRewriteTokens, 0), 'A gap longer than one hour was followed by at least 10k cache-write tokens. This is consistent with cache expiry, but does not prove it.', 'Before a long break, save a brief handoff. Resume with that summary in a fresh session when the old context is no longer needed.', scope(idle), 'Before a long break, save a concise handoff with changed files, decisions, and the next action.');
    const sides = a.sessions.filter(s => s.sidechain);
    leak('subagent_startup', 'Subagents repeat startup context', sides.reduce((n, s) => n + s.baseline, 0), `${sides.length} subagent sessions each have an estimated first-response startup cost.`, 'Batch related small tasks into one subagent and pass only the files and context it needs.', scope(sides), 'Use one focused subagent for related tasks. Give it a small scope and avoid copying the full conversation.');
    const top = a.models.filter(m => /opus/i.test(m.name) || (/gpt-5/i.test(m.name) && /:high|:xhigh|:ultra|:max/.test(m.name)));
    const topTokens = top.reduce((n, m) => n + m.tokens.total, 0);
    const tiny = a.sessions.filter(s => (/opus/i.test(s.model) || /gpt-5.*:(high|xhigh|ultra|max)/.test(s.model)) && s.turns <= 3 && s.tokens.output < ESTIMATES.tinyTaskOutputTokens);
    leak('expensive_model_share', 'Top-tier models handle much of the work', topTokens * ESTIMATES.expensiveAvoidableFraction, `${round(total ? topTokens / total * 100 : 0)}% of token traffic used Opus or GPT-5 with high reasoning; ${tiny.length} short, low-output sessions may be small tasks. Model choice changes cost, not raw token count. Estimate assumes 25% of top-tier traffic could move.`, 'Use Sonnet or a lower-reasoning model for routine searches, edits and formatting; reserve the top tier for difficult design and debugging.', [...top.map(m => `${m.name}: ${m.tokens.total} tokens`), ...scope(tiny)], 'Use a mid-tier model for routine edits and searches. Escalate for complex reasoning.');
    const baseline = a.sessions.filter(s => s.baseline >= ESTIMATES.bigBaselineTokens);
    leak('big_baseline_per_session', 'Sessions start with heavy overhead', baseline.reduce((n, s) => n + s.baseline, 0), `${baseline.length} sessions started with at least ${ESTIMATES.bigBaselineTokens} fresh input plus cache-write tokens. First observed response may include task context. Schema and instruction estimates overlap this baseline.`, 'Reduce always-loaded instructions and tools. Keep related work in a focused session and start fresh when the context no longer helps.', baseline.slice(0, 8).map(s => `${s.project} · ${s.id}: ~${s.baseline} baseline; ~${s.baselineReplayed} if replayed across ${s.turns} responses`), 'Keep session startup context small. Load reference files and optional tools only when needed.');
    a.leaks.sort((x, y) => y.estimatedTokens - x.estimatedTokens || x.category.localeCompare(y.category));
    a.avoidableTokens = Math.min(total, a.leaks.filter(l => l.category !== 'expensive_model_share').reduce((n, l) => Math.max(n, l.estimatedTokens), 0));
    a.avoidablePercent = total ? round(a.avoidableTokens / total * 100) : 0;
}
