// Pan and zoom for the flat designer's canvas, and which cells are on screen.
// See docs/flat-peyote-spec.md §4. Screen = mm × zoom + pan, in CSS pixels.

import { type BeadBox, type Bounds, type Cell, cellAt, cellCenter, cellKey } from "./grid.js";

export interface View {
  panX: number;
  panY: number;
  /** CSS pixels per mm. */
  zoom: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A bead is kept between these heights on screen, in CSS pixels. */
export const MIN_BEAD_PX = 2;
export const MAX_BEAD_PX = 120;
export const DEFAULT_BEAD_PX = 20;

export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: x * view.zoom + view.panX, y: y * view.zoom + view.panY };
}

export function toMm(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
}

export function clampZoom(zoom: number, box: BeadBox): number {
  return Math.min(MAX_BEAD_PX / box.d, Math.max(MIN_BEAD_PX / box.d, zoom));
}

/** Zooms by `factor`, keeping the point under (sx, sy) where it is. */
export function zoomAt(view: View, factor: number, sx: number, sy: number, box: BeadBox): View {
  const zoom = clampZoom(view.zoom * factor, box);
  const at = toMm(view, sx, sy);
  return { zoom, panX: sx - at.x * zoom, panY: sy - at.y * zoom };
}

/** Cell (0, 0) in the middle of the screen, beads DEFAULT_BEAD_PX tall. */
export function defaultView(width: number, height: number, box: BeadBox): View {
  return { zoom: DEFAULT_BEAD_PX / box.d, panX: width / 2, panY: height / 2 };
}

/** The view that fits a rectangle (mm) on screen with a margin (px). */
export function fitView(rect: Rect, width: number, height: number, box: BeadBox, margin = 40): View {
  const w = Math.max(rect.x1 - rect.x0, box.w);
  const h = Math.max(rect.y1 - rect.y0, box.d);
  const zoom = clampZoom(Math.min((width - 2 * margin) / w, (height - 2 * margin) / h), box);
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  return { zoom, panX: width / 2 - cx * zoom, panY: height / 2 - cy * zoom };
}

/** The rectangle (mm) one bead covers. */
export function cellRect(cell: Cell, box: BeadBox): Rect {
  const { x, y } = cellCenter(cell, box);
  return { x0: x - box.w / 2, y0: y - box.d / 2, x1: x + box.w / 2, y1: y + box.d / 2 };
}

/** The rectangle (mm) the beads inside some bounds cover. */
export function boundsRect(b: Bounds, box: BeadBox): Rect {
  return {
    x0: b.c0 * box.w - box.w / 2,
    x1: b.c1 * box.w + box.w / 2,
    y0: (b.h0 * box.d) / 2 - box.d / 2,
    y1: (b.h1 * box.d) / 2 + box.d / 2,
  };
}

/** Columns and stitched rows with any part on screen. */
export function visibleRange(view: View, width: number, height: number, box: BeadBox): Bounds {
  const a = toMm(view, 0, 0);
  const b = toMm(view, width, height);
  return {
    c0: Math.floor(a.x / box.w - 0.5),
    c1: Math.ceil(b.x / box.w + 0.5),
    h0: Math.floor((2 * a.y) / box.d - 1),
    h1: Math.ceil((2 * b.y) / box.d + 1),
  };
}

/**
 * The cells a pointer passed over going from a to b (mm), in order, without
 * repeats. A fast drag moves many cells between two pointer events; this fills
 * the gap so no cells are skipped.
 */
export function cellsAlong(a: { x: number; y: number }, b: { x: number; y: number }, box: BeadBox): Cell[] {
  const step = Math.min(box.w, box.d) / 3;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (let i = 0; i <= n; i++) {
    const cell = cellAt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, box);
    const key = cellKey(cell.c, cell.h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

/** A tick spacing for the rulers, so labels are at least `minPx` apart. */
export function rulerStep(cellPx: number, minPx = 28): number {
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (step * cellPx >= minPx) return step;
  return 1000;
}
