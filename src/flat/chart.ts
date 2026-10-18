// What the flat designer prints and lists: the bead list with the amounts to
// buy, the row-by-row word chart, and the printable chart. See
// docs/flat-peyote-spec.md §9.

import type { ResolvedBead, Shape } from "../catalog/catalog.js";
import { beadCorner, darken, escapeXml, fmt } from "../diagram/svg.js";
import { type BeadBox, type Bounds, boundsCells, boundsSize, cellKey, countBeads, emptyCells, type FlatDesign, mod, paintedBounds } from "./grid.js";

/** Extra beads to buy on top of the count, for breakage and culling. */
export const SPARE = 0.1;

export interface BeadListRow {
  key: string;
  label: string;
  rgb: string;
  count: number;
  /** Grams to buy, when the catalog knows the beads per gram. */
  grams?: number;
}

/**
 * Grams to buy for `count` beads: the count plus 10 % spare, rounded up to
 * the next half gram. undefined when the beads per gram aren't known.
 */
export function gramsToBuy(count: number, beadsPerGram: number | undefined): number | undefined {
  if (!beadsPerGram) return undefined;
  if (count === 0) return 0;
  return Math.ceil(((count * (1 + SPARE)) / beadsPerGram) * 2) / 2;
}

/** Every bead of the design in key order, with its count and grams, and the totals. */
export function beadList(
  design: FlatDesign,
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

// ---- Word chart ----

/** Even or odd count peyote, from the number of columns. Odd count needs a different turn at one edge. */
export function pieceCount(columns: number): "even" | "odd" {
  return columns % 2 === 0 ? "even" : "odd";
}

export interface WordRow {
  /** "Rows 1–2" for the first string, then "Row 3", "Row 4", … */
  label: string;
  direction: "→" | "←";
  /** Beads in pickup order, with runs of the same bead joined. */
  runs: { count: number; key: string }[];
  /** For odd count: this row starts in the edge column the thread comes out of, and needs the odd-count turn there. */
  oddTurn?: "left" | "right";
}

export interface WordChart {
  columns: number;
  rows: number;
  count: "even" | "odd";
  lines: WordRow[];
}

/**
 * The design written out row by row, the way flat peyote patterns are
 * usually written (§9.3). Rows count from the top. Rows 1 and 2 are picked up
 * together as one string, left to right; each later row goes back the other
 * way. Needs a trimmed canvas with a bead in every cell.
 */
export function wordChart(design: FlatDesign): WordChart | { problem: string } {
  const b = design.bounds;
  if (!b) return { problem: "Trim the canvas first: the word chart needs the edges of the piece." };
  const empty = emptyCells(design).length;
  if (empty) return { problem: `Fill the ${empty} empty spot${empty === 1 ? "" : "s"} first: every spot needs a bead.` };
  const { columns, rows } = boundsSize(b);
  const count = pieceCount(columns);
  const at = (c: number, h: number) => design.cells.get(cellKey(c, h))!;
  const lines: WordRow[] = [];

  // Rows 1 and 2: each column's bead from whichever of the two rows it has.
  const first: string[] = [];
  for (let c = b.c0; c <= b.c1; c++) {
    const h = mod(c + b.h0, 2) === 0 ? b.h0 : b.h0 + 1;
    if (h <= b.h1) first.push(at(c, h));
  }
  lines.push({ label: rows === 1 ? "Row 1" : "Rows 1–2", direction: "→", runs: runsOf(first) });

  for (let n = 3; n <= rows; n++) {
    const h = b.h0 + n - 1;
    const direction = n % 2 === 1 ? "←" : "→";
    const keys: string[] = [];
    for (let c = b.c0 + mod(b.c0 + h, 2); c <= b.c1; c += 2) keys.push(at(c, h));
    if (direction === "←") keys.reverse();
    const row: WordRow = { label: `Row ${n}`, direction, runs: runsOf(keys) };
    // In odd count, every other row has a bead in both edge columns, and starts
    // in the column the thread comes out of.
    if (count === "odd" && mod(b.c0 + h, 2) === 0) row.oddTurn = direction === "←" ? "right" : "left";
    lines.push(row);
  }
  return { columns, rows, count, lines };
}

function runsOf(keys: string[]): { count: number; key: string }[] {
  const runs: { count: number; key: string }[] = [];
  for (const key of keys) {
    const last = runs.at(-1);
    if (last?.key === key) last.count++;
    else runs.push({ count: 1, key });
  }
  return runs;
}

export function formatRow(row: WordRow): string {
  const note = row.label === "Rows 1–2" || row.label === "Row 1" ? ", string these first" : "";
  return `${row.label} (${row.direction}${note}): ${row.runs.map((r) => `${r.count}${r.key}`).join(", ")}`;
}

/** The odd-count note: which rows need the odd-count turn, and at which edge. */
export function oddTurnNote(chart: WordChart): string | undefined {
  const turns = chart.lines.filter((l) => l.oddTurn);
  if (!turns.length) return undefined;
  const numbers = turns.map((l) => l.label.replace("Row ", ""));
  const shown = numbers.length > 3 ? `${numbers.slice(0, 3).join(", ")}, …` : numbers.join(", ");
  return `Odd count: rows ${shown} start at the ${turns[0]!.oddTurn} edge in the column the thread comes out of, so they need the odd-count turn there.`;
}

/** The word chart as plain text, with a header naming the piece and its beads. */
export function wordChartText(design: FlatDesign, chart: WordChart, beads: ReadonlyMap<string, ResolvedBead>, sizeLabel: string): string {
  const used = new Set(chart.lines.flatMap((l) => l.runs.map((r) => r.key)));
  const out = [
    design.title,
    `${sizeLabel} · ${chart.columns} columns (${chart.count} count) · ${chart.rows} rows`,
    "",
    ...[...design.beads.keys()].filter((k) => used.has(k)).map((k) => `${k}: ${beads.get(k)?.label ?? k}`),
    "",
  ];
  const note = oddTurnNote(chart);
  if (note) out.push(note, "");
  out.push(...chart.lines.map(formatRow));
  return out.join("\n") + "\n";
}

// ---- Printable chart ----

const INK = "#222222";
const MUTED = "#666666";
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;
/** Beads are drawn this tall on paper, in mm. */
const BEAD_MM = 5;
const MARGIN = 12;

export interface ChartInput {
  design: FlatDesign;
  beads: ReadonlyMap<string, ResolvedBead>;
  box: BeadBox;
  shape: Shape;
  sizeLabel: string;
  /** Draw the beads a quarter turn clockwise, as in the turned view. */
  turned?: boolean;
}

/**
 * A printable SVG (in mm): the title, the beads to scale with column and row
 * numbers, the bead list with amounts, and the word chart when there is one.
 */
export function renderFlatChartSvg({ design, beads, box, shape, sizeLabel, turned = false }: ChartInput): string {
  const area: Bounds | undefined = design.bounds ?? paintedBounds(design);
  const k = BEAD_MM / box.d;
  const bw = box.w * k;
  const bd = BEAD_MM;
  const gutter = 10;
  const top = 36;
  const parts: string[] = [];

  const size = area ? boundsSize(area) : { columns: 0, rows: 0 };
  const gridW = size.columns * bw;
  const gridH = area ? ((size.rows + 1) * bd) / 2 : 0;
  // On paper, the grid's size across and down.
  const across = turned ? gridH : gridW;
  const down = turned ? gridW : gridH;
  const width = Math.max(180, MARGIN * 2 + gutter + across);
  const textWidth = width - 2 * MARGIN;

  parts.push(text(MARGIN, 18, design.title || "Untitled design", 7, INK, "650"));
  const facts = [sizeLabel];
  if (area) {
    facts.push(`${size.columns} × ${size.rows} beads`);
    if (design.bounds) facts.push(`${pieceCount(size.columns)} count`);
    facts.push(`${(gridW / k / 10).toFixed(1)} × ${(gridH / k / 10).toFixed(1)} cm`);
  }
  parts.push(text(MARGIN, 25, facts.join(" · "), 3.5, MUTED));

  let y = top;
  if (area) {
    const x0 = MARGIN + gutter;
    const [rx, ry] = beadCorner(shape, bw * 0.92, bd * 0.92);
    const cells = design.bounds ? [...boundsCells(area)] : [...design.cells.keys()].map((key) => {
      const [c, h] = key.split(",").map(Number) as [number, number];
      return { c, h };
    });
    // Beads in the grid's own frame, turned on paper by the group's transform.
    const grid: string[] = [];
    for (const { c, h } of cells) {
      const x = (c - area.c0) * bw + bw * 0.04;
      const cy = ((h - area.h0) * bd) / 2 + bd * 0.04;
      const key = design.cells.get(cellKey(c, h));
      const w = bw * 0.92;
      const hh = bd * 0.92;
      if (!key) {
        grid.push(`<rect x="${fmt(x)}" y="${fmt(cy)}" width="${fmt(w)}" height="${fmt(hh)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="none" stroke="#d62728" stroke-width="0.25" stroke-dasharray="0.8 0.6"/>`);
        continue;
      }
      const rgb = beads.get(key)?.display.rgb ?? "#999999";
      grid.push(`<rect x="${fmt(x)}" y="${fmt(cy)}" width="${fmt(w)}" height="${fmt(hh)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${rgb}" stroke="${darken(rgb)}" stroke-width="0.2"/>`);
    }
    const transform = turned ? `translate(${fmt(x0 + gridH)} ${fmt(y)}) rotate(90)` : `translate(${fmt(x0)} ${fmt(y)})`;
    parts.push(`<g transform="${transform}">`, ...grid, "</g>");

    // Every 5th column and row number (and the first): columns above and rows
    // on the left, or the other way round when turned.
    const above = (at: number, n: number) => parts.push(text(x0 + at, y - 2, String(n), 2.6, MUTED, "400", "middle"));
    const left = (at: number, n: number) => parts.push(text(x0 - 2, y + at + 0.9, String(n), 2.6, MUTED, "400", "end"));
    for (let i = 0; i < size.columns; i++) {
      const n = i + 1;
      if (n !== 1 && n % 5 !== 0) continue;
      (turned ? left : above)(i * bw + bw / 2, n);
    }
    for (let i = 0; i < size.rows; i++) {
      const n = i + 1;
      if (n !== 1 && n % 5 !== 0) continue;
      const at = (i * bd) / 2 + bd / 2;
      if (turned) above(gridH - at, n);
      else left(at, n);
    }
    y += down + 12;
  } else {
    parts.push(text(MARGIN, y, "No beads yet.", 3.5, MUTED));
    y += 10;
  }

  // Bead list.
  const list = beadList(design, beads);
  parts.push(text(MARGIN, y, "Beads", 4.5, INK, "650"));
  y += 7;
  for (const row of list.rows) {
    if (row.count === 0) continue;
    parts.push(`<rect x="${MARGIN}" y="${fmt(y - 3.6)}" width="3.2" height="4.4" rx="0.8" fill="${row.rgb}" stroke="${darken(row.rgb)}" stroke-width="0.2"/>`);
    parts.push(text(MARGIN + 5, y, `${row.key}  ${row.label}`, 3.2, INK));
    parts.push(text(width - MARGIN, y, `${row.count.toLocaleString("en-US")}${row.grams !== undefined ? ` · ${row.grams} g` : ""}`, 3.2, INK, "400", "end"));
    y += 6;
  }
  parts.push(text(width - MARGIN, y, `Total ${list.total.count.toLocaleString("en-US")}${list.total.grams !== undefined ? ` · ${list.total.grams} g` : ""} (amounts include ${SPARE * 100} % spare)`, 3, MUTED, "400", "end"));
  y += 10;

  // Word chart.
  const chart = wordChart(design);
  parts.push(text(MARGIN, y, "Row by row", 4.5, INK, "650"));
  y += 7;
  const lines = "problem" in chart ? [chart.problem] : [oddTurnNote(chart), ...chart.lines.map(formatRow)].filter((l): l is string => !!l);
  for (const line of lines) {
    for (const piece of wrap(line, Math.floor(textWidth / 1.65))) {
      parts.push(text(MARGIN, y, piece, 3, INK));
      y += 4.6;
    }
  }
  const height = y + MARGIN;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="0 0 ${fmt(width)} ${fmt(height)}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n${parts.join("\n")}\n</svg>\n`;
}

function text(x: number, y: number, content: string, size: number, color: string, weight = "400", anchor: "start" | "middle" | "end" = "start"): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${size}" font-weight="${weight}" ${FONT} fill="${color}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

/** Splits a line at spaces so no piece is longer than `max` characters. */
function wrap(line: string, max: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && current.length + 1 + word.length > max) {
      out.push(current);
      current = `    ${word}`;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}
