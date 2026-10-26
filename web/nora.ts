// Nora net designer: paint rings of 4 and 8 beads on an open net, usually
// symmetric. See docs/nora-net-spec.md.

import { catalogFromFiles, type ResolvedBead } from "../src/catalog/catalog.js";
import { type ColorSource, isOwned, offeredColors } from "../src/collection/color-source.js";
import { type MyBeads, ownedSizes } from "../src/collection/my-beads.js";
import { allBeadSizes, catalogColors, type FlatBeadSize, resolveBeadSize, resolveFlatBeads } from "../src/flat/beads.js";
import { nextFlatKey } from "../src/flat/format.js";
import { defaultView, fitView, toMm, toScreen, type View, zoomAt } from "../src/flat/view.js";
import { beadList, designRect, renderNoraChartSvg } from "../src/nora/chart.js";
import {
  asymmetricSlots,
  emptyDesign,
  floodFill,
  formatRing,
  type Half,
  looseSlots,
  makeSymmetric,
  type NoraDesign,
  openGroups,
  parts,
  ringLines,
  setSlots,
  type SymmetryMode,
  withMirrors,
} from "../src/nora/design.js";
import { designFromYaml, designToYaml } from "../src/nora/format.js";
import {
  type Group,
  type NetSize,
  netSize,
  type Point,
  type Slot,
  slotAt,
  slotGroups,
  slotKey,
  slotsAlong,
} from "../src/nora/net.js";
import { findDesign } from "../src/collection/designs.js";
import { loadMyDesigns, openDesign, takeDesignHash } from "./designs-store.js";
import { findExample } from "./examples.js";
import { markNotMine, renderColorChoices, pickedColorSource, saveColorsAsPalette } from "./color-choices.js";
import { loadColorSource, loadMyBeads, onMyBeadsChange, saveColorSource } from "./my-beads-store.js";
import { allPalettes } from "./palettes-store.js";
import { renderNav } from "./nav.js";
import { drawNora, RULER_LEFT, RULER_TOP } from "./nora-canvas.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

/** Where the designer keeps its work between visits. */
const STORAGE = {
  draft: "bead-model:nora-draft",
  view: "bead-model:nora-view",
};

renderNav("nora");

/** The design's entry in My designs. */
const mine = openDesign("nora");

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  newButton: $<HTMLButtonElement>("new-design"),
  newDialog: $<HTMLDialogElement>("new-dialog"),
  newForm: $<HTMLFormElement>("new-form"),
  newName: $<HTMLInputElement>("new-name"),
  newBead: $<HTMLSelectElement>("new-bead"),
  newCancel: $<HTMLButtonElement>("new-cancel"),
  file: $<HTMLInputElement>("file-input"),
  undo: $<HTMLButtonElement>("undo"),
  redo: $<HTMLButtonElement>("redo"),
  downloadYaml: $<HTMLButtonElement>("download-yaml"),
  downloadChart: $<HTMLButtonElement>("download-chart"),
  notice: $("notice"),
  title: $<HTMLInputElement>("f-title"),
  beadSize: $("bead-size"),
  beadList: $<HTMLUListElement>("bead-list"),
  beadTotal: $("bead-total"),
  addCatalog: $<HTMLSelectElement>("add-catalog"),
  addOwnColor: $<HTMLInputElement>("add-own-color"),
  addOwn: $<HTMLButtonElement>("add-own"),
  colorSource: $<HTMLSelectElement>("color-source"),
  usePalette: $<HTMLButtonElement>("use-palette"),
  savePalette: $<HTMLButtonElement>("save-palette"),
  onlyMineCount: $<HTMLAnchorElement>("only-mine-count"),
  ringNote: $("ring-note"),
  ringList: $("ring-list"),
  tools: [...document.querySelectorAll<HTMLButtonElement>("[data-tool]")],
  symmetry: $<HTMLSelectElement>("symmetry"),
  makeSymmetric: $<HTMLSelectElement>("make-symmetric"),
  checkSymmetry: $<HTMLButtonElement>("check-symmetry"),
  zoomIn: $<HTMLButtonElement>("zoom-in"),
  zoomOut: $<HTMLButtonElement>("zoom-out"),
  zoomFit: $<HTMLButtonElement>("zoom-fit"),
  looseStatus: $("loose-status"),
  openShow: $<HTMLButtonElement>("open-show"),
  removeLoose: $<HTMLButtonElement>("remove-loose"),
  wrap: $("canvas-wrap"),
  canvas: $<HTMLCanvasElement>("canvas"),
  status: $("status"),
};
const ctx = els.canvas.getContext("2d")!;

