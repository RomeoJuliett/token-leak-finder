import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Windows shells do not expand globs; Node 18's test CLI does not either.
const files = readdirSync('dist/test').filter(name => name.endsWith('.test.js')).sort().map(name => join('dist', 'test', name));
if (!files.length) throw new Error('No compiled tests found. Run npm run build first.');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
