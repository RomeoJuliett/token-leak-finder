import type { Analysis, Day, Group, SessionSummary } from './types.js';
import { ESTIMATES } from './config.js';

export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
export const compact = (n: number): string => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : fmt(n);
const text = escapeHtml;
const colors = ['#a855f7', '#ff8a3d', '#3b82f6', '#ff2d78'];
export const tip = (label: string): string => `tabindex="0" role="img" aria-label="${text(label)}" data-tip="${text(label)}"`;
const legend = (labels: string[]) => `<div class="legend">${labels.map((label, i) => `<span><i style="background:${colors[i]}"></i>${text(label)}</span>`).join('')}</div>`;
const shell = (label: string, body: string, height = 240) => `<svg class="plot" role="group" aria-label="${text(label)}" viewBox="0 0 800 ${height}">${body}</svg>`;

export function bars(groups: Group[], label: string, weighted = true): string {
    const data = groups.slice(0, 8), value = (g: Group) => weighted ? g.tokens.weighted : g.tokens.total;
    const max = Math.max(1, ...data.map(value));
    return `<div class="bar-list" aria-label="${text(label)}">${data.map((g, i) => `<div class="bar-row"><div class="bar-label"><span>${text(g.name)}</span><strong>${compact(value(g))}</strong></div><svg role="group" aria-label="${text(g.name)}" viewBox="0 0 600 14" preserveAspectRatio="none"><rect width="600" height="14" rx="7" fill="var(--line)"/><g ${tip(`${g.name}: ${fmt(value(g))}${weighted ? ' weighted tokens' : ''}`)}><rect width="600" height="14" fill="transparent"/><rect class="grow-x" width="${value(g) / max * 600}" height="14" rx="7" fill="${colors[i % 4]}"/></g></svg></div>`).join('') || '<p class="muted">No activity in this range</p>'}</div>`;
}

export function tokenDonut(a: Analysis): string {
    const t = a.totals;
    const values = [t.input * ESTIMATES.inputWeight, t.output * ESTIMATES.outputWeight, t.cacheRead * ESTIMATES.cacheReadWeight, t.cacheWrite * ESTIMATES.cacheWriteWeight];
    const raw = [t.input, t.output, t.cacheRead, t.cacheWrite], names = ['Fresh input', 'Output', 'Cache read', 'Cache write'];
    let offset = 0;
    const arcs = values.map((v, i) => {
        const size = v / (t.weighted || 1) * 100;
        const arc = `<circle class="donut-arc" ${tip(`${names[i]}: ${fmt(v)} weighted tokens (${(size).toFixed(1)}%); ${fmt(raw[i])} raw tokens`)} cx="120" cy="120" r="88" pathLength="100" fill="none" stroke="${colors[i]}" stroke-width="23" stroke-dasharray="${size} ${100 - size}" stroke-dashoffset="${-offset}" transform="rotate(-90 120 120)"/>`;
        offset += size; return arc;
    }).join('');
    // Clip-path uses a local SVG identifier, never an external resource.
    return `<div class="donut"><svg role="group" aria-label="Where weighted tokens went" viewBox="0 0 240 240"><defs><clipPath id="donut-sweep"><path id="sweep-path" d="M120 120 L120 -60 A180 180 0 1 1 119.99 -60 Z"/></clipPath></defs><circle cx="120" cy="120" r="88" fill="none" stroke="var(--line)" stroke-width="23"/><g clip-path="url(#donut-sweep)">${arcs}</g><text x="120" y="116" text-anchor="middle" class="donut-value">${compact(t.weighted)}</text><text x="120" y="138" text-anchor="middle" class="axis">weighted tokens</text></svg><div class="model-legend">${names.map((n, i) => `<div><i style="background:${colors[i]}"></i><span>${n}<small>${compact(raw[i])} raw</small></span><strong>${compact(values[i])}<small>weighted</small></strong></div>`).join('')}</div></div>`;
}