/** The beads on the My beads page, and where the colors on offer come from. */
let myBeads: MyBeads = loadMyBeads();
let colorSource: ColorSource = loadColorSource();
/** The `beads:` entries behind the "+ Add a color" options, by option value. */
let addChoices: unknown[] = [];

type Tool = "paint" | "erase" | "fill" | "pick" | "hand";

interface Resolved {
  design: Pick<NoraDesign, "bead" | "beads">;
  size: FlatBeadSize;
  beads: Map<string, ResolvedBead>;
  problems: string[];
}

/** A paint or erase stroke in progress: one undo step. */
interface Stroke {
  key: string | undefined;
  design: NoraDesign;
  last: Point;
}

const state: {
  design: NoraDesign;
  resolved: Resolved;
  past: NoraDesign[];
  future: NoraDesign[];
  view: View;
  size: { width: number; height: number };
  tool: Tool;
  paint: string;
  /** The bead slot under the pointer. */
  hover?: Slot;
  stroke?: Stroke;
  pan?: { x: number; y: number; panX: number; panY: number };
  /** Dragging a symmetry axis by its marker in the ruler. */
  axis?: "column" | "row";
  pointers: Map<number, { x: number; y: number }>;
  pinch?: { distance: number; x: number; y: number };
  spaceDown: boolean;
  /** Beads no closed ring holds, the open rings with them, and the loose parts. */
  loose: Slot[];
  open: Group[];
  extraParts: Group[];
  showOpen: boolean;
  /** Beads that don't match their mirror, while Check symmetry is on. */
  off?: Slot[];
} = {
  design: emptyDesign(),
  resolved: undefined as unknown as Resolved,
  past: [],
  future: [],
  view: { panX: 0, panY: 0, zoom: 10 },
  size: { width: 0, height: 0 },
  tool: "paint",
  paint: "A",
  pointers: new Map(),
  spaceDown: false,
  loose: [],
  open: [],
  extraParts: [],
  showOpen: false,
};

const UNDO_LIMIT = 200;

// ---- Beads ----

function resolve(design: NoraDesign): Resolved {
  const last = state.resolved;
  if (last && last.design.bead === design.bead && last.design.beads === design.beads) return last;
  return { design: { bead: design.bead, beads: design.beads }, ...resolveFlatBeads(design, catalog) };
}

function net(): NetSize {
  return netSize(state.resolved.size.box.d);
}

function box() {
  return state.resolved.size.box;
}

// ---- Changing the design ----

function commit(next: NoraDesign): void {
  if (next === state.design) return;
  state.past.push(state.design);
  if (state.past.length > UNDO_LIMIT) state.past.shift();
  state.future = [];
  setDesign(next);
}

function setDesign(next: NoraDesign): void {
  const slotsChanged = next.slots !== state.design.slots || next.symmetry !== state.design.symmetry;
  state.design = next;
  state.resolved = resolve(next);
  if (!next.beads.has(state.paint)) state.paint = next.beads.keys().next().value ?? "";
  state.loose = looseSlots(next);
  state.open = openGroups(next);
  state.extraParts = parts(next).slice(1).flat();
  if (state.loose.length === 0 && state.extraParts.length === 0) state.showOpen = false;
  if (state.off && slotsChanged) setChecking(false);
  renderPanel();
  renderRings();
  renderLoose();
  renderSymmetry();
  renderStatus();
  updateUndo();
  scheduleSave();
  draw();
}

function undo(): void {
  const previous = state.past.pop();
  if (!previous) return;
  state.future.push(state.design);
  setDesign(previous);
}

function redo(): void {
  const next = state.future.pop();
  if (!next) return;
  state.past.push(state.design);
  setDesign(next);
}

function updateUndo(): void {
  els.undo.disabled = state.past.length === 0;
  els.redo.disabled = state.future.length === 0;
}

/**
 * Opens another design: one of mine (`mine` is its id), or one that isn't
 * saved yet and starts as `start` (a new design or an example). Without
 * either, as for a file, it is saved at once. The design before stays in My
 * designs, so undo starts over.
 */
