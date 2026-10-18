// Pan and zoom for the flat designer's canvas, and which cells are on screen.
// See docs/flat-peyote-spec.md §4. Screen = display mm × zoom + pan, in CSS
// pixels. Display mm are the design's mm, turned a quarter turn clockwise
// when the view is turned (§1, R10): display (X, Y) = (−y, x).

import { type BeadBox, type Bounds, type Cell, cellAt, cellCenter, cellKey } from "./grid.js";

export interface View {
  panX: number;
  panY: number;
  /** CSS pixels per mm. */
  zoom: number;
  /** Turned a quarter turn clockwise, so columns run across the screen. */
  turned?: boolean;
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

function toDisplay(view: View, x: number, y: number): { x: number; y: number } {
  return view.turned ? { x: -y, y: x } : { x, y };
}

function fromDisplay(view: View, x: number, y: number): { x: number; y: number } {
  return view.turned ? { x: y, y: -x } : { x, y };
}

export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  const d = toDisplay(view, x, y);
  return { x: d.x * view.zoom + view.panX, y: d.y * view.zoom + view.panY };
}

export function toMm(view: View, sx: number, sy: number): { x: number; y: number } {
  return fromDisplay(view, (sx - view.panX) / view.zoom, (sy - view.panY) / view.zoom);
}

export function clampZoom(zoom: number, box: BeadBox): number {
  return Math.min(MAX_BEAD_PX / box.d, Math.max(MIN_BEAD_PX / box.d, zoom));
}

/** Zooms by `factor`, keeping the point under (sx, sy) where it is. */
export function zoomAt(view: View, factor: number, sx: number, sy: number, box: BeadBox): View {
  const zoom = clampZoom(view.zoom * factor, box);
  const dx = (sx - view.panX) / view.zoom;
  const dy = (sy - view.panY) / view.zoom;
  return { ...view, zoom, panX: sx - dx * zoom, panY: sy - dy * zoom };
}

/** Turns the view a quarter turn (or back), keeping the middle of the screen where it is. */
export function turnView(view: View, width: number, height: number): View {
  const at = toMm(view, width / 2, height / 2);
  const turned: View = { ...view, turned: !view.turned };
  const d = toDisplay(turned, at.x, at.y);
  return { ...turned, panX: width / 2 - d.x * view.zoom, panY: height / 2 - d.y * view.zoom };
}

/** Cell (0, 0) in the middle of the screen, beads DEFAULT_BEAD_PX tall. */
export function defaultView(width: number, height: number, box: BeadBox, turned = false): View {
  return { zoom: DEFAULT_BEAD_PX / box.d, panX: width / 2, panY: height / 2, ...(turned && { turned }) };
}

/** The view that fits a rectangle (mm) on screen with a margin (px). */
export function fitView(rect: Rect, width: number, height: number, box: BeadBox, margin = 40, turned = false): View {
  const across = turned ? rect.y1 - rect.y0 : rect.x1 - rect.x0;
  const down = turned ? rect.x1 - rect.x0 : rect.y1 - rect.y0;
  const zoom = clampZoom(Math.min((width - 2 * margin) / Math.max(across, box.w), (height - 2 * margin) / Math.max(down, box.d)), box);
  const view: View = { zoom, panX: 0, panY: 0, ...(turned && { turned }) };
  const c = toScreen(view, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
  return { ...view, panX: width / 2 - c.x, panY: height / 2 - c.y };
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
  const corners = [toMm(view, 0, 0), toMm(view, width, height), toMm(view, width, 0), toMm(view, 0, height)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    c0: Math.floor(Math.min(...xs) / box.w - 0.5),
    c1: Math.ceil(Math.max(...xs) / box.w + 0.5),
    h0: Math.floor((2 * Math.min(...ys)) / box.d - 1),
    h1: Math.ceil((2 * Math.max(...ys)) / box.d + 1),
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
