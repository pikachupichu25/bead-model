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

/** Turning and stretching applied to the picture before cropping (§6.2). */
export interface Transform {
  /** Degrees clockwise. */
  rotate: number;
  /** Stretch across and down, 1 = as is. Applied after turning, along the turned picture's sides. */
  stretchX: number;
  stretchY: number;
}

export const NO_TRANSFORM: Transform = { rotate: 0, stretchX: 1, stretchY: 1 };

/** The size of a width × height picture once turned (the corners it leaves are transparent) and stretched. */
export function transformedSize(width: number, height: number, { rotate, stretchX, stretchY }: Transform): { width: number; height: number } {
  const a = (rotate * Math.PI) / 180;
  // Round off float noise so quarter turns swap the sides exactly.
  const cos = Math.abs(Math.round(Math.cos(a) * 1e9) / 1e9);
  const sin = Math.abs(Math.round(Math.sin(a) * 1e9) / 1e9);
  return { width: (width * cos + height * sin) * stretchX, height: (width * sin + height * cos) * stretchY };
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

export interface MatchOptions {
  /** Colors used by fewer beads than this are merged into their closest neighbor (§6.6). 0 = off. */
  minBeads?: number;
  /** Mix two bead colors to suggest a color in between (error diffusion, §6.6). */
  dither?: boolean;
}

/**
 * Matches every cell to the closest palette color (CIEDE2000), using at most
 * `maxColors` colors (§6.6). Colors are dropped one at a time, each time the
 * one whose loss adds the least squared error, so a small but distinct detail
 * survives where keeping the most used colors would lose it.
 */
export function matchColors(sampled: Sampled, palette: readonly Lab[], maxColors: number, options: MatchOptions = {}): Match {
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

  let choice = uniques.map((_, u) => nearestIn(u, kept)[0]);

  // Merge rare colors: drop the least used color while it has too few beads.
  const minBeads = options.minBeads ?? 0;
  while (minBeads > 0 && kept.length > 1) {
    const used = new Map(kept.map((p) => [p, 0]));
    choice.forEach((p, u) => used.set(p, used.get(p)! + counts[u]!));
    let rarest = kept[0]!;
    for (const p of kept) if (used.get(p)! < used.get(rarest)!) rarest = p;
    if (used.get(rarest)! >= minBeads) break;
    kept = kept.filter((p) => p !== rarest);
    choice = uniques.map((_, u) => nearestIn(u, kept)[0]);
  }

  if (options.dither) {
    // Dithering mixes colors, so it may use any allowed color while they all fit the limit.
    return ditherAssign(sampled, palette, P <= limit && minBeads === 0 ? all : kept);
  }

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

/** Share of the color error passed on, and the most a cell can carry (Lab units). Less than all, so a slight tint in the palette can't build up into stray beads of a far-off color. */
const DIFFUSION = 0.75;
const MAX_ERROR = 12;

/**
 * Error diffusion on the offset grid: each cell takes its closest color from
 * `kept`, and the difference (in Lab) is passed on to the cells below it: 3/8
 * to the lower left, 3/8 to the lower right and 2/8 to the cell below.
 */
function ditherAssign(sampled: Sampled, palette: readonly Lab[], kept: readonly number[]): Match {
  const { cells, labs } = sampled;
  const n = cells.length;
  const assign = new Int32Array(n).fill(-1);
  const index = new Map(cells.map(({ c, h }, i) => [`${c},${h}`, i]));
  const order = [...cells.keys()].sort((a, b) => cells[a]!.h - cells[b]!.h || cells[a]!.c - cells[b]!.c);
  const error = new Float32Array(n * 3);
  const usedCounts = new Map<number, number>();
  let total = 0;
  let beads = 0;
  for (const i of order) {
    if (Number.isNaN(labs[i * 3]!)) continue;
    const original: Lab = [labs[i * 3]!, labs[i * 3 + 1]!, labs[i * 3 + 2]!];
    const carried = (k: number) => Math.max(-MAX_ERROR, Math.min(MAX_ERROR, error[i * 3 + k]!));
    const wanted: Lab = [original[0] + carried(0), original[1] + carried(1), original[2] + carried(2)];
    let best = kept[0]!;
    let bestD = Infinity;
    for (const p of kept) {
      const d = deltaE2000(wanted, palette[p]!);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    assign[i] = best;
    usedCounts.set(best, (usedCounts.get(best) ?? 0) + 1);
    total += deltaE2000(original, palette[best]!);
    beads++;
    const { c, h } = cells[i]!;
    const chosen = palette[best]!;
    for (const [dc, dh, weight] of [[-1, 1, 3 / 8], [1, 1, 3 / 8], [0, 2, 2 / 8]] as const) {
      const j = index.get(`${c + dc},${h + dh}`);
      if (j === undefined || Number.isNaN(labs[j * 3]!)) continue;
      for (let k = 0; k < 3; k++) error[j * 3 + k]! += (wanted[k]! - chosen[k]!) * weight * DIFFUSION;
    }
  }
  const used = [...usedCounts].map(([i, count]) => ({ index: i, count })).sort((a, b) => b.count - a.count || a.index - b.index);
  return { assign, used, meanDeltaE: beads ? total / beads : 0 };
}

export interface Adjustments {
  /** −100 to 100, 0 = unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
}

export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0 };

/** Brightness, contrast and saturation applied to a copy of the pixels (§6.2). Alpha is kept. */
export function adjustPixels(pixels: Pixels, { brightness, contrast, saturation }: Adjustments): Pixels {
  const data = new Uint8ClampedArray(pixels.data);
  if (brightness === 0 && contrast === 0 && saturation === 0) return { ...pixels, data };
  const C = contrast * 2.55;
  const factor = (259 * (C + 255)) / (255 * (259 - C));
  const shift = brightness * 1.28;
  const sat = 1 + saturation / 100;
  for (let p = 0; p < data.length; p += 4) {
    let r = (data[p]! - 128) * factor + 128 + shift;
    let g = (data[p + 1]! - 128) * factor + 128 + shift;
    let b = (data[p + 2]! - 128) * factor + 128 + shift;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
  }
  return { ...pixels, data };
}