function load(design: NoraDesign, from: { mine?: string; start?: string } = {}): void {
  resolveBeadSize(catalog, design.bead); // throws on a bad bead size, before anything changes
  saveNow();
  if (from.mine) mine.open(from.mine);
  else mine.start(from.start);
  state.past = [];
  state.future = [];
  setDesign(design);
  fit();
  const { problems } = state.resolved;
  if (problems.length) showNotice(problems.map(esc).join("<br>"), true);
}

// ---- Panel ----

function renderPanel(): void {
  const { design, resolved } = state;
  if (document.activeElement !== els.title) els.title.value = design.title;
  els.beadSize.textContent = resolved.size.label;

  const list = beadList(design, resolved.beads);
  const rows = new Map(list.rows.map((r) => [r.key, r]));
  const problemFor = new Map(resolved.problems.map((p) => [/^bead (\S+):/.exec(p)?.[1] ?? "", p]));
  els.beadList.innerHTML = [...design.beads.keys()]
    .map((key) => {
      const bead = resolved.beads.get(key);
      const problem = problemFor.get(key);
      const on = key === state.paint;
      return `<li><button type="button" role="radio" aria-checked="${on}" data-key="${esc(key)}" title="${esc(problem ?? bead?.label ?? key)}">
        <span class="swatch big" style="background:${esc(bead?.display.rgb ?? "#999")}"></span>
        <b>${esc(key)}</b>
        <span class="flat-bead-name${problem ? " bad" : ""}">${esc(beadName(bead))}${markNotMine(colorSource, myBeads) && !isMine(design.beads.get(key)) ? ` <span class="not-mine">not mine</span>` : ""}</span>
        <span class="flat-bead-count muted">${amount(rows.get(key)?.count ?? 0, rows.get(key)?.grams)}</span>
      </button></li>`;
    })
    .join("");

  addChoices = renderColorChoices(
    { colorSource: els.colorSource, addCatalog: els.addCatalog, usePalette: els.usePalette, addOwn: els.addOwn.parentElement!, count: els.onlyMineCount },
    { source: colorSource, size: resolved.size, used: new Set([...design.beads.values()].map((v) => JSON.stringify(v))), myBeads, catalog },
  );

  els.beadTotal.textContent = list.total.count ? `Total ${amount(list.total.count, list.total.grams)}` : "";
}

const RING_LIMIT = 500;

/** Each closed ring with its beads in ring order (N27). */
function renderRings(): void {
  const lines = ringLines(state.design);
  els.ringList.hidden = lines.length === 0;
  els.ringNote.textContent = lines.length
    ? `${lines.length.toLocaleString()} closed ring${lines.length === 1 ? "" : "s"}, top to bottom. Beads go clockwise from the top.`
    : "Closed rings are listed here with their beads.";
  const shown = lines.slice(0, RING_LIMIT).map(formatRing);
  if (lines.length > RING_LIMIT) shown.push(`… and ${(lines.length - RING_LIMIT).toLocaleString()} more`);
  els.ringList.textContent = shown.join("\n");
}

/**
 * A small count in the status bar of beads no closed ring holds, and of loose
 * parts (N21, N22). Clicking it marks them on the canvas. It stays out of the
 * way, since painting bead by bead leaves beads loose until each ring closes.
 */
function renderLoose(): void {
  const loose = state.loose.length;
  const partCount = parts(state.design).length;
  const bits: string[] = [];
  if (loose) bits.push(`${loose.toLocaleString()} loose bead${loose === 1 ? "" : "s"}`);
  if (partCount > 1) bits.push(`${partCount} loose parts`);
  els.looseStatus.hidden = bits.length === 0;
  els.openShow.textContent = bits.join(", ");
  els.openShow.setAttribute("aria-pressed", String(state.showOpen));
  els.openShow.title = state.showOpen
    ? "Hide the marks"
    : "Mark them: beads no closed ring holds, the open rings around them, and parts that share no bead with the rest";
  els.removeLoose.hidden = loose === 0;
}

function renderSymmetry(): void {
  els.symmetry.value = state.design.symmetry.mode;
  const on = state.design.symmetry.mode !== "off";
  els.makeSymmetric.disabled = !on;
  els.checkSymmetry.disabled = !on;
  const { mode } = state.design.symmetry;
  for (const option of els.makeSymmetric.options) {
    if (!option.value) continue;
    const vertical = option.value === "left" || option.value === "right";
    option.hidden = vertical ? mode === "up-down" : mode === "left-right";
  }
}

