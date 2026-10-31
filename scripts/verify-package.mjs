import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixtures } from '../dist/test/fixtures/generate.js';

// Run with npm run test:package. Only the source checkout needs dev dependencies.
// Packing and installing this tarball use no registry and run without a network.
const root = await mkdtemp(join(tmpdir(), 'tlf-package-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run test:package.');
const env = { ...process.env, npm_config_cache: join(root, 'cache'), CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' };
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, env, encoding: 'utf8' });
try {
    const packed = JSON.parse(npm(['pack', '--offline', '--json', '--pack-destination', root], process.cwd()))[0];
    for (const { path } of packed.files) {
        assert.ok(path === 'package.json' || /^(README\.md|LICENSE|CHANGELOG\.md)$/.test(path) || path.startsWith('dist/src/'), `Unexpected shipped file: ${path}`);
    }
    assert.ok(packed.files.some(file => file.path === 'dist/src/cli.js'));
    const consumer = join(root, 'consumer');
    await mkdir(consumer);
    npm(['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', join(root, packed.filename)], consumer);
    const cli = join(consumer, 'node_modules', 'token-leak-finder', 'dist', 'src', 'cli.js');
    const help = execFileSync(process.execPath, [cli, '--help'], { cwd: consumer, env, encoding: 'utf8' });
    assert.match(help, /Usage: token-leak-finder/);
    for (const name of ['token-leak-finder', 'token-leaks']) {
        // Exercise npm's actual executable links, including the shebang.
        const bin = join(consumer, 'node_modules', '.bin', name + (process.platform === 'win32' ? '.cmd' : ''));
        const output = execFileSync(bin, ['--help'], { cwd: consumer, env, encoding: 'utf8', shell: process.platform === 'win32' });
        assert.match(output, /default: 30d/);
    }
    const f = await fixtures(join(root, 'fixtures'));
    const out = join(consumer, 'report.html');
    const output = execFileSync(process.execPath, [cli, '--redact', '--claude-dir', f.claude, '--codex-dir', f.codex, '--home-dir', f.home, '--out', out], { cwd: consumer, env, encoding: 'utf8' });
    assert.match(output, /3 sessions/);
    const report = await readFile(out, 'utf8');
    assert.match(report, /Redacted/);
    assert.ok(!report.includes('SECRET_PROMPT_SENTINEL'));
    process.stdout.write(`Package verified: ${packed.files.length} files; both bin links and redacted fixture report passed (offline).\n`);
} finally {
    await rm(root, { recursive: true, force: true });
}