export function contextBands(a: Analysis): string {
    const max = Math.max(1, ...a.contextBands.map(b => b.responses));
    const bandColors = ['#3b82f6', '#a855f7', '#ff8a3d', '#ff2d78'];
    const stripes = '<defs><pattern id="context-checkpoint-stripes" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2 -2M0 8L8 0M6 10L10 6" fill="none" stroke="white" stroke-opacity=".2" stroke-width="1"/></pattern></defs>';
    return `<div class="band-chart"><div class="checkpoint">150k checkpoint ↓</div>${shell('Context bands: responses by context size; 150k checkpoint inside the 100–200k band', stripes + a.contextBands.map((b, i) => {
        const x = 44 + i * 192, h = b.responses / max * 130;
        const shape = `x="${x}" y="${175 - h}" width="136" height="${h}" rx="7"`;
        return `<g ${tip(`${b.label} context: ${fmt(b.responses)} responses in ${fmt(b.sessions)} sessions${i === 1 ? '; contains the 150k checkpoint' : ''}`)}><rect x="${x}" y="24" width="136" height="155" fill="transparent"/><g class="grow-y"><rect class="context-band" ${shape} fill="${bandColors[i]}"/>${i > 0 ? `<clipPath id="context-band-${i}"><rect ${shape}/></clipPath><rect x="${i === 1 ? 304 : x}" y="${175 - h}" width="${i === 1 ? 68 : 136}" height="${h}" fill="url(#context-checkpoint-stripes)" clip-path="url(#context-band-${i})"/>` : ''}</g><text x="${x + 68}" y="${165 - h}" text-anchor="middle" class="plot-value">${fmt(b.responses)}</text><text x="${x + 68}" y="202" text-anchor="middle" class="axis">${text(b.label)}</text><text x="${x + 68}" y="222" text-anchor="middle" class="axis">${fmt(b.sessions)} sessions</text></g>`;
    }).join('') + '<line x1="304" y1="16" x2="304" y2="178" class="threshold"/>')}</div><p class="range">Responses per band · the 100–200k band straddles the checkpoint; diagonal stripes mark context above 150k.</p>`;
}

export function daily(days: Day[]): string {
    const max = Math.max(1, ...days.map(d => d.tokens.weighted)), w = 744 / Math.max(1, days.length);
    return shell('Daily weighted usage and allocated avoidable estimate, local calendar days', `<text x="16" y="20" class="axis">${compact(max)} weighted</text><line x1="28" y1="190" x2="780" y2="190" class="gridline"/>${days.map((d, i) => {
        const x = 30 + i * w, h = d.tokens.weighted / max * 146, avoid = d.avoidableTokens / max * 146;
        return `<g ${tip(`${d.name}: ${fmt(d.tokens.weighted)} weighted tokens; ${fmt(d.avoidableTokens)} potentially avoidable (allocated estimate)`)}><rect x="${x}" y="35" width="${w}" height="160" fill="transparent"/><rect class="grow-y" x="${x}" y="${190 - h}" width="${Math.max(.05, w * .72)}" height="${h}" rx="${Math.min(3, w / 4)}" fill="${colors[2]}"/><rect class="grow-y" x="${x}" y="${190 - avoid}" width="${Math.max(.05, w * .72)}" height="${avoid}" rx="${Math.min(3, w / 4)}" fill="${colors[3]}"/>${i % Math.max(1, Math.ceil(days.length / 5)) === 0 ? `<text x="${x}" y="218" class="axis">${text(d.name.slice(5))}</text>` : ''}</g>`;
    }).join('')}`) + `<div class="legend"><span><i style="background:${colors[2]}"></i>Weighted usage</span><span><i style="background:${colors[3]}"></i>Potentially avoidable</span></div>`;
}

export function stackedArea(days: Day[]): string {
    // Three requested streams; cache writes are disclosed separately, not folded into input.
    const names = ['Cache read ×0.1', 'Output ×5', 'Fresh input ×1'];
    const values = days.map(d => [d.tokens.cacheRead * ESTIMATES.cacheReadWeight, d.tokens.output * ESTIMATES.outputWeight, d.tokens.input * ESTIMATES.inputWeight]);
    const max = Math.max(1, ...values.map(v => v.reduce((n, k) => n + k, 0)));
    const x = (i: number) => days.length === 1 ? 400 : 30 + i / Math.max(1, days.length - 1) * 740, y = (n: number) => 170 - n / max * 130;
    const paths = names.map((name, k) => {
        const low = values.map(v => v.slice(0, k).reduce((n, z) => n + z, 0)), high = values.map((v, i) => low[i] + v[k]);
        const points = high.map((v, i) => `${x(i)},${y(v)}`).concat(low.map((v, i) => `${x(i)},${y(v)}`).reverse());
        return `<polygon class="area-fill" points="${points.join(' ')}" fill="${colors[k]}" opacity=".8"/>`;
    }).join('');
    const marks = days.map((d, i) => `<g ${tip(`${d.name}: cache read ${fmt(values[i][0])}, output ${fmt(values[i][1])}, fresh input ${fmt(values[i][2])} weighted tokens`)}><rect x="${Math.max(26, x(i) - 370 / Math.max(1, days.length - 1))}" y="30" width="${Math.min(774, x(i) + 370 / Math.max(1, days.length - 1)) - Math.max(26, x(i) - 370 / Math.max(1, days.length - 1))}" height="146" fill="transparent"/>${values[i].map((_, k) => `<circle cx="${x(i)}" cy="${y(values[i].slice(0, k + 1).reduce((n, v) => n + v, 0))}" r="2.5" fill="${colors[k]}"/>`).join('')}</g>`).join('');
    return shell('Daily cache read, output and fresh input, weighted', `<text x="16" y="20" class="axis">${compact(max)} weighted</text>${paths}${marks}<text x="30" y="198" class="axis">${text(days[0]?.name ?? '')}</text><text x="770" y="198" text-anchor="end" class="axis">${text(days.at(-1)?.name ?? '')}</text>`, 215) + legend(names) + '<p class="range">Cache writes are excluded from this three-stream view; the usage timeline includes them.</p>';
}