function beadName(bead: ResolvedBead | undefined): string {
  if (!bead) return "";
  const { size } = state.resolved;
  const line = `${size.brand.id === "generic" ? "" : `${size.brand.name} `}${size.line.name} `;
  const short = bead.label.startsWith(size.label) ? bead.label.slice(size.label.length) : bead.label.replace(line, "");
  return short.trim().replace(/^\((.*)\)$/, "$1") || bead.label;
}

function isMine(entry: unknown): boolean {
  return isOwned(myBeads, state.resolved.size, entry);
}

function amount(count: number, grams: number | undefined): string {
  return count && grams !== undefined ? `${count.toLocaleString()} · ${grams.toLocaleString()} g` : count.toLocaleString();
}

function addBead(entry: unknown): void {
  const key = nextFlatKey(state.design.beads.keys());
  if (!key) {
    showNotice("A design can have at most 62 bead colors.");
    return;
  }
  state.paint = key;
  commit({ ...state.design, beads: new Map([...state.design.beads, [key, entry]]) });
}

function selectBead(key: string): void {
  state.paint = key;
  if (state.tool !== "fill") setTool("paint");
  renderPanel();
}

function renderStatus(): void {
  const { design } = state;
  const parts: string[] = [];
  const rect = designRect(design, net());
  if (rect) {
    const cm = (mm: number) => (mm / 10).toFixed(1);
    parts.push(`${design.slots.size.toLocaleString()} beads`, `${cm(rect.x1 - rect.x0)} × ${cm(rect.y1 - rect.y0)} cm`);
  } else {
    parts.push("Click or drag to paint beads");
  }
  if (state.hover) {
    const [a, b] = slotGroups(state.hover);
    parts.push(`bead between rings ${num(a.i)}, ${num(a.j)} and ${num(b.i)}, ${num(b.j)}`);
  }
  els.status.textContent = parts.join(" · ");
}

function num(n: number): string {
  return String(n).replace("-", "−");
}

// ---- Canvas ----

let frame = 0;
function draw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const { design, resolved } = state;
    const colors = new Map([...resolved.beads].map(([k, b]) => [k, b.display.rgb]));
    const marks = state.showOpen
      ? [
          { groups: state.open, color: "rgb(230 126 34)" },
          { groups: state.extraParts, color: "rgb(60 90 153)" },
        ]
      : undefined;
    drawNora(
      ctx,
      {
        view: state.view,
        ...state.size,
        net: net(),
        w: box().w,
        shape: resolved.size.shape,
        slots: state.stroke?.design.slots ?? design.slots,
        colors,
        symmetry: design.symmetry,
        hover: hoverScene(),
        groupMarks: marks,
        slotMarks: state.off ?? (state.showOpen ? state.loose : undefined),
      },
      devicePixelRatio,
    );
  });
}

/** What to outline under the pointer, with its mirror images. */
function hoverScene() {
  const h = state.hover;
  if (!h || state.tool === "hand" || state.pan || state.axis) return undefined;
  const painting = state.tool === "paint" || state.tool === "erase";
  return { slots: painting ? withMirrors([h], state.design.symmetry) : [h], faint: slotGroups(h) };
}

function setView(view: View): void {
  state.view = view;
  scheduleSaveView();
  draw();
}

function fit(): void {
  const rect = designRect(state.design, net());
  const { width, height } = state.size;
  setView(rect ? fitView(rect, width, height, box(), 40) : defaultView(width, height, box()));
}

function zoomBy(factor: number, sx = state.size.width / 2, sy = state.size.height / 2): void {
  setView(zoomAt(state.view, factor, sx, sy, box()));
}

function resizeCanvas(): void {
  const rect = els.wrap.getBoundingClientRect();
  const first = state.size.width === 0;
  state.size = { width: rect.width, height: rect.height };
  els.canvas.width = Math.round(rect.width * devicePixelRatio);
  els.canvas.height = Math.round(rect.height * devicePixelRatio);
  if (first) {
    const saved = restoreView ? readView() : undefined;
    if (saved) setView(saved);
    else fit();
  }
  draw();
}

new ResizeObserver(resizeCanvas).observe(els.wrap);

