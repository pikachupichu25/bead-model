// Draws the Nora designer's canvas with the 2D canvas API, as the flat
// designer does. See docs/nora-net-spec.md §9.

import type { Shape } from "../src/catalog/catalog.js";
import type { Symmetry } from "../src/nora/design.js";
import {
  DIAGONAL_ANGLE,
  type Group,
  groupOutline,
  isSlot,
  mod,
  type NetSize,
  parseSlotKey,
  type Point,
  type Slot,
  slotAngle,
  slotCenter,
  slotKey,
} from "../src/nora/net.js";
import { rulerStep, toMm, toScreen, type View } from "../src/flat/view.js";

export interface NoraScene {
  view: View;
  /** CSS pixels. */
  width: number;
  height: number;
  net: NetSize;
  /** The bead's length along its hole, mm. */
  w: number;
  shape: Shape;
  slots: ReadonlyMap<string, string>;
  /** Bead key → display color. */
  colors: ReadonlyMap<string, string>;
  symmetry: Symmetry;
  /** The bead under the pointer (with its mirror images), and its two rings, drawn faintly. */
  hover?: { slots: readonly Slot[]; faint?: readonly Group[] };
  /** Groups to point out, each set in its own color: open rings, loose parts. */
  groupMarks?: readonly { groups: readonly Group[]; color: string }[];
  /** Slots to point out, such as beads that don't match their mirror. */
  slotMarks?: readonly Slot[];
}

const BG = "#fdfcf9";
const ACCENT = "#3c5a99";
export const RULER_TOP = 18;
export const RULER_LEFT = 30;

/** Corner radius as a share of the bead's smaller side. */
const RADIUS: Record<Shape, number> = { cylinder: 0.2, round: 0.48, demi: 0.48, hex: 0.14, triangle: 0.14, cube: 0.08, bugle: 0.3 };

const ANGLES = [0, Math.PI / 2, -DIAGONAL_ANGLE, DIAGONAL_ANGLE];

export function visibleGroups(view: View, width: number, height: number, net: NetSize): { i0: number; i1: number; j0: number; j1: number } {
  const a = toMm(view, 0, 0);
  const b = toMm(view, width, height);
  return {
    i0: Math.floor(Math.min(a.x, b.x) / net.L) - 1,
    i1: Math.ceil(Math.max(a.x, b.x) / net.L) + 1,
    j0: Math.floor(Math.min(a.y, b.y) / net.H) - 1,
    j1: Math.ceil(Math.max(a.y, b.y) / net.H) + 1,
  };
}

