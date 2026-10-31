import { emptyStats } from './reader.js';
import { parseFile } from './parser.js';
import { discover, localMetadata } from './local.js';
import { privacy } from './privacy.js';
import { ESTIMATES, emptyTokens, addTokens, contextCost, DEFAULT_TOP_TIER_PATTERNS, isTopTier } from './config.js';
import type { Analysis, Options, Group, Tokens, SessionSummary, Leak } from './types.js';
const round = (n: number) => Math.round(n * 10) / 10;
export async function analyze(o: Options): Promise<Analysis> {
    const a: Analysis = { version: '0.1.0', redacted: o.redact, range: { since: new Date(o.since).toISOString(), until: new Date(o.until).toISOString(), days: Math.ceil((o.until - o.since) / 86400000) }, sources: { claude: { filesScanned: 0, sessionsWithUsage: 0, toolOnlySessions: 0, filesWithoutUsage: 0, filesWithErrors: 0 }, codex: { filesScanned: 0, sessionsWithUsage: 0, toolOnlySessions: 0, filesWithoutUsage: 0, filesWithErrors: 0 } }, unit: 'limit-weighted tokens (estimate)', topTierPatterns: o.topTierPatterns ?? [...DEFAULT_TOP_TIER_PATTERNS], contextBands: ['<100k', '100–200k', '200–500k', '>500k'].map(label => ({ label, responses: 0, sessions: 0 })), highContext: { sessions: 0, responses: 0, compactAt: ESTIMATES.compactAt, rawEstimatedTokens: 0, weightedTokens: 0 }, avoidableRawTokens: 0, avoidableContributions: [], costLevers: [], repeatedFiles: [], totals: emptyTokens(), avoidableTokens: 0, avoidablePercent: 0, sessions: [], projects: [], models: [], tools: [], days: [], mcps: [], instructions: [], repeatedReads: [], hugeOutputs: [], leaks: [], stats: { ...emptyStats(), files: 0, filesFiltered: 0, fileErrors: 0, configErrors: 0, configSkipped: 0 }, estimates: { ...ESTIMATES, contextThreshold: o.contextThreshold, hugeOutputTokens: o.hugeOutputTokens, maxLineBytes: o.maxLineBytes }, notes: [
            'Usage turns mean metered API responses, not user messages. All token totals include cache traffic; reasoning is a subset of output and is never added twice.',
            'Limit-weighted tokens are an estimate, not provider quota rules, money or exact savings. Weights: fresh input 1, output 5, cache read 0.1, cache write 1.25.',
            'Tool output and file-read sizes use chars / 4. Shell file inference is conservative. Repeated reads can be necessary after edits.',
            'The headline sums disjoint sessions. Within each session it takes only the largest supported weighted signal (excess context, repeated reads, huge outputs or idle rewrites), caps it at observed input/cache weighted usage, then applies a 50% actionable allowance. This is a conservative scenario, not measured savings. Raw savings follow the selected signal and allowance; raw and weighted percentages need not match.',
            'Schema/instruction replay, baseline, subagent startup and model choice are excluded from the headline. These are uncertain diagnostics or cost levers. Individual cards overlap and must never be added.',
            'Long-context estimates count only max(0, context minus threshold) in segments with at least five above-threshold responses. Excess is allocated proportionally across fresh input, cache read and cache write and weighted accordingly. The >500k scenario independently models compacting those responses to 150k; it overlaps the long-context card.',
            'Replay diagnostics use each affected session’s observed weighted context / raw context ratio and are bounded by its observed context. Tool/read estimates count one input insertion at weight 1, bounded per session by observed context; speculative future replay is excluded.',
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
    for (const job of jobs) a.sources[job.source].filesScanned++;
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
            if (s.stats.errors) {
                a.stats.fileErrors++;
                a.sources[s.source].filesWithErrors++;
            }
            s.turns = s.turns.filter(t => t.tokens.total > 0);
            if (!s.turns.length) a.sources[s.source].filesWithoutUsage++;
            if ((s.turns.length || s.tools.length) && (!o.project || s.project.toLowerCase().includes(o.project.toLowerCase()))) {
                if (s.turns.length) a.sources[s.source].sessionsWithUsage++;
                else a.sources[s.source].toolOnlySessions++;
                const bands = new Set<number>();
                for (const t of s.turns) {
                    const band = t.context < 100000 ? 0 : t.context < 200000 ? 1 : t.context <= 500000 ? 2 : 3;
                    a.contextBands[band].responses++;
                    bands.add(band);
                }
                for (const band of bands) a.contextBands[band].sessions++;
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
                const sum: SessionSummary = { id: s.id, source: s.source, project: s.project, model: models.size === 1 ? [...models][0] : models.size ? 'multiple' : 'unknown', tokens, turns: s.turns.length, peakContext: s.turns.reduce((n, t) => Math.max(n, t.context), 0), compactions: s.compactions, baseline, baselineReplayed: baseline * s.turns.length, sidechain: s.sidechain, contextTokens: s.turns.reduce((n, t) => n + t.context, 0), contextWeightedTokens: s.turns.reduce((n, t) => n + contextCost(t.tokens), 0), baselineWeightedTokens: first ? first.tokens.input * ESTIMATES.inputWeight + first.tokens.cacheWrite * ESTIMATES.cacheWriteWeight : 0,
                    longContextTokens: long.reduce((n, t) => n + Math.max(0, t.context - o.contextThreshold), 0),
                    longContextWeightedTokens: long.reduce((n, t) => n + (t.context - o.contextThreshold) / t.context * contextCost(t.tokens), 0),
                    highContextResponses: s.turns.filter(t => t.context > 500000).length,
                    highContextRawTokens: s.turns.filter(t => t.context > 500000).reduce((n, t) => n + t.context - ESTIMATES.compactAt, 0),
                    highContextWeightedTokens: s.turns.filter(t => t.context > 500000).reduce((n, t) => n + (t.context - ESTIMATES.compactAt) / t.context * contextCost(t.tokens), 0), longContextTurns: long.length, idleRewriteTokens: idle, start: first ? new Date(first.timestamp).toISOString() : 'unknown', end: s.turns.length ? new Date(s.turns.at(-1)!.timestamp).toISOString() : 'unknown' };
                a.sessions.push(sum);
                if (sum.highContextResponses) a.highContext.sessions++;
                a.highContext.responses += sum.highContextResponses;
                a.highContext.rawEstimatedTokens += sum.highContextRawTokens;
                a.highContext.weightedTokens += sum.highContextWeightedTokens;
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
                        a.hugeOutputs.push({ source: s.source, project: s.project, session: s.id, tool: c.name, estimatedTokens: c.resultTokens });
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
                        a.repeatedReads.push({ source: s.source, project: s.project, session: s.id, path, reads: r.count, repeated: r.count - 1, estimatedTokens: r.waste });
            }
            completed++;
            o.progress?.(completed, jobs.length, a.stats.bytes);
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(16, o.concurrency, jobs.length)) }, worker));
    for (const type of Object.keys(groups) as (keyof typeof groups)[])
        a[type] = [...groups[type].values()].sort((x, y) => y.tokens.weighted - x.tokens.weighted || x.name.localeCompare(y.name));
    a.sessions.sort((x, y) => y.tokens.weighted - x.tokens.weighted || x.id.localeCompare(y.id));
    a.repeatedReads.sort((x, y) => y.estimatedTokens - x.estimatedTokens);
    a.hugeOutputs.sort((x, y) => y.estimatedTokens - x.estimatedTokens);
    const files = new Map<string, Analysis['repeatedFiles'][number]>();
    for (const r of a.repeatedReads) {
        let f = files.get(r.path);
        if (!f) { f = { path: r.path, projects: [], sessions: 0, reads: 0, repeated: 0, estimatedTokens: 0 }; files.set(r.path, f); }
        f.projects = [...new Set([...f.projects, r.project])];
        f.sessions++; f.reads += r.reads; f.repeated += r.repeated; f.estimatedTokens += r.estimatedTokens;
    }
    a.repeatedFiles = [...files.values()].sort((x, y) => y.repeated - x.repeated || y.estimatedTokens - x.estimatedTokens || x.path.localeCompare(y.path));
    a.highContext.weightedTokens = round(a.highContext.weightedTokens);
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
    const total = a.totals.weighted;
    type Estimate = { raw: number; weighted: number };
    const combined = (values: Estimate[]): Estimate => values.reduce((n, v) => ({ raw: n.raw + v.raw, weighted: n.weighted + v.weighted }), { raw: 0, weighted: 0 });
    const context = combined(a.sessions.map(s => ({ raw: s.contextTokens, weighted: s.contextWeightedTokens })));
    const bounded = (e: Estimate): Estimate => ({ raw: Math.min(context.raw, e.raw), weighted: Math.min(context.weighted, e.weighted) });
    const insertion = (raw: number, s: SessionSummary): Estimate => {
        const weighted = Math.min(raw * ESTIMATES.inputWeight, s.contextWeightedTokens);
        return { raw: Math.min(raw, weighted / ESTIMATES.inputWeight), weighted };
    };
    const replay = (raw: number, s: SessionSummary): Estimate => ({ raw: Math.min(raw, s.contextTokens), weighted: Math.min(raw, s.contextTokens) * (s.contextTokens ? s.contextWeightedTokens / s.contextTokens : 0) });
    function leak(category: string, title: string, estimate: Estimate, why: string, fix: string, evidence: string[], snippet: string, confidence: Leak['confidence'] = 'heuristic', costLever = false) {
        if (estimate.weighted <= 0) return;
        const e = costLever ? estimate : bounded(estimate);
        const weightedTokens = Math.min(round(e.weighted), costLever ? total : context.weighted);
        (costLever ? a.costLevers : a.leaks).push({ category, title, estimatedTokens: weightedTokens, weightedTokens, rawEstimatedTokens: Math.round(e.raw), percent: total ? round(weightedTokens / total * 100) : 0, why, fix, evidence: evidence.slice(0, 6), snippet, confidence });
    }
    const scope = (ss: SessionSummary[], value: (s: SessionSummary) => number) => [...ss].sort((x, y) => value(y) - value(x)).slice(0, 6).map(s => `${s.project} · ${s.id}: ${s.turns} responses; ${Math.round(value(s))} weighted tokens (estimate)`);
    const configured = a.mcps.filter(m => m.configured), unused = configured.filter(m => m.calls <= ESTIMATES.rarelyUsedCalls);
    const schemaEstimate = (servers: typeof a.mcps) => combined(a.sessions.map(s => replay(servers.filter(m => m.source === s.source && m.projects.includes(s.project)).length * ESTIMATES.schemaTokensPerServer * s.turns, s)));
    const mcpEvidence = (servers: typeof a.mcps) => [...servers].sort((x, y) => y.estimatedResentTokens - x.estimatedResentTokens).map(m => `${m.name} (${m.source}): configured; ${m.calls} calls in ${a.range.days} days; ~${m.estimatedSchemaTokens} raw tokens/response; ${m.projects.slice(0, 2).join(', ')}`);
    leak('mcp_schema_overhead', 'MCP schemas travel with context', schemaEstimate(configured), `${configured.length} configured servers; ${a.mcps.filter(m => m.calls > 0).length} servers called in ${a.range.days} days. Schema sizes and loading are assumed; excluded from the headline.`, 'Enable only task-relevant MCP servers in each project.', mcpEvidence(configured), 'Disable optional MCP servers in project settings; enable them for the task that needs them.');
    leak('unused_mcp_servers', 'Configured MCP servers barely used', schemaEstimate(unused), `${unused.length} configured servers had at most ${ESTIMATES.rarelyUsedCalls} calls. Configuration is current; logs cover the selected window. Excluded from the headline.`, `Review and disable unused servers: ${unused.slice(0, 4).map(m => m.name).join(', ')}.`, mcpEvidence(unused), '# MCP review\nDisable unused servers in project settings; re-enable them when needed.');
    const big = a.instructions.filter(i => i.estimatedTokens >= ESTIMATES.bigInstructionTokens);
    const instructions = combined(a.sessions.map(s => replay(big.filter(i => i.project === s.project && i.sources.includes(s.source)).reduce((n, i) => n + i.estimatedTokens * s.turns, 0), s)));
    leak('big_instruction_files', 'Instruction files use a large context budget', instructions, `${big.length} large instruction files measured by size only. Assumed replay is an upper bound; excluded from the headline.`, 'Keep core instructions short and load detailed guides on demand.', [...big].sort((x, y) => y.estimatedResentTokens - x.estimatedResentTokens).map(i => `${i.project}: ${i.path}, ${i.bytes} bytes (~${i.estimatedTokens} raw tokens), ${i.turns} responses`), 'Keep always-loaded instructions concise. Load detailed reference files only for relevant tasks.', 'observed-size');
    const repeatsFor = (s: SessionSummary) => insertion(a.repeatedReads.filter(r => r.source === s.source && r.session === s.id && r.project === s.project).reduce((n, r) => n + r.estimatedTokens, 0), s);
    const hugeFor = (s: SessionSummary) => insertion(a.hugeOutputs.filter(r => r.source === s.source && r.session === s.id && r.project === s.project).reduce((n, r) => n + r.estimatedTokens, 0), s);
    leak('repeated_file_reads', 'The same files were read again', combined(a.sessions.map(repeatsFor)), `${a.repeatedFiles.length} files reread across ${a.repeatedReads.length} session/file pairs. Counts include only second and later reads within each session; edits may justify rereads.`, 'Reuse earlier findings; after edits, read the diff or changed lines.', a.repeatedFiles.slice(0, 6).map(r => `${r.path}: ${r.repeated} repeats, ${r.reads} reads in ${r.sessions} sessions; ~${r.estimatedTokens} raw tokens`), 'Before rereading, reuse existing notes. After edits, inspect the diff or only changed lines.', 'observed-size');
    leak('huge_tool_outputs', 'Large tool results flood context', combined(a.sessions.map(hugeFor)), `${a.hugeOutputs.length} results exceeded ${a.estimates.hugeOutputTokens} estimated raw tokens. One insertion only; future cache replay is excluded.`, 'Cap output with head -n 80, rg -m 20, narrow ranges and small JSON projections.', a.hugeOutputs.slice(0, 6).map(r => `${r.project} · ${r.session}: ${r.tool}, ~${r.estimatedTokens} raw tokens`), '# CLAUDE.md / AGENTS.md\nLimit tool output to relevant lines; use rg -m 20, head -n 80 or explicit ranges.\n# Merge only if supported by your Claude Code version:\n{"env":{"MAX_MCP_OUTPUT_TOKENS":"8000","BASH_MAX_OUTPUT_LENGTH":"20000"}}', 'observed-size');
    const long = a.sessions.filter(s => s.longContextTokens > 0);
    leak('long_context_no_compaction', 'Context beyond the checkpoint', combined(long.map(s => ({ raw: s.longContextTokens, weighted: s.longContextWeightedTokens }))), `${long.length} sessions had at least ${ESTIMATES.longContextMinTurns} responses above ${a.estimates.contextThreshold} context tokens per uncompacted segment. Counts only excess above that threshold.`, `Compact near ${a.estimates.contextThreshold} context tokens at a checkpoint; carry a short handoff forward.`, [...long].sort((x, y) => y.longContextWeightedTokens - x.longContextWeightedTokens).map(s => `${s.project} · ${s.id}: ${s.longContextTurns} above-threshold responses; peak ${s.peakContext}; ~${Math.round(s.longContextWeightedTokens)} weighted excess`), `At ~${a.estimates.contextThreshold} context tokens, save decisions and next steps, then compact or start a fresh session.`);
    const idle = a.sessions.filter(s => s.idleRewriteTokens > 0);
    leak('resumed_idle_sessions', 'Idle sessions rewrote a large cache', combined(idle.map(s => ({ raw: s.idleRewriteTokens, weighted: s.idleRewriteTokens * ESTIMATES.cacheWriteWeight }))), `${idle.length} sessions resumed after an hour with at least 10k cache-write tokens. Consistent with cache expiry; not proof.`, 'Save a short handoff before breaks; start fresh when the old context no longer helps.', scope(idle, s => s.idleRewriteTokens * ESTIMATES.cacheWriteWeight), 'Before a long break, save changed files, decisions and the next action in a concise handoff.');
    const sides = a.sessions.filter(s => s.sidechain && s.baseline > 0);
    leak('subagent_startup', 'Subagents repeat startup context', combined(sides.map(s => ({ raw: s.baseline, weighted: s.baselineWeightedTokens }))), `${sides.length} subagent sessions paid first-response input/cache-write overhead. Startup may be useful; excluded from the headline.`, 'Batch related small tasks and give subagents focused context.', scope(sides, s => s.baselineWeightedTokens), 'Use one focused subagent for related tasks. Pass a small scope and relevant context only.');
    const top = a.models.filter(m => isTopTier(m.name, a.topTierPatterns));
    const topTokens = combined(top.map(m => ({ raw: m.tokens.total, weighted: m.tokens.weighted })));
    const tiny = a.sessions.filter(s => isTopTier(s.model, a.topTierPatterns) && s.turns <= 3 && s.tokens.output < ESTIMATES.tinyTaskOutputTokens);
    leak('expensive_model_share', 'Model choice is a cost lever', topTokens, `${top.map(m => m.name).join(', ')} account for ${round(total ? topTokens.weighted / total * 100 : 0)}% of weighted usage. ${tiny.length} short, low-output sessions may suit a cheaper tier. This is usage share, not token savings.`, 'Try a mid-tier model or lower reasoning for routine searches, edits and formatting.', [...top.map(m => `${m.name}: ${Math.round(m.tokens.weighted)} weighted tokens; ${m.sessions} sessions`), ...scope(tiny, s => s.tokens.weighted)], 'Use a mid-tier model for routine work; escalate for complex reasoning.', 'heuristic', true);
    const baseline = a.sessions.filter(s => s.baseline >= ESTIMATES.bigBaselineTokens);
    leak('big_baseline_per_session', 'Sessions start with heavy overhead', combined(baseline.map(s => ({ raw: s.baseline, weighted: s.baselineWeightedTokens }))), `${baseline.length} sessions began with at least ${ESTIMATES.bigBaselineTokens} fresh input/cache-write tokens. First observed usage can include task context; excluded from the headline.`, 'Reduce always-loaded tools and instructions; reuse focused sessions for related tasks.', scope(baseline, s => s.baselineWeightedTokens), 'Keep startup context small. Load optional tools and references only when needed.');
    a.leaks.sort((x, y) => y.weightedTokens - x.weightedTokens || x.category.localeCompare(y.category));
    for (const s of a.sessions) {
        const candidates = [
            { category: 'long_context_no_compaction', raw: s.longContextTokens, weighted: s.longContextWeightedTokens },
            { category: 'repeated_file_reads', ...repeatsFor(s) },
            { category: 'huge_tool_outputs', ...hugeFor(s) },
            { category: 'resumed_idle_sessions', raw: s.idleRewriteTokens, weighted: s.idleRewriteTokens * ESTIMATES.cacheWriteWeight }
        ].sort((x, y) => y.weighted - x.weighted);
        const best = candidates[0];
        if (!best.weighted) continue;
        const allowance = Math.min(1, s.contextWeightedTokens / best.weighted) * ESTIMATES.actionableFraction;
        a.avoidableContributions.push({ session: s.id, source: s.source, category: best.category, weightedTokens: best.weighted * allowance, rawEstimatedTokens: best.raw * allowance });
    }
    a.avoidableTokens = round(a.avoidableContributions.reduce((n, c) => n + c.weightedTokens, 0));
    a.avoidableRawTokens = Math.round(a.avoidableContributions.reduce((n, c) => n + c.rawEstimatedTokens, 0));
    a.avoidablePercent = total ? round(a.avoidableTokens / total * 100) : 0;
}