function pointerAt(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = els.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function setTool(tool: Tool): void {
  state.tool = tool;
  for (const button of els.tools) button.setAttribute("aria-checked", String(button.dataset.tool === tool));
  updateCursor();
  draw();
}

function updateCursor(): void {
  const panning = state.pan || state.tool === "hand" || state.spaceDown;
  els.canvas.style.cursor = state.axis ? "grabbing" : panning ? (state.pan ? "grabbing" : "grab") : state.tool === "pick" ? "copy" : "crosshair";
}

function sameSlot(a: Slot | undefined, b: Slot | undefined): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
}

function pick(at: Point): void {
  const slot = slotAt(at, net());
  const key = slot && state.design.slots.get(slotKey(slot.x, slot.y));
  if (key) selectBead(key);
}

function fillAt(at: Point): void {
  const slot = slotAt(at, net());
  if (!slot || !state.design.slots.has(slotKey(slot.x, slot.y))) {
    showNotice("Fill recolors beads that are already there. Click a bead.");
    return;
  }
  // Fill from the bead, then from each of its mirror images.
  let next = state.design;
  for (const s of withMirrors([slot], next.symmetry)) next = floodFill(next, s, state.paint);
  commit(next);
}

function startStroke(erase: boolean, at: Point): void {
  if (!erase && !state.design.beads.has(state.paint)) {
    showNotice("Add a bead color first.");
    return;
  }
  state.stroke = { key: erase ? undefined : state.paint, design: state.design, last: at };
  extendStroke(at);
}

function extendStroke(at: Point): void {
  const stroke = state.stroke!;
  const touched = slotsAlong(stroke.last, at, net());
  stroke.design = setSlots(stroke.design, withMirrors(touched, stroke.design.symmetry), stroke.key);
  stroke.last = at;
  draw();
}

function endStroke(): void {
  const stroke = state.stroke;
  state.stroke = undefined;
  if (stroke) commit(stroke.design);
  else draw();
}

/** Moves a symmetry axis to the group column or row under the pointer. */
function moveAxis(p: { x: number; y: number }): void {
  const at = toMm(state.view, p.x, p.y);
  const { symmetry } = state.design;
  const next =
    state.axis === "column" ? { ...symmetry, column: Math.round(at.x / net().L) } : { ...symmetry, row: Math.round(at.y / net().L) };
  if (next.column !== symmetry.column || next.row !== symmetry.row) {
    // Moving the axis replaces the design without an undo step per group; endPointer makes it one.
    state.design = { ...state.design, symmetry: next };
    draw();
  }
}

/** Which axis marker in the rulers is under a point, if any. */
function axisAt(p: { x: number; y: number }): "column" | "row" | undefined {
  const { mode, column, row } = state.design.symmetry;
  if (p.y <= RULER_TOP && p.x > RULER_LEFT && (mode === "left-right" || mode === "both")) {
    return Math.abs(toScreen(state.view, column * net().L, 0).x - p.x) <= 10 ? "column" : undefined;
  }
  if (p.x <= RULER_LEFT && p.y > RULER_TOP && (mode === "up-down" || mode === "both")) {
    return Math.abs(toScreen(state.view, 0, row * net().L).y - p.y) <= 10 ? "row" : undefined;
  }
  return undefined;
}

let axisStart: NoraDesign | undefined;

els.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

els.canvas.addEventListener("pointerdown", (event) => {
  els.canvas.setPointerCapture(event.pointerId);
  const p = pointerAt(event);
  state.pointers.set(event.pointerId, p);

  if (state.pointers.size === 2) {
    state.stroke = undefined;
    state.pan = undefined;
    state.pinch = pinchOf();
    draw();
    return;
  }
  if (state.pointers.size > 2) return;

  const axis = event.button === 0 ? axisAt(p) : undefined;
  if (axis) {
    state.axis = axis;
    axisStart = state.design;
    updateCursor();
    return;
  }
  if (event.button === 1 || state.tool === "hand" || state.spaceDown) {
    state.pan = { x: p.x, y: p.y, panX: state.view.panX, panY: state.view.panY };
    updateCursor();
    return;
  }
  const at = toMm(state.view, p.x, p.y);
  if (event.button === 2) startStroke(true, at);
  else if (event.button === 0 && (event.altKey || state.tool === "pick")) pick(at);
  else if (event.button === 0 && state.tool === "fill") fillAt(at);
  else if (event.button === 0) startStroke(state.tool === "erase", at);
});

