// Turns a picture into a bead grid: the size in beads, averaging each bead's
// part of the picture, and matching it to the closest of a limited set of bead
// colors. Plain TypeScript with no DOM, so it runs in a worker and in tests.
// See docs/flat-peyote-spec.md §6.

import { type Lab, LINEAR, deltaE2000, linearToLab } from "./color.js";
import type { BeadBox, Cell } from "./grid.js";

/** Picture pixels as in ImageData: RGBA, 0–255, row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Stitched rows for a picture `columns` beads wide, so the stitched piece
 * has the picture's proportions (§6.3). A piece is columns · w wide and
 * (rows + 1) · d / 2 tall.
 */
export function importRows(pictureWidth: number, pictureHeight: number, columns: number, box: BeadBox): number {
  return Math.max(1, Math.round((2 * columns * box.w * (pictureHeight / pictureWidth)) / box.d) - 1);
}

/** The cells of a columns × rows piece, row by row from the top. Column 0 sits high. */
export function importCells(columns: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  for (let h = 0; h < rows; h++) for (let c = h % 2; c < columns; c += 2) cells.push({ c, h });
  return cells;
}

export interface Sampled {
  columns: number;
  rows: number;
  cells: Cell[];
  /** L, a, b for each cell, in the order of `cells`. NaN for an empty (transparent) cell. */
  labs: Float32Array;
}

/**
 * The average color of each bead's part of the picture (§6.4), averaged in
 * linear light and weighted by alpha. A cell whose mean alpha is below
 * `alphaThreshold` (0–1) is empty. The picture is stretched to the piece, so
 * a height set apart from the width stretches it.
 */
export function sampleCells(pixels: Pixels, columns: number, rows: number, box: BeadBox, alphaThreshold = 0.5): Sampled {
  const cells = importCells(columns, rows);
  const labs = new Float32Array(cells.length * 3);
  const { width, height, data } = pixels;
  const sx = width / (columns * box.w);
  const sy = height / (((rows + 1) * box.d) / 2);
  const span = (from: number, to: number, size: number): [number, number] => {
    const a = Math.min(size - 1, Math.max(0, Math.round(from)));
    return [a, Math.min(size, Math.max(a + 1, Math.round(to)))];
  };

  cells.forEach(({ c, h }, i) => {
    const [x0, x1] = span(c * box.w * sx, (c + 1) * box.w * sx, width);
    const [y0, y1] = span(((h * box.d) / 2) * sy, ((h * box.d) / 2 + box.d) * sy, height);
    let r = 0;
    let g = 0;
    let b = 0;
    let alpha = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * width + x) * 4;
        const a = data[p + 3]! / 255;
        r += LINEAR[data[p]!]! * a;
        g += LINEAR[data[p + 1]!]! * a;
        b += LINEAR[data[p + 2]!]! * a;
        alpha += a;
      }
    }
    const n = (x1 - x0) * (y1 - y0);
    if (alpha / n < alphaThreshold || alpha === 0) {
      labs.fill(NaN, i * 3, i * 3 + 3);
      return;
    }
    labs.set(linearToLab(r / alpha, g / alpha, b / alpha), i * 3);
  });
  return { columns, rows, cells, labs };
}

export interface Match {
  /** Palette index for each cell, in the order of `Sampled.cells`. -1 for an empty cell. */
  assign: Int32Array;
  /** The palette colors used, most beads first. */
  used: { index: number; count: number }[];
  /** Mean CIEDE2000 between each bead and its part of the picture. */
  meanDeltaE: number;
}

/**
 * Matches every cell to the closest palette color (CIEDE2000), using at most
 * `maxColors` colors (§6.6). Colors are dropped one at a time, each time the
 * one whose loss adds the least squared error, so a small but distinct detail
 * survives where keeping the most used colors would lose it.
 */
export function matchColors(sampled: Sampled, palette: readonly Lab[], maxColors: number): Match {
  const n = sampled.cells.length;
  const assign = new Int32Array(n).fill(-1);
  if (palette.length === 0) return { assign, used: [], meanDeltaE: 0 };

  // Work on distinct colors (rounded to whole Lab units) with their counts.
  const uniqueOf = new Int32Array(n).fill(-1);
  const keys = new Map<string, number>();
  const uniques: Lab[] = [];
  const counts: number[] = [];
  for (let i = 0; i < n; i++) {
    const L = sampled.labs[i * 3]!;
    if (Number.isNaN(L)) continue;
    const lab: Lab = [Math.round(L), Math.round(sampled.labs[i * 3 + 1]!), Math.round(sampled.labs[i * 3 + 2]!)];
    const key = lab.join(",");
    let u = keys.get(key);
    if (u === undefined) {
      u = uniques.length;
      keys.set(key, u);
      uniques.push(lab);
      counts.push(0);
    }
    counts[u]!++;
    uniqueOf[i] = u;
  }

  const P = palette.length;
  const U = uniques.length;
  const dist = new Float32Array(U * P);
  for (let u = 0; u < U; u++) for (let p = 0; p < P; p++) dist[u * P + p] = deltaE2000(uniques[u]!, palette[p]!);

  // Start with every color that is nearest to some cell.
  const nearestIn = (u: number, set: number[]): [number, number] => {
    let best = -1;
    let second = -1;
    for (const p of set) {
      const d = dist[u * P + p]!;
      if (best < 0 || d < dist[u * P + best]!) {
        second = best;
        best = p;
      } else if (second < 0 || d < dist[u * P + second]!) {
        second = p;
      }
    }
    return [best, second];
  };
  const all = Array.from({ length: P }, (_, p) => p);
  let kept = [...new Set(uniques.map((_, u) => nearestIn(u, all)[0]))];

  // Each color's cost is the squared error its cells would add if it were
  // dropped. Only cells whose best or second color is dropped need a recount.
  const limit = Math.max(1, Math.floor(maxColors));
  if (kept.length > limit) {
    const best = new Int32Array(U);
    const second = new Int32Array(U);
    const cost = new Float64Array(P);
    const contribution = (u: number) => {
      const d1 = dist[u * P + best[u]!]!;
      const d2 = dist[u * P + second[u]!]!;
      return counts[u]! * (d2 * d2 - d1 * d1);
    };
    for (let u = 0; u < U; u++) {
      [best[u], second[u]] = nearestIn(u, kept);
      cost[best[u]!]! += contribution(u);
    }
    while (kept.length > limit) {
      let drop = kept[0]!;
      for (const p of kept) if (cost[p]! < cost[drop]!) drop = p;
      kept = kept.filter((p) => p !== drop);
      for (let u = 0; u < U; u++) {
        if (best[u] !== drop && second[u] !== drop) continue;
        cost[best[u]!]! -= contribution(u);
        [best[u], second[u]] = nearestIn(u, kept);
        if (kept.length > 1) cost[best[u]!]! += contribution(u);
      }
    }
  }

  const choice = uniques.map((_, u) => nearestIn(u, kept)[0]);
  const usedCounts = new Map<number, number>();
  let total = 0;
  let beads = 0;
  for (let i = 0; i < n; i++) {
    const u = uniqueOf[i]!;
    if (u < 0) continue;
    const p = choice[u]!;
    assign[i] = p;
    usedCounts.set(p, (usedCounts.get(p) ?? 0) + 1);
    total += dist[u * P + p]!;
    beads++;
  }
  const used = [...usedCounts].map(([index, count]) => ({ index, count })).sort((a, b) => b.count - a.count || a.index - b.index);
  return { assign, used, meanDeltaE: beads ? total / beads : 0 };
}
