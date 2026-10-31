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
    longContextTokens: number;
    longContextTurns: number;
    idleRewriteTokens: number;
    start: string;
    end: string;
}
export interface RepeatedRead {
    project: string;
    session: string;
    path: string;
    reads: number;
    repeated: number;
    estimatedTokens: number;
}
export interface HugeOutput {
    project: string;
    session: string;
    tool: string;
    estimatedTokens: number;
}
export interface Instruction {
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
    estimatedTokens: number;
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
    sources: {
        claude: number;
        codex: number;
    };
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