els.canvas.addEventListener("pointermove", (event) => {
  const p = pointerAt(event);
  if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, p);

  if (state.pinch && state.pointers.size === 2) {
    const now = pinchOf();
    const moved = { ...state.view, panX: state.view.panX + now.x - state.pinch.x, panY: state.view.panY + now.y - state.pinch.y };
    setView(zoomAt(moved, now.distance / state.pinch.distance, now.x, now.y, box()));
    state.pinch = now;
    return;
  }
  if (state.pan) {
    setView({ ...state.view, panX: state.pan.panX + p.x - state.pan.x, panY: state.pan.panY + p.y - state.pan.y });
    return;
  }
  if (state.axis) {
    moveAxis(p);
    return;
  }
  if (!state.stroke && event.buttons === 0) {
    const axis = axisAt(p);
    if (axis) els.canvas.style.cursor = axis === "column" ? "ew-resize" : "ns-resize";
    else updateCursor();
  }
  const at = toMm(state.view, p.x, p.y);
  const hover = slotAt(at, net());
  if (!sameSlot(hover, state.hover)) {
    state.hover = hover;
    renderStatus();
    draw();
  }
  if (state.stroke) extendStroke(at);
});

function endPointer(event: PointerEvent): void {
  state.pointers.delete(event.pointerId);
  if (state.pinch) {
    if (state.pointers.size < 2) state.pinch = undefined;
    return;
  }
  if (state.pan) {
    state.pan = undefined;
    updateCursor();
    return;
  }
  if (state.axis) {
    state.axis = undefined;
    updateCursor();
    const moved = state.design;
    if (axisStart && moved !== axisStart) {
      state.design = axisStart;
      commit(moved);
    }
    axisStart = undefined;
    return;
  }
  if (state.stroke) endStroke();
}

els.canvas.addEventListener("pointerup", endPointer);
els.canvas.addEventListener("pointercancel", endPointer);
els.canvas.addEventListener("pointerleave", () => {
  if (state.stroke || state.pan || state.axis) return;
  state.hover = undefined;
  renderStatus();
  draw();
});

els.canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const p = pointerAt(event);
    // A pinch on a trackpad comes as ctrl + wheel. A mouse wheel moves in big
    // whole steps; a trackpad scroll in small ones, and pans.
    const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY));
    if (event.ctrlKey || event.metaKey || mouseWheel) {
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      zoomBy(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
    } else {
      setView({ ...state.view, panX: state.view.panX - event.deltaX, panY: state.view.panY - event.deltaY });
    }
  },
  { passive: false },
);

function pinchOf(): { distance: number; x: number; y: number } {
  const [a, b] = [...state.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
  return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---- Symmetry ----

function setChecking(on: boolean): void {
  state.off = on ? asymmetricSlots(state.design) : undefined;
  els.checkSymmetry.setAttribute("aria-pressed", String(on));
}

els.symmetry.addEventListener("change", () => {
  commit({ ...state.design, symmetry: { ...state.design.symmetry, mode: els.symmetry.value as SymmetryMode } });
});

els.makeSymmetric.addEventListener("change", () => {
  const from = els.makeSymmetric.value as Half | "";
  els.makeSymmetric.value = "";
  if (!from) return;
  const next = makeSymmetric(state.design, from);
  if (next.slots.size === state.design.slots.size && [...next.slots].every(([k, v]) => state.design.slots.get(k) === v)) {
    showNotice("Already symmetric that way.");
    return;
  }
  commit(next);
  showNotice(`Copied the ${from} half across the axis. Undo puts it back.`);
});

els.checkSymmetry.addEventListener("click", () => {
  setChecking(!state.off);
  if (state.off) {
    const n = state.off.length;
    showNotice(n ? `${n.toLocaleString()} bead${n === 1 ? " doesn't" : "s don't"} match the mirror image.` : "Everything matches its mirror image.");
  }
  draw();
});

// ---- Saving ----

let saveTimer: number | undefined;
let saveWarned = false;
/** False until the design from the last visit is open, so the empty one before it is never saved. */
let started = false;
/** Whether to show the piece where it was on the last visit. Not for a design opened from Home or the profile. */
let restoreView = true;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 500);
}