export function drawNora(ctx: CanvasRenderingContext2D, scene: NoraScene, dpr: number): void {
  const { view, width, height, net, slots } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const beadPx = view.zoom * net.d;
  const range = visibleGroups(view, width, height, net);
  const detailed = beadPx >= 6;

  ctx.save();
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.zoom, view.zoom);
  const px = 1 / view.zoom;

  // The bead's shape at each of the four angles, centered on (0, 0).
  const inset = net.d * 0.05;
  const bw = scene.w - 2 * inset;
  const bd = net.d - 2 * inset;
  const radius = Math.min(bw, bd) * RADIUS[scene.shape];
  const shapes = ANGLES.map((angle) => {
    const p = new Path2D();
    p.roundRect(-bw / 2, -bd / 2, bw, bd, radius);
    const turned = new Path2D();
    turned.addPath(p, new DOMMatrix().rotateSelf((angle * 180) / Math.PI));
    return turned;
  });
  const shapeOf = (slot: Slot) => shapes[ANGLES.indexOf(slotAngle(slot))]!;
  const addBead = (path: Path2D, slot: Slot) => {
    const c = slotCenter(slot, net);
    path.addPath(shapeOf(slot), new DOMMatrix([1, 0, 0, 1, c.x, c.y]));
  };

  // Faint group outlines and empty slots, so the 4s and 8s show on an empty canvas.
  if (detailed) {
    const outlines = new Path2D();
    for (let i = range.i0; i <= range.i1; i++) {
      for (let j = range.j0; j <= range.j1; j++) addPolygon(outlines, groupOutline({ i, j }, net));
    }
    ctx.strokeStyle = "rgb(0 0 0 / 0.06)";
    ctx.lineWidth = px;
    ctx.stroke(outlines);
  }

  const byColor = new Map<string, Path2D>();
  const empty = new Path2D();
  const add = (slot: Slot, key: string | undefined) => {
    if (key === undefined) {
      if (detailed) addBead(empty, slot);
      return;
    }
    let path = byColor.get(key);
    if (!path) byColor.set(key, (path = new Path2D()));
    if (detailed) addBead(path, slot);
    else {
      const c = slotCenter(slot, net);
      path.rect(c.x - net.d / 2, c.y - net.d / 2, net.d, net.d);
    }
  };
  const x0 = 2 * range.i0 - 1;
  const x1 = 2 * range.i1 + 1;
  const y0 = 2 * range.j0 - 1;
  const y1 = 2 * range.j1 + 1;
  const visibleCount = ((x1 - x0 + 1) * (y1 - y0 + 1) * 3) / 4;
  if (!detailed && slots.size < visibleCount) {
    for (const [k, key] of slots) {
      const s = parseSlotKey(k);
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) add(s, key);
    }
  } else {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (isSlot(x, y)) add({ x, y }, slots.get(slotKey(x, y)));
    }
  }
  if (detailed) {
    ctx.strokeStyle = "rgb(0 0 0 / 0.13)";
    ctx.lineWidth = px;
    ctx.stroke(empty);
  }
  const outline = new Path2D();
  for (const [key, path] of byColor) {
    ctx.fillStyle = scene.colors.get(key) ?? "#999";
    ctx.fill(path);
    if (detailed) outline.addPath(path);
  }
  if (detailed) {
    ctx.strokeStyle = "rgb(0 0 0 / 0.38)";
    ctx.lineWidth = px;
    ctx.stroke(outline);
  }

  // Symmetry axes, through the middles of a column and a row of groups.
  const { mode, column, row } = scene.symmetry;
  const top = toMm(view, 0, 0);
  const bottom = toMm(view, width, height);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([6 * px, 4 * px]);
  ctx.beginPath();
  if (mode === "left-right" || mode === "both") {
    ctx.moveTo(column * net.L, top.y);
    ctx.lineTo(column * net.L, bottom.y);
  }
  if (mode === "up-down" || mode === "both") {
    ctx.moveTo(top.x, row * net.H);
    ctx.lineTo(bottom.x, row * net.H);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  for (const mark of scene.groupMarks ?? []) {
    const path = new Path2D();
    for (const g of mark.groups) addPolygon(path, groupOutline(g, net));
    ctx.fillStyle = mark.color.replace(")", " / 0.14)");
    ctx.fill(path);
    ctx.strokeStyle = mark.color;
    ctx.lineWidth = Math.max(1.5 * px, net.d * 0.08);
    ctx.stroke(path);
  }

  if (scene.slotMarks?.length) {
    const path = new Path2D();
    for (const s of scene.slotMarks) addBead(path, s);
    ctx.fillStyle = "rgb(214 39 40 / 0.2)";
    ctx.fill(path);
    ctx.strokeStyle = "#d62728";
    ctx.lineWidth = Math.max(1.5 * px, net.d * 0.1);
    ctx.stroke(path);
  }

  if (scene.hover) {
    const faint = new Path2D();
    for (const g of scene.hover.faint ?? []) addPolygon(faint, groupOutline(g, net));
    ctx.strokeStyle = "rgb(60 90 153 / 0.35)";
    ctx.lineWidth = 1.5 * px;
    ctx.stroke(faint);
    const path = new Path2D();
    for (const s of scene.hover.slots) addBead(path, s);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    ctx.stroke(path);
  }
  ctx.restore();

  drawRulers(ctx, scene, range);
}

function addPolygon(path: Path2D, points: Point[]): void {
  path.moveTo(points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) path.lineTo(p.x, p.y);
  path.closePath();
}

/** Group column numbers along the top and row numbers down the left, with the symmetry axes marked. */
function drawRulers(ctx: CanvasRenderingContext2D, scene: NoraScene, range: { i0: number; i1: number; j0: number; j1: number }): void {
  const { view, width, height, net } = scene;
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
  const step = rulerStep(view.zoom * net.L, 24);
  const num = (n: number) => String(n).replace("-", "−");
  ctx.textAlign = "center";
  for (let i = range.i0; i <= range.i1; i++) {
    if (mod(i, step) !== 0) continue;
    const at = toScreen(view, i * net.L, 0);
    if (at.x > RULER_LEFT + 8 && at.x < width) ctx.fillText(num(i), at.x, RULER_TOP / 2);
  }
  ctx.textAlign = "right";
  for (let j = range.j0; j <= range.j1; j++) {
    if (mod(j, step) !== 0) continue;
    const at = toScreen(view, 0, j * net.H);
    if (at.y > RULER_TOP + 6 && at.y < height) ctx.fillText(num(j), RULER_LEFT - 5, at.y);
  }

  // A marker on the ruler for each axis that is on: drag it to move the axis.
  const { mode, column, row } = scene.symmetry;
  ctx.fillStyle = ACCENT;
  if (mode === "left-right" || mode === "both") {
    const x = toScreen(view, column * net.L, 0).x;
    ctx.beginPath();
    ctx.moveTo(x - 6, 1);
    ctx.lineTo(x + 6, 1);
    ctx.lineTo(x, RULER_TOP - 1);
    ctx.closePath();
    ctx.fill();
  }
  if (mode === "up-down" || mode === "both") {
    const y = toScreen(view, 0, row * net.H).y;
    ctx.beginPath();
    ctx.moveTo(1, y - 6);
    ctx.lineTo(1, y + 6);
    ctx.lineTo(RULER_LEFT - 1, y);
    ctx.closePath();
    ctx.fill();
  }
}
