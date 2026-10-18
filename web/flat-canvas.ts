// Draws the flat designer's canvas with the 2D canvas API. SVG elements, as
// the circular editor uses, are too slow for the up to 100 000 beads a flat
// piece can have. See docs/flat-peyote-spec.md §4.

import type { Shape } from "../src/catalog/catalog.js";
import { type BeadBox, type Bounds, type Cell, cellKey, inBounds, mod, parseCellKey } from "../src/flat/grid.js";
import { boundsRect, rulerStep, toScreen, type View, visibleRange } from "../src/flat/view.js";

export interface CanvasScene {
  view: View;
  /** CSS pixels. */
  width: number;
  height: number;
  box: BeadBox;
  shape: Shape;
  cells: ReadonlyMap<string, string>;
  /** Bead key → display color. */
  colors: ReadonlyMap<string, string>;
  bounds?: Bounds;
  /** The area trim would give, outlined on an unlimited canvas. */
  painted?: Bounds;
  /** Rulers count from this column and row (1 = c0, h0). */
  origin: { c: number; h: number };
  hover?: Cell;
}

const BG = "#fdfcf9";
const OUTSIDE = "#e9e5dc";
const ACCENT = "#3c5a99";
const RULER_TOP = 18;
const RULER_LEFT = 30;

/** Corner radius as a share of the bead's smaller side. */
const RADIUS: Record<Shape, number> = { cylinder: 0.2, round: 0.48, demi: 0.48, hex: 0.14, triangle: 0.14, cube: 0.08, bugle: 0.3 };

export function drawScene(ctx: CanvasRenderingContext2D, scene: CanvasScene, dpr: number): void {
  const { view, width, height, box, cells, bounds } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bounds ? OUTSIDE : BG;
  ctx.fillRect(0, 0, width, height);

  const beadPx = view.zoom * box.d;
  const range = visibleRange(view, width, height, box);
  const area = bounds ? clip(range, bounds) : range;

  ctx.save();
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.zoom, view.zoom);
  const px = 1 / view.zoom;

  if (bounds) {
    const r = boundsRect(bounds, box);
    ctx.fillStyle = BG;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }

  // Every 10th column, counted from the origin.
  if (beadPx >= 6 && area) {
    ctx.beginPath();
    for (let c = area.c0; c <= area.c1 + 1; c++) {
      if (mod(c - scene.origin.c, 10) !== 0) continue;
      const x = (c - 0.5) * box.w;
      ctx.moveTo(x, (area.h0 - 1) * (box.d / 2));
      ctx.lineTo(x, (area.h1 + 1) * (box.d / 2));
    }
    ctx.strokeStyle = "rgb(60 90 153 / 0.18)";
    ctx.lineWidth = px;
    ctx.stroke();
  }

  const inset = Math.min(box.w, box.d) * 0.06;
  const bw = box.w - 2 * inset;
  const bd = box.d - 2 * inset;
  const radius = Math.min(bw, bd) * RADIUS[scene.shape];
  const detailed = beadPx >= 6;

  // Beads, one path per color. Walk the visible cells, or the painted cells
  // when there are fewer of them.
  const byColor = new Map<string, Path2D>();
  const empty = new Path2D();
  const outline = new Path2D();
  const shine = new Path2D();
  const addBead = (c: number, h: number, key: string | undefined) => {
    const x = c * box.w - bw / 2;
    const y = (h * box.d) / 2 - bd / 2;
    if (key === undefined) {
      if (detailed) empty.roundRect(x, y, bw, bd, radius);
      return;
    }
    let path = byColor.get(key);
    if (!path) byColor.set(key, (path = new Path2D()));
    if (detailed) {
      path.roundRect(x, y, bw, bd, radius);
      outline.roundRect(x, y, bw, bd, radius);
      if (beadPx >= 12) shine.roundRect(x + bw * 0.18, y + bd * 0.12, bw * 0.22, bd * 0.5, Math.min(bw, bd) * 0.1);
    } else {
      path.rect(x - inset, y - inset, box.w, box.d);
    }
  };
  if (area) {
    const visibleCount = ((area.c1 - area.c0 + 1) * (area.h1 - area.h0 + 1)) / 2;
    if (!detailed && cells.size < visibleCount) {
      for (const [k, key] of cells) {
        const cell = parseCellKey(k);
        if (inBounds(area, cell)) addBead(cell.c, cell.h, key);
      }
    } else {
      for (let h = area.h0; h <= area.h1; h++) {
        for (let c = area.c0 + mod(area.c0 + h, 2); c <= area.c1; c += 2) addBead(c, h, cells.get(cellKey(c, h)));
      }
    }
  }
  if (detailed) {
    ctx.strokeStyle = "rgb(0 0 0 / 0.09)";
    ctx.lineWidth = px;
    ctx.stroke(empty);
  }
  for (const [key, path] of byColor) {
    ctx.fillStyle = scene.colors.get(key) ?? "#999";
    ctx.fill(path);
  }
  if (detailed) {
    ctx.fillStyle = "rgb(255 255 255 / 0.22)";
    ctx.fill(shine);
    ctx.strokeStyle = "rgb(0 0 0 / 0.38)";
    ctx.lineWidth = px;
    ctx.stroke(outline);
  }

  // The painted area on an unlimited canvas, or the edges of a trimmed one.
  const edge = bounds ?? scene.painted;
  if (edge) {
    const r = boundsRect(edge, box);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash(bounds ? [] : [6 * px, 4 * px]);
    ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.setLineDash([]);
  }

  if (scene.hover) {
    const { c, h } = scene.hover;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.roundRect(c * box.w - bw / 2, (h * box.d) / 2 - bd / 2, bw, bd, radius);
    ctx.stroke();
  }
  ctx.restore();

  drawRulers(ctx, scene, range);
}

