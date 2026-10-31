import { extname } from 'node:path';
import type { Analysis } from './types.js';
export const PUBLIC_MCP_SERVERS = new Set(['github', 'filesystem', 'playwright', 'context7', 'memory', 'fetch', 'puppeteer', 'sequential-thinking', 'brave-search']);
export function scrub(text: string): string {
    return text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[secret]').replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}\b/g, '[secret]').replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, '[secret]').replace(/\bxox[a-z]?-[A-Za-z0-9-]{6,}\b/g, '[secret]').replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[secret]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
}
function label(i: number): string { let n = i + 1, s = ''; while (n > 0) {
    n--;
    s = String.fromCharCode(97 + n % 26) + s;
    n = Math.floor(n / 26);
} return s; }
export function privacy(a: Analysis, home: string): Analysis {
    // Alias structured metadata BEFORE generating evidence/fixes. Direct lookups
    // stay linear in report size even when there are tens of thousands of paths.
    const mappings = new Map<string, string>(), servers = new Map<string, string>();
    if (a.redacted) {
        a.projects.forEach((p, i) => mappings.set(p.name, 'project-' + label(i)));
        a.sessions.forEach((s, i) => mappings.set(s.id, 'session-' + (i + 1)));
        let server = 0;
        for (const m of a.mcps)
            if (!PUBLIC_MCP_SERVERS.has(m.name) && !servers.has(m.name)) {
                const alias = 'mcp-' + (++server);
                servers.set(m.name, alias);
                mappings.set(m.name, alias);
            }
        const paths = [...new Set([...a.instructions.map(x => x.path), ...a.repeatedReads.map(x => x.path)])];
        paths.forEach((p, i) => { const project = a.projects.find(v => p.startsWith(v.name + '/')); const ext = extname(p); mappings.set(p, (project ? mappings.get(project.name) : 'files') + '/file-' + (i + 1) + (/^\.[a-zA-Z0-9]{1,8}$/.test(ext) ? ext : '')); });
    }
    function string(s: string): string {
        if (!a.redacted)
            return s;
        const exact = mappings.get(s);
        if (exact)
            return scrub(exact);
        s = s.replace(/^mcp__([^_].*?)__/, (_match, name: string) => 'mcp__' + (servers.get(name) ?? name) + '__').replace(/^mcp\.([\w-]+)\./, (_match, name: string) => 'mcp.' + (servers.get(name) ?? name) + '.');
        return scrub(s.split(home).join('~'));
    }
    function walk(value: any): any { if (typeof value === 'string')
        return string(value); if (Array.isArray(value))
        return value.map(walk); if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)])); return value; }
    return walk(a) as Analysis;
}