export function waterfall(a: Analysis): string {
    const ranked = new Map<string, number>();
    for (const c of a.avoidableContributions) ranked.set(c.category, (ranked.get(c.category) ?? 0) + c.weightedTokens);
    const items = [...ranked].sort((a, b) => b[1] - a[1]);
    const total = a.totals.weighted, scale = 168 / Math.max(1, total), w = 744 / (items.length + 3);
    let remaining = total;
    const columns = [{ label: 'Total usage', value: total, low: 0, color: colors[2], caption: 'Total', detail: 'Observed weighted usage' }, ...items.map(([category, value]) => {
        remaining -= value;
        const label = a.leaks.find(l => l.category === category)?.title ?? category;
        return { label, value, low: Math.max(0, remaining), color: colors[3], caption: `−${compact(value)}`, detail: 'Non-overlapping allocated contribution, after 50% allowance' };
    }), { label: 'Retained usage', value: Math.max(0, remaining), low: 0, color: '#717184', caption: 'Retained', detail: 'Total minus the avoidable scenario' }, { label: 'Potentially avoidable total', value: a.avoidableTokens, low: 0, color: colors[0], caption: 'Avoidable', detail: 'Same estimate as the headline' }];
    return shell('Leak waterfall: total minus ranked disjoint contributions equals retained usage; final bar shows avoidable total', columns.map((c, i) => `<g class="water-step" style="--step:${i}" ${tip(`${c.label}: ${fmt(c.value)} weighted tokens. ${c.detail}`)}><rect x="${30 + i * w}" y="20" width="${w * .8}" height="192" fill="transparent"/><rect x="${30 + i * w}" y="${205 - (c.value + c.low) * scale}" width="${w * .8}" height="${c.value * scale}" rx="4" fill="${c.color}"/><text x="${30 + (i + .4) * w}" y="${Math.max(24, 195 - (c.value + c.low) * scale)}" text-anchor="middle" class="plot-value">${compact(c.value)}</text>${i <= items.length ? `<line x1="${30 + (i + .8) * w}" x2="${30 + (i + 1) * w}" y1="${205 - (i === 0 ? total : c.low) * scale}" y2="${205 - (i === 0 ? total : c.low) * scale}" class="gridline" stroke-dasharray="3 3"/>` : ''}<text x="${30 + (i + .4) * w}" y="230" text-anchor="middle" class="axis">${text(c.caption)}</text></g>`).join(''), 255) + `<ol class="water-key">${items.map(([category, value]) => `<li>${text(a.leaks.find(l => l.category === category)?.title ?? category)} <b>${compact(value)}</b></li>`).join('') || '<li>No supported avoidable contributions.</li>'}</ol><p class="range">Total − ranked contributions = retained usage. The final bar isolates the avoidable total. Diagnostics and model choice are excluded; overlapping cards are never summed.</p>`;
}

export function offenderSparks(a: Analysis, category: string): string {
    const metric = category === 'long_context_no_compaction' ? 'longContextWeightedTokens' : category === 'resumed_idle_sessions' ? 'idleRewriteTokens' : undefined;
    if (!metric) return '';
    const sessions = a.sessions.filter(s => s[metric] > 0).sort((x, y) => y[metric] - x[metric]).slice(0, 6);
    return `<div class="sparks"><p class="category">Context per response · 150k guide</p>${sessions.map(s => spark(s)).join('')}</div>`;
}
function spark(s: SessionSummary): string {
    const values = s.contextSparkline ?? [], max = Math.max(180000, ...values), y = (v: number) => 48 - v / max * 40, x = (i: number) => 5 + i / Math.max(1, values.length - 1) * 220;
    return `<div class="spark-row"><span>${text(s.project)} · ${text(s.id)}<small>${fmt(s.turns)} responses · peak ${compact(s.peakContext)}</small></span><svg role="group" aria-label="${text(s.id)} context trajectory, ${values.length} samples" viewBox="0 0 230 56"><line x1="5" x2="225" y1="${y(150000)}" y2="${y(150000)}" class="threshold"/><polyline class="spark-line" fill="none" stroke="${colors[0]}" stroke-width="2" points="${values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>${values.map((v, i) => `<circle ${tip(`${s.id}: context sample ${i + 1} of ${values.length}, ${fmt(v)} context tokens; 150,000 checkpoint`)} cx="${x(i)}" cy="${y(v)}" r="4" fill="${colors[0]}"/>`).join('')}</svg></div>`;
}
