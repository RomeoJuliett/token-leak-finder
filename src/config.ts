import type { Tokens } from './types.js';
// These are relative heuristic weights, NOT provider quota rules or prices.
export const ESTIMATES = Object.freeze({ inputWeight: 1, outputWeight: 5, cacheReadWeight: 0.1, cacheWriteWeight: 1.25, charsPerToken: 4, schemaTokensPerServer: 1000, bigInstructionTokens: 4000, bigBaselineTokens: 10000, longContextMinTurns: 5, idleGapMs: 3600000, idleRewriteMinTokens: 10000, tinyTaskOutputTokens: 500, rarelyUsedCalls: 2, actionableFraction: 0.5, compactAt: 150000 });
export function emptyTokens(): Tokens { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, weighted: 0 }; }
export function finishTokens(t: Tokens): Tokens { t.total = t.input + t.output + t.cacheRead + t.cacheWrite; t.weighted = t.input * ESTIMATES.inputWeight + t.output * ESTIMATES.outputWeight + t.cacheRead * ESTIMATES.cacheReadWeight + t.cacheWrite * ESTIMATES.cacheWriteWeight; return t; }
export function addTokens(a: Tokens, b: Tokens): void { for (const k of Object.keys(a) as (keyof Tokens)[])
    a[k] += b[k]; }
export const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
export const identifier = (v: unknown, fallback = 'unknown'): string => typeof v === 'string' && /^[\w.:/+@-]{1,180}$/.test(v) ? v : fallback;
export const pathValue = (v: unknown): string | undefined => typeof v === 'string' && v.length <= 4096 && !/[\x00-\x1f]/.test(v) ? v : undefined;

export const DEFAULT_TOP_TIER_PATTERNS = ['*opus*', '*:high', '*:xhigh', '*:ultra', '*:max'];
// Case-insensitive globs: only * is special; no user-supplied regular expressions.
export function isTopTier(model: string, patterns: string[]): boolean {
    return patterns.some(pattern => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i').test(model));
}
export function contextCost(t: Tokens): number {
    return t.input * ESTIMATES.inputWeight + t.cacheRead * ESTIMATES.cacheReadWeight + t.cacheWrite * ESTIMATES.cacheWriteWeight;
}
