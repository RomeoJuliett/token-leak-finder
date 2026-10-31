import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function buildOpenCommand(file: string, platform: NodeJS.Platform = process.platform) {
    const url = pathToFileURL(resolve(file)).href;
    if (platform === 'darwin') return { command: 'open', args: [url], env: undefined, windowsVerbatimArguments: false };
    if (platform === 'win32') return {
        command: 'cmd',
        // Expand once through an environment variable so spaces, %, &, and other
        // filename characters cannot turn into commands or cmd substitutions.
        args: ['/d', '/v:off', '/s', '/c', 'start "" "%TOKEN_LEAK_FINDER_REPORT_URL%"'],
        env: { ...process.env, TOKEN_LEAK_FINDER_REPORT_URL: url },
        windowsVerbatimArguments: true,
    };
    return { command: 'xdg-open', args: [url], env: undefined, windowsVerbatimArguments: false };
}

export async function openReport(file: string): Promise<void> {
    const { command, args, env, windowsVerbatimArguments } = buildOpenCommand(file);
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, env, windowsVerbatimArguments });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}
