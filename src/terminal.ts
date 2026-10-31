import { basename } from 'node:path';
import { scrub } from './privacy.js';
import type { Analysis } from './types.js';

const compact = (n: number): string => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
    : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(2) + 'k' : String(Math.round(n));
const clean = (s: string): string => scrub(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '');

// Plain text for both TTY and redirected output; NO_COLOR needs no special case.
export function oneLineSummary(a: Analysis, out: string): string {
    const top = a.leaks[0];
    const name = top?.category === 'long_context_no_compaction' ? 'long chats without compaction' : top?.title.toLowerCase();
    return `${compact(a.totals.weighted)} limit-weighted tokens · ~${a.avoidablePercent}% likely avoidable · top leak: ${top ? `${name} (${top.percent}%)` : 'none detected'} → ${clean(a.redacted ? basename(out) : out)}`;
}

export function noLogsMessage(roots: { source: string; path: string }[], redacted: boolean): string {
    return [
        'No logs found in the selected time window (default: 30d).',
        'Looked in:',
        ...roots.map((root, i) => `  ${root.source}: ${redacted ? `[log root ${i + 1}; path hidden by --redact]` : clean(root.path)}`),
        'Start a Claude Code or Codex session, or try --since 90d.',
        'Point to logs with --claude-dir <projects> / --codex-dir <sessions>,',
        'or set CLAUDE_CONFIG_DIR (comma-separated config directories) / CODEX_HOME.',
        'Nothing was uploaded. Logs were read-only; no report was written.',
    ].join('\n') + '\n';
}
