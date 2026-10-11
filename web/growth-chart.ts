// The "why this shape" chart: one bar per worked round showing its growth
// compared to a flat piece, over bands that say what that growth makes,
// with the verdict of each round built so far written underneath.

import { GROWTH_BANDS, type RoundProfile, type Verdict } from "../src/shape/profile.js";

/** One color per verdict, in a fixed order (validated for color-blind separation). */
export const VERDICT_COLORS: Record<Verdict, string> = {
  start: "#8f8a80",
  flat: "#2a78d6",
  cup: "#eb6834",
  wall: "#1baf7a",
  "curls in": "#eda100",
  ruffles: "#e87ba4",
};

export function renderGrowthChart(
  profiles: RoundProfile[],
  built: RoundProfile[],
  current: number[],
  width: number,
): string {
  const rounds = profiles.filter((p) => p.growth !== undefined);
  if (rounds.length === 0) return `<p class="muted">The start ring has no growth to show yet.</p>`;
  const builtRounds = new Set(built.map((r) => r.round));

  const gutter = 116;
  const slot = Math.max(38, Math.min(64, (width - gutter - 8) / rounds.length));
  const w = gutter + slot * rounds.length + 8;
  const [top, plot] = [8, 150];
  const values = rounds.map((r) => r.growth!);
  const lo = Math.max(-2.5, Math.min(-0.5, ...values));
  const hi = Math.min(3, Math.max(2, ...values));
  const y = (v: number) => top + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * plot;
  const h = top + plot + 44;

  const out: string[] = [];
  // Bands, bottom to top, labelled in the gutter.
  let from = lo;
  for (const band of GROWTH_BANDS) {
    const to = Math.min(band.max, hi);
    if (to > from) {
      const cls = band.label === "flat" ? "band flat" : "band";
      out.push(`<rect class="${cls}" x="${gutter}" y="${y(to)}" width="${w - gutter - 8}" height="${y(from) - y(to)}"/>`);
      out.push(`<text class="band-label" x="${gutter - 8}" y="${(y(from) + y(to)) / 2 + 4}" text-anchor="end">${band.label}</text>`);
    }
    from = Math.max(from, band.max);
  }
  out.push(`<line class="grid" x1="${gutter}" x2="${w - 8}" y1="${y(0)}" y2="${y(0)}"/>`);
  out.push(`<line class="flat-line" x1="${gutter}" x2="${w - 8}" y1="${y(1)}" y2="${y(1)}"/>`);

  rounds.forEach((p, i) => {
    const x = gutter + i * slot;
    const g = p.growth!;
    const isCurrent = current.includes(p.round);
    const [y0, y1] = [y(0), y(g)];
    const shape = builtRounds.has(p.round) ? p : undefined;
    const tip = [
      `Round ${p.round}: growth ${(g + 0.0001).toFixed(2)}, ${p.verdict}`,
      p.ruffle > 0 ? `ruffles ${p.ruffle.toFixed(1)} mm high, ${p.waves} waves` : `fabric at ${Math.round(p.angle!)}°`,
      shape ? "" : "not built yet at this step",
    ]
      .filter(Boolean)
      .join(" · ");
    out.push(
      `<rect class="hit" data-round="${p.round}" data-tip="${esc(tip)}" x="${x}" y="${top}" width="${slot}" height="${h - top}"/>`,
    );
    const barW = Math.min(18, slot - 12);
    out.push(
      `<rect class="bar${isCurrent ? " current" : ""}" x="${x + (slot - barW) / 2}" y="${Math.min(y0, y1)}" width="${barW}" height="${Math.max(Math.abs(y1 - y0), 1.5)}" rx="3"/>`,
    );
    const cx = x + slot / 2;
    out.push(`<text class="tick${isCurrent ? " current" : ""}" x="${cx}" y="${top + plot + 15}" text-anchor="middle">${p.round}</text>`);
    if (shape) {
      out.push(`<circle class="verdict-dot" cx="${cx}" cy="${top + plot + 25}" r="4" fill="${VERDICT_COLORS[shape.verdict]}"/>`);
      out.push(
        `<text class="verdict${isCurrent ? " current" : ""}" x="${cx}" y="${top + plot + 41}" text-anchor="middle">${esc(shape.verdict)}</text>`,
      );
    }
  });
  out.push(`<text class="band-label" x="${gutter - 8}" y="${top + plot + 15}" text-anchor="end">round</text>`);
  out.push(`<text class="band-label" x="${gutter - 8}" y="${top + plot + 41}" text-anchor="end">shape</text>`);

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Growth per round compared to a flat piece">${out.join("")}</svg>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
