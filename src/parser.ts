import { basename, extname } from 'node:path';
import { normalizeLogPath, resolveLogPath } from './paths.js';
import { lines, emptyStats } from './reader.js';
import { emptyTokens, finishTokens, num, identifier, pathValue } from './config.js';
import type { ParsedSession, Source, Turn, Tokens, ToolCall } from './types.js';
type Obj = Record<string, any>;
const obj = (x: any): Obj => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
function tokens(u: Obj, source: Source): Tokens {
    const t = emptyTokens();
    t.cacheRead = num(u.cache_read_input_tokens ?? u.cached_input_tokens);
    t.cacheWrite = num(u.cache_creation_input_tokens ?? u.cache_write_input_tokens);
    t.input = source === 'codex' ? Math.max(0, num(u.input_tokens) - t.cacheRead - t.cacheWrite) : num(u.input_tokens);
    t.output = num(u.output_tokens);
    t.reasoning = Math.min(t.output, num(u.reasoning_output_tokens));
    return finishTokens(t);
}
const maxUsage = (a: Obj, b: Obj): Obj => Object.fromEntries(['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens', 'total_tokens'].map(k => [k, Math.max(num(a[k]), num(b[k]))]));
function lengthOf(x: unknown): number { if (typeof x === 'string')
    return x.length; if (Array.isArray(x))
    return x.reduce((n, v) => n + lengthOf(v), 0); if (x && typeof x === 'object') {
    const o = x as Obj;
    return typeof o.text === 'string' ? o.text.length : typeof o.content === 'string' ? o.content.length : Array.isArray(o.content) ? lengthOf(o.content) : 0;
} return 0; }
function filePath(v: unknown, cwd: string): string | undefined { const p = pathValue(v); if (!p || p.startsWith('-') || p.includes('://') || /[\n\r<>|;$`]/.test(p) || p.length > 1000)
    return; return resolveLogPath(cwd, p); }
// Conservative shell inference: literal cat/sed/rg operands only, never execute
// commands, never retain command strings, search patterns or inline scripts.
export function shellFiles(input: any, cwd: string): string[] {
    let command = input.command ?? input.cmd;
    const commandArray = Array.isArray(command);
    if (Array.isArray(command))
        command = command.map((v: any) => typeof v === 'string' ? JSON.stringify(v) : '').join(' ');
    if (typeof command !== 'string' || command.length > 100000)
        return [];
    const found = new Set<string>();
    for (const part of command.split(/\n|&&|\|\||[;|]/)) {
        const words = (part.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+/g) ?? []).map(w => {
            if (commandArray && w.startsWith('"')) {
                try { return JSON.parse(w) as string; } catch { /* Literal shell path. */ }
            }
            return w.replace(/^(['"])(.*)\1$/, '$2');
        });
        const at = words.findIndex(w => ['cat', 'sed', 'rg'].includes(w));
        if (at < 0)
            continue;
        const tool = words[at];
        let pattern = tool === 'cat';
        let skip = false;
        for (const w of words.slice(at + 1)) {
            if (skip) {
                skip = false;
                continue;
            }
            if (w.startsWith('-')) {
                if (['-m', '-A', '-B', '-C', '--max-count', '--glob', '-g', '-e', '--regexp', '-f'].includes(w)) {
                    skip = true;
                    if (w === '-e' || w === '--regexp')
                        pattern = true;
                }
                continue;
            }
            if (!pattern) {
                pattern = true;
                continue;
            }
            if (w === '>' || w === '>>')
                break;
            if (!/[\\/]/.test(w) && !extname(w))
                continue;
            const p = filePath(w, cwd);
            if (p)
                found.add(p);
        }
    }
    return [...found];
}
export function mcpServer(name: string): string | undefined { return /^mcp__([^_].*?)__/.exec(name)?.[1] ?? /^mcp\.([\w-]+)\./.exec(name)?.[1]; }
export async function parseFile(file: string, source: Source, options: {
    since: number;
    until?: number;
    maxLineBytes: number;
}): Promise<ParsedSession> {
    const s: ParsedSession = { id: identifier(basename(file, '.jsonl')), source, project: 'unknown', sidechain: /[\\/]subagents[\\/]/.test(file), turns: [], tools: [], reads: [], compactions: 0, compactionTimes: [], stats: emptyStats() };
    const turns = new Map<string, {
        turn: Turn;
        usage: Obj;
    }>(), requests = new Map<string, string>(), calls = new Map<string, ToolCall>(), resultSeen = new Set<string>();
    let model = 'unknown', segment = 0, contextWindow = 0, previousTotals: Obj | undefined, lastLastSignature = '', turnKey = '', fallbackSequence = 0;
    const responseRecords: {
        id: string;
        usage: Obj;
        timestamp: number;
        model: string;
        segment: number;
    }[] = [];
    const responseIds = new Set<string>();
    let countEvents = 0;
    function tool(id: any, name: any, input: any) {
        const key = identifier(id, 'call-' + calls.size);
        if (calls.has(key))
            return;
        let n = identifier(name);
        let inp = obj(input);
        if (typeof input === 'string') {
            try {
                inp = obj(JSON.parse(input));
            }
            catch {
                inp = {};
            }
        }
        let files: string[] = [];
        if (/^(functions\.)?exec$/.test(n) && typeof input === 'string') {
            for (const m of input.matchAll(/\b(?:cmd|command)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
                let cmd: string;
                try {
                    cmd = m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1).replace(/\\'/g, "'").replace(/\\n/g, '\n');
                }
                catch {
                    continue;
                }
                files.push(...shellFiles({ cmd }, s.project));
            }
            const nested = [...input.matchAll(/\btools\.([A-Za-z_][\w]*)\s*\(/g)].map(m => m[1]);
            if (new Set(nested).size === 1)
                n = nested[0];
            files = [...new Set(files)];
        }
        if (/^(Read|read_file)$/i.test(n)) {
            const p = filePath(inp.file_path ?? inp.path, s.project);
            if (p)
                files = [p];
        }
        else if (/(?:shell|bash|exec_command)$/i.test(n))
            files.push(...shellFiles(inp, s.project));
        const call: ToolCall = { id: key, name: n, server: mcpServer(n), resultTokens: 0, files };
        calls.set(key, call);
        s.tools.push(call);
    }
    function result(id: any, content: any) { const key = identifier(id); if (resultSeen.has(key)) {
        s.stats.duplicates++;
        return;
    } resultSeen.add(key); const c = calls.get(key); if (!c)
        return; c.resultTokens = Math.ceil(lengthOf(content) / 4); for (const p of c.files)
        s.reads.push({ path: p, tokens: Math.ceil(c.resultTokens / Math.max(1, c.files.length)), tool: c.name }); }
    function turn(usage: Obj, time: number, m = model): Turn { const t = tokens(usage, source); return { timestamp: time, model: m, tokens: t, context: t.input + t.cacheRead + t.cacheWrite, segment, contextWindow }; }
    try {
        for await (const line of lines(file, options.maxLineBytes, s.stats)) {
            if (!line.trim())
                continue;
            let e: Obj;
            try {
                const raw = JSON.parse(line);
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                    s.stats.malformed++;
                    continue;
                }
                e = raw;
            }
            catch {
                s.stats.malformed++;
                continue;
            }
            const p = obj(e.payload), msg = obj(e.message);
            const time = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN;
            const inRange = Number.isFinite(time) && time >= options.since && time <= (options.until ?? Infinity);
            if (source === 'claude' && e.isSidechain === true)
                s.sidechain = true;
            const metadata = source === 'claude' ? e.cwd || e.sessionId : e.type === 'session_meta' || e.type === 'turn_context';
            if (metadata) {
                const cwd = pathValue(source === 'claude' ? e.cwd : p.cwd);
                if (cwd)
                    s.project = normalizeLogPath(cwd);
                if (source === 'claude' && e.sessionId && s.id === identifier(basename(file, '.jsonl')))
                    s.id = identifier(e.sessionId, s.id) + (s.sidechain ? ':' + identifier(basename(file, '.jsonl')) : '');
                if (source === 'codex' && e.type === 'session_meta') {
                    s.id = identifier(p.id ?? p.session_id, s.id);
                    const origins = [p.source, p.thread_source];
                    s.sidechain = s.sidechain || origins.some(origin => origin === 'subagent' || (origin && typeof origin === 'object' && ('subagent' in origin)));
                }
            }
            if (source === 'codex' && e.type === 'turn_context') {
                model = identifier(p.model, model);
                if (typeof p.effort === 'string' && /^(high|xhigh|ultra|max)$/.test(p.effort))
                    model += ':' + p.effort;
                turnKey = identifier(p.turn_id, 'turn-' + (++fallbackSequence));
            }
            if (source === 'claude' && msg.model)
                model = identifier(msg.model, model);
            if (!Number.isFinite(time)) {
                s.stats.untimed++;
                if (!['assistant', 'user', 'system', 'summary', 'session_meta', 'turn_context', 'response_item', 'event_msg', 'token_usage_record', 'compacted'].includes(e.type))
                    s.stats.unknown++;
            }
            // Maintain counter baselines even outside the requested range.
            if (source === 'codex' && e.type === 'event_msg' && p.type === 'token_count') {
                const info = obj(p.info), total = obj(info.total_token_usage), last = obj(info.last_token_usage);
                contextWindow = num(info.model_context_window) || contextWindow;
                const hasTotals = Object.keys(total).length > 0;
                let usage: Obj | undefined;
                if (hasTotals) {
                    if (previousTotals) {
                        const keys = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
                        const reset = num(total.input_tokens) < num(previousTotals.input_tokens) || num(total.output_tokens) < num(previousTotals.output_tokens);
                        usage = reset ? Object.keys(last).length ? last : total : Object.fromEntries(keys.map(k => [k, Math.max(0, num(total[k]) - num(previousTotals![k]))]));
                    }
                    else
                        usage = Object.keys(last).length ? last : total;
                    previousTotals = total;
                }
                else if (Object.keys(last).length) {
                    const signature = turnKey + JSON.stringify(last);
                    if (signature !== lastLastSignature)
                        usage = last;
                    lastLastSignature = signature;
                }
                if (!inRange) {
                    s.stats.filtered++;
                    continue;
                }
                countEvents++;
                if (usage) {
                    const t = turn(usage, time);
                    if (t.tokens.total > 0)
                        s.turns.push(t);
                    else
                        s.stats.duplicates++;
                }
                else
                    s.stats.duplicates++;
                continue;
            }
            if (!inRange) {
                if (Number.isFinite(time))
                    s.stats.filtered++;
                if (!metadata && e.type !== 'turn_context')
                    continue;
            }
            if (!inRange)
                continue;
            if (e.type === 'compacted' || e.type === 'summary' || p.type === 'context_compacted' || e.subtype === 'compact_boundary' || e.isCompactSummary === true) {
                s.compactions++;
                s.compactionTimes.push(time);
                segment++;
                continue;
            }
            if (source === 'claude') {
                if (e.isSidechain === true)
                    s.sidechain = true;
                if (e.type === 'assistant') {
                    const usage = obj(msg.usage);
                    if (Object.keys(usage).length) {
                        let key = identifier(msg.id ?? e.requestId ?? e.uuid, 'line-' + s.stats.lines);
                        const req = typeof e.requestId === 'string' ? e.requestId : undefined;
                        if (req && requests.has(req))
                            key = requests.get(req)!;
                        if (req)
                            requests.set(req, key);
                        const old = turns.get(key);
                        if (old) {
                            s.stats.duplicates++;
                            old.usage = maxUsage(old.usage, usage);
                            old.turn.tokens = tokens(old.usage, source);
                            old.turn.context = old.turn.tokens.input + old.turn.tokens.cacheRead + old.turn.tokens.cacheWrite;
                        }
                        else {
                            const t = turn(usage, time);
                            turns.set(key, { turn: t, usage });
                            s.turns.push(t);
                        }
                    }
                    if (Array.isArray(msg.content))
                        for (const b of msg.content) {
                            if (b?.type === 'tool_use')
                                tool(b.id, b.name, b.input);
                        }
                }
                else if (e.type === 'user') {
                    if (Array.isArray(msg.content))
                        for (const b of msg.content) {
                            if (b?.type === 'tool_result')
                                result(b.tool_use_id, b.content);
                        }
                }
                else
                    s.stats.unknown++;
            }
            else {
                if (e.type === 'response_item') {
                    if (p.type === 'function_call' || p.type === 'custom_tool_call')
                        tool(p.call_id ?? p.id, p.name, p.arguments ?? p.input);
                    else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')
                        result(p.call_id ?? p.id, p.output);
                    else if (!['message', 'reasoning'].includes(p.type))
                        s.stats.unknown++;
                }
                else if (e.type === 'token_usage_record') {
                    if (countEvents > 0)
                        continue;
                    const id = identifier(p.response_id, 'record-' + s.stats.lines);
                    if (!responseIds.has(id)) {
                        responseIds.add(id);
                        responseRecords.push({ id, usage: obj(p.usage), timestamp: time, model, segment });
                    }
                    else
                        s.stats.duplicates++;
                }
                else if (!['session_meta', 'turn_context'].includes(e.type))
                    s.stats.unknown++;
            }
        }
    }
    catch {
        s.stats.errors++;
    }
    // Modern records are a fallback only. token_count and records describe the
    // same responses; using both would inflate totals. Missing-counter coverage
    // is reported as a limitation rather than summing incompatible counters.
    if (source === 'codex' && countEvents === 0) {
        for (const r of responseRecords) {
            segment = r.segment;
            const t = turn(r.usage, r.timestamp, r.model);
            if (t.tokens.total)
                s.turns.push(t);
        }
    }
    for (const c of s.tools)
        if (!resultSeen.has(c.id))
            for (const p of c.files)
                s.reads.push({ path: p, tokens: 0, tool: c.name });
    s.turns.sort((a, b) => a.timestamp - b.timestamp);
    return s;
}
