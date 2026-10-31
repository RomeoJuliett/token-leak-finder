export type Source = 'claude' | 'codex';
export interface Tokens {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    total: number;
    weighted: number;
}
export interface Turn {
    timestamp: number;
    model: string;
    tokens: Tokens;
    context: number;
    segment: number;
    contextWindow: number;
}
export interface ToolCall {
    id: string;
    name: string;
    server?: string;
    resultTokens: number;
    files: string[];
}
export interface FileRead {
    path: string;
    tokens: number;
    tool: string;
}
export interface ParseStats {
    lines: number;
    malformed: number;
    unknown: number;
    oversized: number;
    filtered: number;
    duplicates: number;
    untimed: number;
    bytes: number;
    errors: number;
}
export interface ParsedSession {
    id: string;
    source: Source;
    project: string;
    sidechain: boolean;
    turns: Turn[];
    tools: ToolCall[];
    reads: FileRead[];
    compactions: number;
    compactionTimes: number[];
    stats: ParseStats;
}
export interface Options {
    claudeDir: string;
    codexDir: string;
    homeDir: string;
    since: number;
    until: number;
    redact: boolean;
    only?: Source;
    project?: string;
    maxLineBytes: number;
    concurrency: number;
    hugeOutputTokens: number;
    contextThreshold: number;
    topTierPatterns?: string[];
    progress?: (completed: number, total: number, bytes: number) => void;
}
export interface Group {
    name: string;
    tokens: Tokens;
    calls: number;
    sessions: number;
}
export interface SessionSummary {
    id: string;
    source: Source;
    project: string;
    model: string;
    tokens: Tokens;
    turns: number;
    peakContext: number;
    compactions: number;
    baseline: number;
    baselineReplayed: number;
    sidechain: boolean;
    contextTokens: number;
    contextWeightedTokens: number;
    baselineWeightedTokens: number;
    longContextWeightedTokens: number;
    highContextResponses: number;
    highContextRawTokens: number;
    highContextWeightedTokens: number;
    longContextTokens: number;
    longContextTurns: number;
    idleRewriteTokens: number;
    start: string;
    end: string;
}
export interface RepeatedRead {
    source: Source;
    project: string;
    session: string;
    path: string;
    reads: number;
    repeated: number;
    estimatedTokens: number;
}
export interface HugeOutput {
    source: Source;
    project: string;
    session: string;
    tool: string;
    estimatedTokens: number;
}
export interface Instruction {
    sources: Source[];
    project: string;
    path: string;
    bytes: number;
    estimatedTokens: number;
    estimatedResentTokens: number;
    sessions: number;
    turns: number;
}
export interface Mcp {
    name: string;
    source: Source;
    projects: string[];
    configured: boolean;
    calls: number;
    estimatedSchemaTokens: number;
    estimatedResentTokens: number;
    resultTokens: number;
}
export interface Leak {
    category: string;
    title: string;
    /** Primary estimate, in limit-weighted tokens; retained as an alias. */
    estimatedTokens: number;
    weightedTokens: number;
    rawEstimatedTokens: number;
    percent: number;
    why: string;
    fix: string;
    evidence: string[];
    snippet: string;
    confidence: 'heuristic' | 'observed-size';
}
export interface Analysis {
    version: string;
    redacted: boolean;
    range: {
        since: string;
        until: string;
        days: number;
    };
    sources: Record<Source, { filesScanned: number; sessionsWithUsage: number; toolOnlySessions: number; filesWithoutUsage: number; filesWithErrors: number }>;
    unit: 'limit-weighted tokens (estimate)';
    topTierPatterns: string[];
    contextBands: { label: string; responses: number; sessions: number }[];
    highContext: { sessions: number; responses: number; compactAt: number; rawEstimatedTokens: number; weightedTokens: number };
    avoidableRawTokens: number;
    avoidableContributions: { session: string; source: Source; category: string; weightedTokens: number; rawEstimatedTokens: number }[];
    totals: Tokens;
    avoidableTokens: number;
    avoidablePercent: number;
    sessions: SessionSummary[];
    projects: Group[];
    models: Group[];
    tools: Group[];
    days: Group[];
    mcps: Mcp[];
    instructions: Instruction[];
    repeatedReads: RepeatedRead[];
    hugeOutputs: HugeOutput[];
    leaks: Leak[];
    costLevers: Leak[];
    repeatedFiles: { path: string; projects: string[]; sessions: number; reads: number; repeated: number; estimatedTokens: number }[];
    stats: ParseStats & {
        files: number;
        filesFiltered: number;
        fileErrors: number;
        configErrors: number;
        configSkipped: number;
    };
    estimates: Record<string, number>;
    notes: string[];
}
