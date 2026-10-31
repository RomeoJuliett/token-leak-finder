import { homedir } from 'node:os';
import path, { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';

// Log paths can belong to a different OS than the machine reading the file.
export const isWindowsPath = (value: string): boolean => /^[a-z]:[\\/]|^\\\\|^\/\//i.test(value);
export function normalizeLogPath(value: string): string {
    if (isWindowsPath(value)) {
        const normalized = path.win32.normalize(value).replace(/\\/g, '/').toLowerCase();
        return /^[a-z]:\/$/.test(normalized) ? normalized : normalized.replace(/\/$/, '');
    }
    return path.posix.normalize(value).replace(/\/$/, '') || '/';
}
export function resolveLogPath(cwd: string, value: string): string {
    const style = isWindowsPath(cwd) || isWindowsPath(value) ? path.win32 : cwd.startsWith('/') ? path.posix : path;
    return normalizeLogPath(style.resolve(cwd === 'unknown' ? '.' : cwd, value));
}
export function logPathInside(parent: string, child: string): boolean {
    const root = normalizeLogPath(parent).replace(/\/$/, '');
    return normalizeLogPath(child).startsWith(root + '/');
}

export async function defaultPaths(home = homedir(), env: NodeJS.ProcessEnv = process.env) {
    const configured = env.CLAUDE_CONFIG_DIR?.split(',').map(p => p.trim()).filter(Boolean);
    const claudeConfigDirs = configured?.length ? configured.map(p => resolve(p)) : [join(home, '.claude')];
    if (!configured?.length) {
        const xdg = join(home, '.config', 'claude');
        try {
            if ((await stat(join(xdg, 'projects'))).isDirectory()) claudeConfigDirs.push(xdg);
        } catch { /* Optional XDG installation. */ }
    }
    const codexHome = env.CODEX_HOME?.trim() ? resolve(env.CODEX_HOME.trim()) : join(home, '.codex');
    return {
        claudeConfigDirs: [...new Set(claudeConfigDirs)],
        claudeDirs: [...new Set(claudeConfigDirs.map(dir => join(dir, 'projects')))],
        codexHome,
        codexDir: join(codexHome, 'sessions'),
    };
}