function saveNow(): void {
  clearTimeout(saveTimer);
  if (!started) return;
  const yaml = designToYaml(state.design);
  let kept = mine.save(state.design.title, yaml, state.design.slots.size === 0);
  try {
    localStorage.setItem(STORAGE.draft, yaml);
  } catch {
    kept = false;
  }
  if (!kept && !saveWarned) showNotice("This design can't be kept in the browser. Download it to keep it.");
  if (!kept) saveWarned = true;
}

window.addEventListener("pagehide", saveNow);

let viewTimer: number | undefined;
function scheduleSaveView(): void {
  clearTimeout(viewTimer);
  viewTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE.view, JSON.stringify(state.view));
    } catch {
      // Not worth a message.
    }
  }, 300);
}

function readView(): View | undefined {
  try {
    const saved = JSON.parse(readStored(STORAGE.view) ?? "null") as View | null;
    if (!saved || ![saved.panX, saved.panY, saved.zoom].every(Number.isFinite) || saved.zoom <= 0) return undefined;
    return { panX: saved.panX, panY: saved.panY, zoom: saved.zoom };
  } catch {
    return undefined;
  }
}

function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

// ---- Toolbar ----

els.undo.addEventListener("click", undo);
els.redo.addEventListener("click", redo);
els.zoomIn.addEventListener("click", () => zoomBy(1.25));
els.zoomOut.addEventListener("click", () => zoomBy(0.8));
els.zoomFit.addEventListener("click", fit);
for (const button of els.tools) button.addEventListener("click", () => setTool(button.dataset.tool as Tool));

els.openShow.addEventListener("click", () => {
  state.showOpen = !state.showOpen;
  renderLoose();
  draw();
});

els.removeLoose.addEventListener("click", () => {
  const n = state.loose.length;
  commit(setSlots(state.design, state.loose, undefined));
  showNotice(`Removed ${n.toLocaleString()} loose bead${n === 1 ? "" : "s"}.`);
});

els.beadList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-key]");
  if (button) selectBead(button.dataset.key!);
});

els.addCatalog.addEventListener("change", () => {
  const entry = els.addCatalog.value ? addChoices[Number(els.addCatalog.value)] : undefined;
  if (entry !== undefined) addBead(entry);
});

els.addOwn.addEventListener("click", () => {
  const rgb = els.addOwnColor.value;
  addBead({ color: rgb, display: { rgb } });
});

els.title.addEventListener("change", () => {
  const title = els.title.value.trim() || "Untitled design";
  if (title !== state.design.title) commit({ ...state.design, title });
});

els.usePalette.addEventListener("click", () => {
  const room = 62 - state.design.beads.size;
  if (addChoices.length > room) showNotice(`A design can have at most 62 bead colors, so only ${room} of these were added.`);
  const beads = new Map(state.design.beads);
  for (const entry of addChoices.slice(0, Math.max(0, room))) {
    const key = nextFlatKey(beads.keys());
    if (key) beads.set(key, entry);
  }
  if (beads.size !== state.design.beads.size) commit({ ...state.design, beads });
});

els.colorSource.addEventListener("change", () => {
  const picked = pickedColorSource(els.colorSource);
  if (!picked) return;
  colorSource = picked;
  saveColorSource(colorSource);
  renderPanel();
});

els.savePalette.addEventListener("click", async () => {
  const saved = await saveColorsAsPalette([...state.design.beads.values()], state.design.title);
  if (!saved) return;
  showNotice(
    saved.saved
      ? `Saved “${esc(saved.name)}” to <a href="./profile.html#palettes">my palettes</a>. Pick it in Colors from in any design.`
      : "This browser won't keep the palette (storage is off, as in a private window).",
  );
  renderPanel();
});

onMyBeadsChange(() => {
  myBeads = loadMyBeads();
  colorSource = loadColorSource();
  renderPanel();
});

/** The bead sizes for a new design: round beads first, since Nora work is mostly round seed beads. */
function renderNewBeadOptions(): void {
  const option = (s: { text: string; label: string }) => `<option value="${esc(s.text)}">${esc(s.label)}</option>`;
  const sizes = allBeadSizes(catalog);
  const mine = ownedSizes(myBeads, catalog);
  const isRound = (s: { text: string }) => s.text.split(" ")[1] === "round";
  const groups =
    colorSource === "mine" && mine.size
      ? [["Sizes I have", sizes.filter((s) => mine.has(s.text))], ["Other sizes", sizes.filter((s) => !mine.has(s.text))]]
      : [["Round beads", sizes.filter(isRound)], ["Other beads", sizes.filter((s) => !isRound(s))]];
  els.newBead.innerHTML = (groups as [string, typeof sizes][])
    .map(([label, list]) => `<optgroup label="${esc(label)}">${list.map(option).join("")}</optgroup>`)
    .join("");
}

