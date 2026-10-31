/** Synthetic multi-day data for the checked-in visual sample. Never reads real logs. */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from './generate.js';
export async function reportFixtures(root: string) {
    const f = await fixtures(root);
    const now = new Date(); now.setHours(12, 0, 0, 0);
    for (let day = 1; day <= 21; day++) {
        // Deterministic variation, with intentional empty days in the window.
        if (day % 6 === 0) continue;
        const sessions = 2 + day % 4;
        for (let s = 0; s < sessions; s++) {
            const events = [];
            const count = 8 + (day * 7 + s * 11) % 30;
            for (let i = 0; i < count; i++) {
                const stamp = new Date(now); stamp.setDate(stamp.getDate() - day); stamp.setHours(8, i * 3 + (i > 12 ? 80 : 0));
                events.push({ type: 'assistant', timestamp: stamp.toISOString(), cwd: join(f.home, ['private-project', 'synthetic-studio', 'synthetic-service'][s % 3]), sessionId: `synthetic-${day}-${s}`, message: { id: `response-${i}`, model: s % 3 === 0 ? 'claude-opus-synthetic' : 'claude-sonnet-synthetic', usage: { input_tokens: 8000 + day * 120, output_tokens: 600 + (i * 139) % 1800, cache_read_input_tokens: 45000 + i * (7000 + day * 1200), cache_creation_input_tokens: i === 0 || i === 13 ? 28000 + day * 1000 : 0 } } });
            }
            await writeFile(join(f.claude, `synthetic-${day}-${s}.jsonl`), events.map(e => JSON.stringify(e)).join('\n'));
        }
    }
    return f;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await reportFixtures(resolve('test/fixtures/data'));
    process.stdout.write('Synthetic multi-day report fixtures generated.\n');
}