/** Column numbers along the top, stitched row numbers down the left, counted from the origin. */
function drawRulers(ctx: CanvasRenderingContext2D, scene: CanvasScene, range: Bounds): void {
  const { view, width, height, box, origin } = scene;
  ctx.fillStyle = "rgb(253 252 249 / 0.92)";
  ctx.fillRect(0, 0, width, RULER_TOP);
  ctx.fillRect(0, 0, RULER_LEFT, height);
  ctx.strokeStyle = "rgb(0 0 0 / 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_TOP + 0.5);
  ctx.lineTo(width, RULER_TOP + 0.5);
  ctx.moveTo(RULER_LEFT + 0.5, 0);
  ctx.lineTo(RULER_LEFT + 0.5, height);
  ctx.stroke();

  ctx.font = "10.5px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#6b665e";
  ctx.textBaseline = "middle";

  const colStep = rulerStep(view.zoom * box.w);
  ctx.textAlign = "center";
  for (let c = range.c0; c <= range.c1; c++) {
    const n = c - origin.c + 1;
    if (mod(n, colStep) !== 0) continue;
    const x = toScreen(view, c * box.w, 0).x;
    if (x < RULER_LEFT + 8) continue;
    ctx.fillText(String(n), x, RULER_TOP / 2);
  }

  const rowStep = rulerStep((view.zoom * box.d) / 2, 16);
  ctx.textAlign = "right";
  for (let h = range.h0; h <= range.h1; h++) {
    const n = h - origin.h + 1;
    if (mod(n, rowStep) !== 0) continue;
    const y = toScreen(view, 0, (h * box.d) / 2).y;
    if (y < RULER_TOP + 6) continue;
    ctx.fillText(String(n), RULER_LEFT - 5, y);
  }
}

function clip(a: Bounds, b: Bounds): Bounds | undefined {
  const r = { c0: Math.max(a.c0, b.c0), c1: Math.min(a.c1, b.c1), h0: Math.max(a.h0, b.h0), h1: Math.min(a.h1, b.h1) };
  return r.c0 > r.c1 || r.h0 > r.h1 ? undefined : r;
}