els.newButton.addEventListener("click", () => {
  renderNewBeadOptions();
  els.newBead.value = state.design.bead;
  els.newName.value = "Untitled design";
  els.newDialog.showModal();
  els.newName.select();
});
els.newCancel.addEventListener("click", () => els.newDialog.close());
els.newForm.addEventListener("submit", () => {
  const size = resolveBeadSize(catalog, els.newBead.value);
  const first =
    offeredColors(colorSource, size, { myBeads, palettes: allPalettes(), catalog })[0]?.entry ?? catalogColors(size)[0]?.entry ?? { color: "main", display: { rgb: "#4e79a7" } };
  const title = els.newName.value.trim() || "Untitled design";
  state.paint = "A";
  const design: NoraDesign = { ...emptyDesign(els.newBead.value, title), beads: new Map([["A", first]]) };
  load(design, { start: designToYaml(design) });
  showNotice("New design. Your other designs are on <a href=\"./profile.html\">your profile</a>.");
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  els.file.value = "";
  if (!file) return;
  try {
    load(designFromYaml(await file.text()));
  } catch (e) {
    showNotice(`Couldn't open ${esc(file.name)}: ${esc(e instanceof Error ? e.message : String(e))}`, true);
  }
});

function fileName(): string {
  return (
    state.design.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design"
  );
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

els.downloadYaml.addEventListener("click", () => download(`${fileName()}.nora.yaml`, designToYaml(state.design), "text/yaml"));

els.downloadChart.addEventListener("click", () => {
  const { size, beads } = state.resolved;
  const svg = renderNoraChartSvg({ design: state.design, beads, d: size.box.d, w: size.box.w, shape: size.shape, sizeLabel: size.label });
  download(`${fileName()}-chart.svg`, svg, "image/svg+xml");
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && event.target.closest("input, select, textarea, dialog")) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (key === " ") {
    event.preventDefault();
    if (!state.spaceDown) {
      state.spaceDown = true;
      updateCursor();
    }
  } else if (key === "b") setTool("paint");
  else if (key === "e") setTool("erase");
  else if (key === "i") setTool("pick");
  else if (key === "h") setTool("hand");
  else if (key === "g") setTool("fill");
  else if (key === "+" || key === "=") zoomBy(1.25);
  else if (key === "-") zoomBy(0.8);
  else if (key === "0") fit();
});

document.addEventListener("keyup", (event) => {
  if (event.key === " ") {
    state.spaceDown = false;
    updateCursor();
  }
});

// ---- Helpers ----

let noticeTimer: number | undefined;
function showNotice(html: string, keep = false): void {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  if (!keep) noticeTimer = window.setTimeout(() => (els.notice.hidden = true), 6000);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---- Start ----

{
  // The design asked for in the address (from Home or the profile), else the one from the last visit.
  const asked = takeDesignHash();
  let design = emptyDesign();
  try {
    if (asked.design) {
      restoreView = false;
      const saved = findDesign(loadMyDesigns(), asked.design);
      if (!saved) throw new Error("it isn't in My designs any more");
      design = designFromYaml(saved.yaml);
      mine.open(saved.id);
    } else if (asked.example) {
      restoreView = false;
      const example = findExample("nora", asked.example);
      if (!example) throw new Error(`there is no example "${asked.example}"`);
      design = designFromYaml(example.yaml);
      mine.start(designToYaml(design));
    } else {
      const stored = readStored(STORAGE.draft);
      if (stored) design = designFromYaml(stored);
    }
    resolveBeadSize(catalog, design.bead);
  } catch (e) {
    design = emptyDesign();
    mine.start(designToYaml(design));
    showNotice(`Couldn't open the design: ${esc(e instanceof Error ? e.message : String(e))}`, true);
  }
  started = true;
  state.paint = design.beads.keys().next().value ?? "";
  setDesign(design);
  if (asked.isNew) els.newButton.click();
}
