import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { identifier } from './config.js';
import type { Options, Source, Instruction, Mcp, SessionSummary, Analysis } from './types.js';
export async function discover(root: string, source: Source, since: number, stats: Analysis['stats']): Promise<{
    file: string;
    source: Source;
}[]> {
    const found: {
        file: string;
        source: Source;
    }[] = [];
    async function walk(dir: string) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            stats.fileErrors++;
            return;
        }
        for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isDirectory())
                await walk(p);
            else if (e.isFile() && e.name.endsWith('.jsonl') && (source === 'claude' || e.name.startsWith('rollout-'))) {
                try {
                    const s = await stat(p);
                    if (s.mtimeMs < since)
                        stats.filesFiltered++;
                    else
                        found.push({ file: p, source });
                }
                catch {
                    stats.fileErrors++;
                }
            }
        }
    }
    await walk(root);
    return found;
}
async function configText(file: string, stats: Analysis['stats']): Promise<string | undefined> { try {
    const s = await stat(file);
    if (!s.isFile())
        return;
    if (s.size > 4 * 1024 * 1024) {
        stats.configSkipped++;
        return;
    }
    return await readFile(file, 'utf8');
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        stats.configErrors++;
    return;
} }
export async function localMetadata(options: Options, sessions: SessionSummary[], stats: Analysis['stats']): Promise<{
    instructions: Instruction[];
    mcps: Mcp[];
}> {
    const instructions: Instruction[] = [], mcps: Mcp[] = [];
    const projects = [...new Set(sessions.map(s => s.project).filter(p => p !== 'unknown'))];
    const globals = [{ path: join(options.homeDir, '.claude/CLAUDE.md'), source: 'claude' }, { path: join(options.homeDir, '.codex/AGENTS.md'), source: 'codex' }];
    for (const project of projects) {
        const ss = sessions.filter(s => s.project === project);
        const paths = new Set([join(project, 'CLAUDE.md'), join(project, 'AGENTS.md'), join(project, '.claude/CLAUDE.md'), ...globals.filter(g => ss.some(s => s.source === g.source)).map(g => g.path)]);
        for (const path of paths) {
            try {
                const s = await stat(path);
                if (!s.isFile())
                    continue;
                const global = globals.find(g => g.path === path);
                const used = global ? ss.filter(s => s.source === global.source) : ss;
                const turns = used.reduce((n, s) => n + s.turns, 0);
                instructions.push({ project, path, bytes: s.size, estimatedTokens: Math.ceil(s.size / 4), estimatedResentTokens: Math.ceil(s.size / 4) * turns, sessions: used.length, turns });
            }
            catch { }
        }
    }
    function add(name: string, source: Source, scope: string[]) { const n = identifier(name); if (n === 'unknown')
        return; const existing = mcps.find(m => m.name === n && m.source === source); if (existing) {
        existing.projects = [...new Set([...existing.projects, ...scope])];
        return;
    } mcps.push({ name: n, source, projects: scope, configured: true, calls: 0, estimatedSchemaTokens: 0, estimatedResentTokens: 0, resultTokens: 0 }); }
    async function json(file: string, scope: string[]) { const text = await configText(file, stats); if (!text)
        return; try {
        const x = JSON.parse(text);
        if (!x || typeof x !== 'object')
            return;
        const names = (v: any, scopedProjects: string[]) => { if (v && typeof v === 'object' && !Array.isArray(v))
            for (const n of Object.keys(v))
                add(n, 'claude', scopedProjects); };
        names(x.mcpServers, scope);
        if (x.projects && typeof x.projects === 'object') {
            for (const project of projects)
                names(x.projects[project]?.mcpServers, [project]);
        }
    }
    catch {
        stats.configErrors++;
    } }
    // Read the settings only for object keys. Never retain values, arguments,
    // headers, environment variables, descriptions, commands or URLs.
    await json(join(options.homeDir, '.claude.json'), projects);
    await json(join(options.homeDir, '.claude/settings.json'), projects);
    for (const p of projects)
        await json(join(p, '.mcp.json'), [p]);
    const toml = await configText(join(options.homeDir, '.codex/config.toml'), stats);
    if (toml)
        for (const line of toml.split(/\r?\n/)) {
            const m = /^\s*\[mcp_servers\.(?:"([^"\n]+)"|'([^'\n]+)'|([\w-]+))\]\s*(?:#.*)?$/.exec(line);
            if (m)
                add(m[1] ?? m[2] ?? m[3], 'codex', projects);
        }
    return { instructions, mcps };
}
