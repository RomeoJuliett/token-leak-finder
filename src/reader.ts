import { createReadStream } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { createInterface } from 'node:readline';
import type { ParseStats } from './types.js';
export function emptyStats(): ParseStats { return { lines: 0, malformed: 0, unknown: 0, oversized: 0, filtered: 0, duplicates: 0, untimed: 0, bytes: 0, errors: 0 }; }
// Enforce the cap BEFORE readline allocates a line. Discard an entire oversized
// physical line, including subsequent chunks, then resume at the next newline.
class LineGuard extends Transform {
    private chunks: Buffer[] = [];
    private length = 0;
    private dropping = false;
    constructor(private cap: number, private stats: ParseStats) { super(); }
    private segment(b: Buffer, end: boolean) {
        this.length += b.length;
        if (this.length > this.cap) {
            this.dropping = true;
            this.chunks = [];
        }
        else if (!this.dropping)
            this.chunks.push(b);
        if (end) {
            if (this.dropping)
                this.stats.oversized++;
            else {
                this.push(Buffer.concat(this.chunks, this.length));
                this.push('\n');
            }
            this.chunks = [];
            this.length = 0;
            this.dropping = false;
        }
    }
    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) { this.stats.bytes += chunk.length; let start = 0; for (let i = chunk.indexOf(10); i >= 0; i = chunk.indexOf(10, start)) {
        this.segment(chunk.subarray(start, i), true);
        start = i + 1;
    } if (start < chunk.length)
        this.segment(chunk.subarray(start), false); callback(); }
    _flush(callback: TransformCallback) { if (this.length)
        this.segment(Buffer.alloc(0), true); callback(); }
}
export async function* lines(file: string, cap: number, stats: ParseStats): AsyncGenerator<string> {
    const input = createReadStream(file, { highWaterMark: 256 * 1024 });
    const guard = new LineGuard(cap, stats);
    input.on('error', e => guard.destroy(e));
    input.pipe(guard);
    const rl = createInterface({ input: guard, crlfDelay: Infinity });
    try {
        for await (const line of rl) {
            stats.lines++;
            yield line;
        }
    }
    finally {
        rl.close();
        input.destroy();
        guard.destroy();
    }
}
