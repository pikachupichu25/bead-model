// What the Nora designer prints and lists: the bead list to buy and the
// printable chart. See docs/nora-net-spec.md §8.

import type { ResolvedBead, Shape } from "../catalog/catalog.js";
import { beadCorner, darken, escapeXml, fmt } from "../diagram/svg.js";
import { type BeadListRow, gramsToBuy, SPARE } from "../flat/chart.js";
import { completeGroups, countBeads, filledBounds, type NoraDesign, openGroups } from "./design.js";
import { groupOutline, type NetSize, netSize, parseSlotKey, slotAngle, slotCenter } from "./net.js";

/** Every bead of the design in key order, with its count and grams. A shared bead counts once. */
export function beadList(
  design: NoraDesign,
  beads: ReadonlyMap<string, ResolvedBead>,
): { rows: BeadListRow[]; total: { count: number; grams?: number } } {
  const rows = [...countBeads(design)].map(([key, count]) => {
    const bead = beads.get(key);
    return { key, label: bead?.label ?? key, rgb: bead?.display.rgb ?? "#999", count, grams: gramsToBuy(count, bead?.beadsPerGram) };
  });
  const count = rows.reduce((sum, r) => sum + r.count, 0);
  const used = rows.filter((r) => r.count > 0);
  const grams = used.length > 0 && used.every((r) => r.grams !== undefined) ? used.reduce((sum, r) => sum + r.grams!, 0) : undefined;
  return { rows, total: { count, grams } };
}

/** The size of a design in mm: its beads' centers plus one bead all round. */
export function designRect(design: NoraDesign, net: NetSize): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const b = filledBounds(design);
  if (!b) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const k of design.slots.keys()) {
    const c = slotCenter(parseSlotKey(k), net);
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
  }
  const r = net.d / 2;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

const INK = "#222222";
const MUTED = "#666666";
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
/** Beads are drawn this wide across on paper, in mm. */
const BEAD_MM = 5;
const MARGIN = 12;

export interface ChartInput {
  design: NoraDesign;
  beads: ReadonlyMap<string, ResolvedBead>;
  /** The bead's diameter and its length along the hole, in mm. */
  d: number;
  w: number;
  shape: Shape;
  sizeLabel: string;
}

/** A printable SVG (in mm): the title, the net to scale with group outlines and axes, and the bead list. */
export function renderNoraChartSvg({ design, beads, d, w, shape, sizeLabel }: ChartInput): string {
  const net = netSize(d);
  const rect = designRect(design, net);
  const k = BEAD_MM / d;
  const top = 36;
  const parts: string[] = [];

  const pieceW = rect ? rect.x1 - rect.x0 : 0;
  const pieceH = rect ? rect.y1 - rect.y0 : 0;
  const width = Math.max(180, MARGIN * 2 + pieceW * k);

  parts.push(text(MARGIN, 18, design.title || "Untitled design", 7, INK, "650"));
  const facts = [sizeLabel];
  if (rect) facts.push(`${design.slots.size.toLocaleString("en-US")} beads`, `${(pieceW / 10).toFixed(1)} × ${(pieceH / 10).toFixed(1)} cm`);
  const open = openGroups(design).length;
  if (open) facts.push(`${open} ring${open === 1 ? " is" : "s are"} not closed`);
  parts.push(text(MARGIN, 25, facts.join(" · "), 3.5, MUTED));

  let y = top;
  if (rect) {
    const x0 = (width - pieceW * k) / 2;
    const at = (p: { x: number; y: number }) => ({ x: x0 + (p.x - rect.x0) * k, y: y + (p.y - rect.y0) * k });

    // Outlines of the closed rings behind the beads.
    for (const g of completeGroups(design)) {
      const pts = groupOutline(g, net).map(at);
      parts.push(`<polygon points="${pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ")}" fill="none" stroke="#d8d3c8" stroke-width="0.2"/>`);
    }

    // Symmetry axes.
    const { mode, column, row } = design.symmetry;
    if (mode === "left-right" || mode === "both") {
      const ax = at({ x: column * net.L, y: 0 }).x;
      parts.push(`<line x1="${fmt(ax)}" y1="${fmt(y - 2)}" x2="${fmt(ax)}" y2="${fmt(y + pieceH * k + 2)}" stroke="#3c5a99" stroke-width="0.25" stroke-dasharray="1.5 1"/>`);
    }
    if (mode === "up-down" || mode === "both") {
      const ay = at({ x: 0, y: row * net.H }).y;
      parts.push(`<line x1="${fmt(x0 - 2)}" y1="${fmt(ay)}" x2="${fmt(x0 + pieceW * k + 2)}" y2="${fmt(ay)}" stroke="#3c5a99" stroke-width="0.25" stroke-dasharray="1.5 1"/>`);
    }

    // Beads, each turned along its edge.
    const bw = w * k * 0.92;
    const bd = d * k * 0.92;
    const [rx, ry] = beadCorner(shape, bw, bd);
    for (const [key, bead] of design.slots) {
      const slot = parseSlotKey(key);
      const c = at(slotCenter(slot, net));
      const deg = (slotAngle(slot) * 180) / Math.PI;
      const rgb = beads.get(bead)?.display.rgb ?? "#999999";
      parts.push(
        `<rect x="${fmt(-bw / 2)}" y="${fmt(-bd / 2)}" width="${fmt(bw)}" height="${fmt(bd)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${rgb}" stroke="${darken(rgb)}" stroke-width="0.2" transform="translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(deg)})"/>`,
      );
    }
    y += pieceH * k + 12;
  } else {
    parts.push(text(MARGIN, y, "No beads yet.", 3.5, MUTED));
    y += 10;
  }

  const list = beadList(design, beads);
  parts.push(text(MARGIN, y, "Beads to buy", 4.5, INK, "650"));
  y += 7;
  for (const row of list.rows) {
    if (row.count === 0) continue;
    parts.push(`<rect x="${MARGIN}" y="${fmt(y - 3.6)}" width="4.4" height="4.4" rx="2.2" fill="${row.rgb}" stroke="${darken(row.rgb)}" stroke-width="0.2"/>`);
    parts.push(text(MARGIN + 6, y, `${row.key}  ${row.label}`, 3.2, INK));
    parts.push(text(width - MARGIN, y, `${row.count.toLocaleString("en-US")}${row.grams !== undefined ? ` · ${row.grams} g` : ""}`, 3.2, INK, "400", "end"));
    y += 6;
  }
  parts.push(text(width - MARGIN, y, `Total ${list.total.count.toLocaleString("en-US")}${list.total.grams !== undefined ? ` · ${list.total.grams} g` : ""} (amounts include ${SPARE * 100} % spare)`, 3, MUTED, "400", "end"));
  y += 6;

  const height = y + MARGIN;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="0 0 ${fmt(width)} ${fmt(height)}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n${parts.join("\n")}\n</svg>\n`;
}

function text(x: number, y: number, content: string, size: number, color: string, weight = "400", anchor: "start" | "middle" | "end" = "start"): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${size}" font-weight="${weight}" ${FONT} fill="${color}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}
