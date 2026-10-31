import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SENTINEL = 'SECRET_PROMPT_SENTINEL sk-fixtureSecretKey123456789 ghp_fixtureSecret123456789 xoxb-secret123456789 alice@example.test';
export async function fixtures(root: string) {
    const home = join(root, 'home'), project = join(home, 'private-project');
    const claude = join(root, 'claude'), codex = join(root, 'codex');
    await Promise.all([mkdir(join(claude, 'project/subagents'), { recursive: true }), mkdir(join(codex, '2026/10/31'), { recursive: true }), mkdir(join(home, '.claude'), { recursive: true }), mkdir(join(home, '.codex'), { recursive: true }), mkdir(project, { recursive: true })]);
    const now = Date.now() - 4 * 3600000;
    const stamp = (n: number) => new Date(now + n * 60000).toISOString();
    const a: any[] = [{ type: 'user', sessionId: 'session-secret', cwd: project, timestamp: stamp(0), message: { content: SENTINEL } }];
    for (let i = 0; i < 7; i++) {
        const event = { type: 'assistant', sessionId: 'session-secret', cwd: project, timestamp: stamp(i + 1), requestId: 'req-' + i, message: { id: 'msg-' + i, model: 'claude-opus-4-6', usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: i === 0 ? 12000 : 0, cache_read_input_tokens: [80000, 120000, 180000, 300000, 600000, 800000, 967000][i] }, content: [{ type: 'text', text: SENTINEL }, { type: 'tool_use', id: 'read-' + i, name: i === 6 ? 'mcp__github__search' : 'Read', input: { file_path: join(project, 'source.ts'), query: SENTINEL } }] } };
        a.push(event, JSON.parse(JSON.stringify(event)), { type: 'user', sessionId: 'session-secret', timestamp: stamp(i + 1), message: { content: [{ type: 'tool_result', tool_use_id: 'read-' + i, content: i === 2 ? 'X'.repeat(48000) + SENTINEL : SENTINEL }] } });
    }
    a.push({ type: 'system', subtype: 'compact_boundary', timestamp: stamp(9) }, { type: 'assistant', timestamp: stamp(130), message: { id: 'after-idle', model: 'claude-sonnet-4-6', usage: { input_tokens: 500, output_tokens: 50, cache_creation_input_tokens: 20000, cache_read_input_tokens: 10000 }, content: [] } });
    await writeFile(join(claude, 'project/main.jsonl'), a.map(x => JSON.stringify(x)).join('\n') + '\n{broken\n' + JSON.stringify({ type: 'future', mystery: SENTINEL }) + '\n');
    await writeFile(join(claude, 'project/subagents/agent.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'session-secret', isSidechain: true, cwd: project, timestamp: stamp(2), message: { id: 'side', model: 'claude-haiku-4-5', usage: { input_tokens: 5000, output_tokens: 100 }, content: [] } }) + '\n');
    const b: any[] = [{ type: 'session_meta', timestamp: stamp(0), payload: { id: 'codex-secret', cwd: project, instructions: SENTINEL } }, { type: 'turn_context', timestamp: stamp(1), payload: { model: 'gpt-6.1-sol', effort: 'high', cwd: project } }];
    for (let i = 0; i < 3; i++) {
        b.push({ type: 'response_item', timestamp: stamp(i + 2), payload: { type: 'function_call', name: 'shell', call_id: 'call-' + i, arguments: JSON.stringify({ command: ['cat', join(project, 'source.ts')] }) } }, { type: 'response_item', timestamp: stamp(i + 2), payload: { type: 'function_call_output', call_id: 'call-' + i, output: SENTINEL } });
        const counts = { input_tokens: 1000 * (i + 1), cached_input_tokens: 400 * (i + 1), output_tokens: 200 * (i + 1), reasoning_output_tokens: 100 * (i + 1), total_tokens: 1200 * (i + 1) };
        const e = { type: 'event_msg', timestamp: stamp(i + 2), payload: { type: 'token_count', info: { total_token_usage: counts, last_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, reasoning_output_tokens: 100, total_tokens: 1200 }, model_context_window: 200000 } } };
        b.push(e, e);
    }
    b.push({ type: 'compacted', timestamp: stamp(8), payload: { message: SENTINEL } });
    await writeFile(join(codex, '2026/10/31/rollout-fixture.jsonl'), b.map(x => JSON.stringify(x)).join('\n') + '\n');
    await writeFile(join(project, 'AGENTS.md'), 'PRIVATE_INSTRUCTION_SENTINEL'.repeat(1000));
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { github: { env: { SECRET: SENTINEL } }, 'private-company': { args: [SENTINEL] } } }));
    await writeFile(join(home, '.codex/config.toml'), '[mcp_servers.private-codex]\ncommand = "' + SENTINEL + '"\n');
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { 'project-private': { headers: { authorization: SENTINEL } } } }));
    return { root, home, project, claude, codex };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await fixtures(resolve('test/fixtures/data'));
    process.stdout.write('Synthetic fixtures generated.\n');
}
