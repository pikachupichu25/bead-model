// Flat peyote designer: paint beads on a canvas with no edges, then trim it to
// the piece. See docs/flat-peyote-spec.md.

import { catalogFromFiles, type ResolvedBead } from "../src/catalog/catalog.js";
import { allBeadSizes, catalogColors, type FlatBeadSize, resolveBeadSize, resolveFlatBeads } from "../src/flat/beads.js";
import { beadList } from "../src/flat/chart.js";
import { designFromYaml, designToYaml, nextFlatKey, isFlatKey } from "../src/flat/format.js";
import {
  boundsSize,
  type Cell,
  canPaint,
  cellAt,
  cellCenter,
  cellKey,
  emptyCells,
  emptyDesign,
  fillEmptyCells,
  type FlatDesign,
  paintedBounds,
  snapMove,
  trim,
} from "../src/flat/grid.js";
import { boundsRect, cellsAlong, defaultView, fitView, toMm, type View, zoomAt } from "../src/flat/view.js";
import { drawScene } from "./flat-canvas.js";
import { type ImportBlock, setupImport } from "./flat-import.js";

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
  draft: "bead-model:flat-draft",
  view: "bead-model:flat-view",
};

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
  notice: $("notice"),
  title: $<HTMLInputElement>("f-title"),
  beadSize: $("bead-size"),
  beadList: $<HTMLUListElement>("bead-list"),
  addCatalog: $<HTMLSelectElement>("add-catalog"),
  addOwnColor: $<HTMLInputElement>("add-own-color"),
  addOwn: $<HTMLButtonElement>("add-own"),
  tools: [...document.querySelectorAll<HTMLButtonElement>("[data-tool]")],
  zoomIn: $<HTMLButtonElement>("zoom-in"),
  zoomOut: $<HTMLButtonElement>("zoom-out"),
  zoomFit: $<HTMLButtonElement>("zoom-fit"),
  wrap: $("canvas-wrap"),
  canvas: $<HTMLCanvasElement>("canvas"),
  status: $("status"),
  trim: $<HTMLButtonElement>("trim"),
  importFile: $<HTMLInputElement>("import-file"),
  placeBar: $("place-bar"),
  placeText: $("place-text"),
  placeDrop: $<HTMLButtonElement>("place-drop"),
  placeCancel: $<HTMLButtonElement>("place-cancel"),
  beadTotal: $("bead-total"),
  emptyBanner: $("empty-banner"),
  emptyText: $("empty-text"),
  emptyShow: $<HTMLInputElement>("empty-show"),
  emptyBead: $<HTMLSelectElement>("empty-bead"),
  emptyFill: $<HTMLButtonElement>("empty-fill"),
};
const ctx = els.canvas.getContext("2d")!;

type Tool = "paint" | "erase" | "pick" | "hand";

interface Resolved {
  design: Pick<FlatDesign, "bead" | "beads">;
  size: FlatBeadSize;
  beads: Map<string, ResolvedBead>;
  problems: string[];
}

/** A paint or erase stroke in progress. It works on a copy of the cells and is one undo step. */
interface Stroke {
  mode: "paint" | "erase";
  cells: Map<string, string>;
  last: { x: number; y: number };
  changed: boolean;
}

const state: {
  design: FlatDesign;
  resolved: Resolved;
  past: FlatDesign[];
  future: FlatDesign[];
  view: View;
  /** CSS pixels. */
  size: { width: number; height: number };
  tool: Tool;
  paint: string;
  hover?: Cell;
  stroke?: Stroke;
  pan?: { x: number; y: number; panX: number; panY: number };
  /** Touch points, for two-finger pan and pinch. */
  pointers: Map<number, { x: number; y: number }>;
  pinch?: { distance: number; x: number; y: number };
  spaceDown: boolean;
  /** Empty cells inside a trimmed canvas, and whether they are highlighted. */
  empty: Cell[];
  showEmpty: boolean;
  /** An imported block being placed, at offset (dc, dh) with dc + dh even. */
  floating?: {
    block: ImportBlock;
    /** The block's cells as the canvas draws them. */
    drawn: { c: number; h: number; rgb: string }[];
    dc: number;
    dh: number;
    drag?: { x: number; y: number; dc: number; dh: number };
  };
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
  empty: [],
  showEmpty: false,
};

const UNDO_LIMIT = 200;

// ---- Beads ----

/** Resolves the design's beads against the catalog, reusing the last result while they are unchanged. */
function resolve(design: FlatDesign): Resolved {
  const last = state.resolved;
  if (last && last.design.bead === design.bead && last.design.beads === design.beads) return last;
  return { design: { bead: design.bead, beads: design.beads }, ...resolveFlatBeads(design, catalog) };
}

function box() {
  return state.resolved.size.box;
}

// ---- Changing the design ----

/** Makes a change one undo step. */
function commit(next: FlatDesign): void {
  if (next === state.design) return;
  state.past.push(state.design);
  if (state.past.length > UNDO_LIMIT) state.past.shift();
  state.future = [];
  setDesign(next);
}

function setDesign(next: FlatDesign): void {
  state.design = next;
  state.resolved = resolve(next);
  if (!next.beads.has(state.paint)) state.paint = next.beads.keys().next().value ?? "";
  state.empty = emptyCells(next);
  if (state.empty.length === 0) state.showEmpty = false;
  renderPanel();
  renderStatus();
  renderCanvasTools();
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

/** Replaces the design with a new or opened one. The old one stays one undo away. */
function load(design: FlatDesign): void {
  resolveBeadSize(catalog, design.bead); // throws on a bad bead size, before anything changes
  commit(design);
  fit();
  const { problems } = state.resolved;
  if (problems.length) showNotice(`${problems.map(esc).join("<br>")}`, true);
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
        <span class="flat-bead-name${problem ? " bad" : ""}">${esc(beadName(bead))}</span>
        <span class="flat-bead-count muted">${amount(rows.get(key)?.count ?? 0, rows.get(key)?.grams)}</span>
      </button></li>`;
    })
    .join("");

  const used = new Set([...design.beads.values()].filter((v) => typeof v === "string"));
  const colors = catalogColors(resolved.size).filter((c) => !used.has(c.entry));
  els.addCatalog.innerHTML =
    `<option value="">${colors.length ? "+ Add a catalog color…" : "No more catalog colors for this bead"}</option>` +
    colors.map((c) => `<option value="${esc(c.entry)}">${esc(c.entry.replace(/^\S+ /, ""))} · ${esc(c.name)}</option>`).join("");
  els.addCatalog.disabled = colors.length === 0;

  els.beadTotal.textContent = list.total.count ? `Total ${amount(list.total.count, list.total.grams)}` : "";
}

/** "1,203 · 7 g", or just the count when the weight isn't known. */
function amount(count: number, grams: number | undefined): string {
  return count && grams !== undefined ? `${count.toLocaleString()} · ${grams.toLocaleString()} g` : count.toLocaleString();
}

/** The trim button and the empty-spots banner. */
function renderCanvasTools(): void {
  const { design } = state;
  const painted = paintedBounds(design);
  const b = design.bounds;
  const tight = b && painted && b.c0 === painted.c0 && b.c1 === painted.c1 && b.h0 === painted.h0 && b.h1 === painted.h1;
  els.trim.disabled = !painted || !!tight;
  els.trim.title = !painted ? "Paint some beads first" : tight ? "The canvas already ends at the beads" : "Cut the canvas down to the painted beads";

  const n = state.empty.length;
  els.emptyBanner.hidden = n === 0;
  if (n === 0) return;
  els.emptyText.textContent = `${n.toLocaleString()} empty spot${n === 1 ? "" : "s"}: a flat piece needs a bead in each.`;
  els.emptyShow.checked = state.showEmpty;
  const chosen = els.emptyBead.value;
  els.emptyBead.innerHTML = [...design.beads.keys()]
    .map((key) => `<option value="${esc(key)}">${esc(key)} · ${esc(beadName(state.resolved.beads.get(key)))}</option>`)
    .join("");
  els.emptyBead.value = design.beads.has(chosen) ? chosen : state.paint;
}

/** The bead's color name and code, without the size every bead in the piece shares. */
function beadName(bead: ResolvedBead | undefined): string {
  if (!bead) return "";
  const { size } = state.resolved;
  const line = `${size.brand.id === "generic" ? "" : `${size.brand.name} `}${size.line.name} `;
  const short = bead.label.startsWith(size.label) ? bead.label.slice(size.label.length) : bead.label.replace(line, "");
  return short.trim().replace(/^\((.*)\)$/, "$1") || bead.label;
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
  setTool("paint");
  renderPanel();
}

function renderStatus(): void {
  const { design } = state;
  const parts: string[] = [design.bounds ? "Trimmed canvas" : "Unlimited canvas"];
  const area = design.bounds ?? paintedBounds(design);
  if (area) {
    const { columns, rows } = boundsSize(area);
    const { w, d } = box();
    const cm = (mm: number) => (mm / 10).toFixed(1);
    parts.push(`${columns} × ${rows} beads`, `${design.cells.size.toLocaleString()} beads`, `${cm(columns * w)} × ${cm(((rows + 1) * d) / 2)} cm`);
  } else {
    parts.push("Click or drag to paint");
  }
  if (state.hover) {
    const o = origin();
    parts.push(`column ${state.hover.c - o.c + 1}, row ${state.hover.h - o.h + 1}`);
  }
  els.status.textContent = parts.join(" · ");
}

// ---- Canvas ----

/** Rulers and the status bar count from the top-left of the piece, or from cell (0, 0) on an empty canvas. */
function origin(): { c: number; h: number } {
  const area = state.design.bounds ?? paintedBounds(state.design);
  return area ? { c: area.c0, h: area.h0 } : { c: 0, h: 0 };
}

function originMm(): { x: number; y: number } {
  return cellCenter(origin(), box());
}

let frame = 0;
function draw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const { design, resolved } = state;
    const colors = new Map([...resolved.beads].map(([k, b]) => [k, b.display.rgb]));
    drawScene(
      ctx,
      {
        view: state.view,
        ...state.size,
        box: resolved.size.box,
        shape: resolved.size.shape,
        cells: state.stroke?.cells ?? design.cells,
        colors,
        bounds: design.bounds,
        painted: design.bounds ? undefined : paintedBounds(design),
        origin: origin(),
        hover: state.tool === "hand" || state.pan ? undefined : state.hover,
        highlight: state.showEmpty ? state.empty : undefined,
        floating: state.floating && {
          cells: state.floating.drawn,
          dc: state.floating.dc,
          dh: state.floating.dh,
          bounds: { c0: 0, c1: state.floating.block.columns - 1, h0: 0, h1: state.floating.block.rows - 1 },
        },
      },
      devicePixelRatio,
    );
  });
}

function setView(view: View): void {
  state.view = view;
  scheduleSaveView();
  draw();
}

function fit(): void {
  const area = state.design.bounds ?? paintedBounds(state.design);
  const { width, height } = state.size;
  setView(area ? fitView(boundsRect(area, box()), width, height, box()) : defaultView(width, height, box()));
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
    const saved = readView();
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

function mmAt(event: PointerEvent): { x: number; y: number } {
  const p = pointerAt(event);
  return toMm(state.view, p.x, p.y);
}

function setTool(tool: Tool): void {
  state.tool = tool;
  for (const button of els.tools) button.setAttribute("aria-checked", String(button.dataset.tool === tool));
  updateCursor();
  draw();
}

function updateCursor(): void {
  els.wrap.dataset.cursor = state.floating && !state.pan && !state.spaceDown && state.tool !== "hand" ? "move" : state.pan ? "grabbing" : state.tool === "hand" || state.spaceDown ? "grab" : state.tool === "pick" ? "pick" : "";
}

function pick(at: { x: number; y: number }): void {
  const cell = cellAt(at.x, at.y, box());
  const key = state.design.cells.get(cellKey(cell.c, cell.h));
  if (key) selectBead(key);
}

function startStroke(mode: Stroke["mode"], at: { x: number; y: number }): void {
  if (mode === "paint" && !state.design.beads.has(state.paint)) {
    showNotice("Add a bead color first.");
    return;
  }
  state.stroke = { mode, cells: new Map(state.design.cells), last: at, changed: false };
  extendStroke(at);
}

function extendStroke(at: { x: number; y: number }): void {
  const stroke = state.stroke!;
  for (const cell of cellsAlong(stroke.last, at, box())) {
    const key = cellKey(cell.c, cell.h);
    if (stroke.mode === "erase") {
      stroke.changed = stroke.cells.delete(key) || stroke.changed;
    } else if (canPaint(state.design, cell) && stroke.cells.get(key) !== state.paint) {
      stroke.cells.set(key, state.paint);
      stroke.changed = true;
    }
  }
  stroke.last = at;
  draw();
}

function endStroke(): void {
  const stroke = state.stroke;
  state.stroke = undefined;
  if (stroke?.changed) commit({ ...state.design, cells: stroke.cells });
  else draw();
}

els.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

els.canvas.addEventListener("pointerdown", (event) => {
  els.canvas.setPointerCapture(event.pointerId);
  const p = pointerAt(event);
  state.pointers.set(event.pointerId, p);

  if (state.pointers.size === 2) {
    // A second finger: drop the stroke and pan and pinch instead.
    state.stroke = undefined;
    state.pan = undefined;
    state.pinch = pinchOf();
    draw();
    return;
  }
  if (state.pointers.size > 2) return;

  if (event.button === 1 || state.tool === "hand" || state.spaceDown) {
    state.pan = { x: p.x, y: p.y, panX: state.view.panX, panY: state.view.panY };
    updateCursor();
    return;
  }
  const at = mmAt(event);
  if (state.floating) {
    if (event.button === 0) state.floating.drag = { ...at, dc: state.floating.dc, dh: state.floating.dh };
    return;
  }
  if (event.button === 2) startStroke("erase", at);
  else if (event.button === 0 && (event.altKey || state.tool === "pick")) pick(at);
  else if (event.button === 0) startStroke(state.tool === "erase" ? "erase" : "paint", at);
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
  const at = mmAt(event);
  const drag = state.floating?.drag;
  if (drag) {
    const { w, d } = box();
    const move = snapMove((at.x - drag.x) / w, (2 * (at.y - drag.y)) / d);
    moveFloating(drag.dc + move.dc, drag.dh + move.dh);
    return;
  }
  const cell = cellAt(at.x, at.y, box());
  if (!state.hover || state.hover.c !== cell.c || state.hover.h !== cell.h) {
    state.hover = cell;
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
  if (state.floating) state.floating.drag = undefined;
  if (state.stroke) endStroke();
}

els.canvas.addEventListener("pointerup", endPointer);
els.canvas.addEventListener("pointercancel", endPointer);
els.canvas.addEventListener("pointerleave", () => {
  if (state.stroke || state.pan) return;
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

// ---- Saving ----

let saveTimer: number | undefined;
let saveWarned = false;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE.draft, designToYaml(state.design));
    } catch {
      // Storage can be off (private windows) or full. The designer still works, it just won't remember.
      if (!saveWarned) showNotice("This design can't be kept in the browser. Download it to keep it.");
      saveWarned = true;
    }
  }, 500);
}

let viewTimer: number | undefined;
function scheduleSaveView(): void {
  clearTimeout(viewTimer);
  viewTimer = window.setTimeout(() => {
    try {
      // Kept relative to the top-left of the piece: reopening the file places it at new coordinates.
      const o = originMm();
      const { zoom, panX, panY } = state.view;
      localStorage.setItem(STORAGE.view, JSON.stringify({ zoom, panX: panX + o.x * zoom, panY: panY + o.y * zoom }));
    } catch {
      // Not worth a message.
    }
  }, 300);
}

function readView(): View | undefined {
  try {
    const view = JSON.parse(readStored(STORAGE.view) ?? "null") as View | null;
    if (!view || ![view.panX, view.panY, view.zoom].every(Number.isFinite) || view.zoom <= 0) return undefined;
    const o = originMm();
    return { zoom: view.zoom, panX: view.panX - o.x * view.zoom, panY: view.panY - o.y * view.zoom };
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

els.trim.addEventListener("click", () => {
  const next = trim(state.design);
  commit(next);
  const n = state.empty.length;
  showNotice(`Trimmed to the beads.${n ? ` ${n.toLocaleString()} empty spot${n === 1 ? "" : "s"} left inside.` : ""} Undo brings the unlimited canvas back.`);
});

els.emptyShow.addEventListener("change", () => {
  state.showEmpty = els.emptyShow.checked;
  draw();
});

els.emptyFill.addEventListener("click", () => {
  const key = els.emptyBead.value;
  if (key) commit(fillEmptyCells(state.design, key));
});
for (const button of els.tools) button.addEventListener("click", () => setTool(button.dataset.tool as Tool));

els.beadList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-key]");
  if (button) selectBead(button.dataset.key!);
});

els.addCatalog.addEventListener("change", () => {
  if (els.addCatalog.value) addBead(els.addCatalog.value);
});

els.addOwn.addEventListener("click", () => {
  const rgb = els.addOwnColor.value;
  addBead({ color: rgb, display: { rgb } });
});

els.title.addEventListener("change", () => {
  const title = els.title.value.trim() || "Untitled design";
  if (title !== state.design.title) commit({ ...state.design, title });
});

els.newBead.innerHTML = allBeadSizes(catalog)
  .map((s) => `<option value="${esc(s.text)}">${esc(s.label)}</option>`)
  .join("");

els.newButton.addEventListener("click", () => {
  els.newBead.value = state.design.bead;
  els.newName.value = "Untitled design";
  els.newDialog.showModal();
  els.newName.select();
});
els.newCancel.addEventListener("click", () => els.newDialog.close());
els.newForm.addEventListener("submit", () => {
  const size = resolveBeadSize(catalog, els.newBead.value);
  const first = catalogColors(size)[0]?.entry ?? { color: "main", display: { rgb: "#4e79a7" } };
  const title = els.newName.value.trim() || "Untitled design";
  state.paint = "A";
  load({ title, bead: els.newBead.value, beads: new Map([["A", first]]), cells: new Map() });
  showNotice("New design. The previous one is one undo away.");
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

els.downloadYaml.addEventListener("click", () => {
  const name =
    state.design.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design";
  const url = URL.createObjectURL(new Blob([designToYaml(state.design)], { type: "text/yaml" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.flat-peyote.yaml` });
  a.click();
  URL.revokeObjectURL(url);
});

document.addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement).closest("input, select, textarea, dialog")) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (state.floating) {
    const f = state.floating;
    const arrows: Record<string, [number, number]> = { arrowleft: [-1, 1], arrowright: [1, 1], arrowup: [0, -2], arrowdown: [0, 2] };
    if (key in arrows) {
      event.preventDefault();
      const [dc, dh] = arrows[key]!;
      // Sideways, alternate up and down half a bead, so the block doesn't drift.
      moveFloating(f.dc + dc, f.dh + (dc === 0 ? dh : f.dh % 2 === 0 ? 1 : -1));
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      dropFloating();
      return;
    }
    if (key === "escape") {
      cancelFloating();
      return;
    }
  }
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

// ---- Importing and placing a picture ----

const importer = setupImport(
  () => ({
    size: state.resolved.size,
    design: state.design,
    beads: state.resolved.beads,
    nameOf: (key) => beadName(state.resolved.beads.get(key)),
  }),
  (block) => startPlacing(block),
);

async function importFile(file: File | Blob, name = "picture"): Promise<void> {
  if (state.floating) cancelFloating();
  try {
    await importer.open(file, name);
  } catch (e) {
    showNotice(esc(e instanceof Error ? e.message : String(e)));
  }
}

/** Puts the block in the middle of the view, to be dragged into place. */
function startPlacing(block: ImportBlock): void {
  const center = toMm(state.view, state.size.width / 2, state.size.height / 2);
  const at = cellAt(center.x, center.y, box());
  const move = snapMove(at.c - (block.columns - 1) / 2, at.h - (block.rows - 1) / 2);
  const drawn = block.cells.map((cell) => ({ c: cell.c, h: cell.h, rgb: cell.color.rgb }));
  state.floating = { block, drawn, dc: move.dc, dh: move.dh };
  state.stroke = undefined;
  els.placeBar.hidden = false;
  els.placeText.textContent = `Drag the ${block.columns} × ${block.rows} picture into place, or move it with the arrow keys. Moving one column also moves it half a bead.`;
  updateCursor();
  draw();
}

function moveFloating(dc: number, dh: number): void {
  if (!state.floating) return;
  state.floating.dc = dc;
  state.floating.dh = dh;
  draw();
}

function cancelFloating(): void {
  state.floating = undefined;
  els.placeBar.hidden = true;
  updateCursor();
  draw();
}

/**
 * Paints the block in, as one undo step. Colors the design doesn't have yet
 * become new beads. Empty cells of the block leave the canvas as it was.
 */
function dropFloating(): void {
  const f = state.floating;
  if (!f) return;
  const { design } = state;
  const beads = new Map(design.beads);
  const keyFor = new Map<string, string>();
  for (const { color } of f.block.cells) {
    if (keyFor.has(color.id)) continue;
    let key = color.key && beads.has(color.key) ? color.key : undefined;
    key ??= [...beads].find(([, entry]) => typeof entry === "string" && entry === color.entry)?.[0];
    if (!key) {
      key = nextFlatKey(beads.keys());
      if (!key || !isFlatKey(key)) {
        showNotice("This would pass 62 bead colors, the most a design can have. Import again with fewer colors.", true);
        return;
      }
      beads.set(key, color.entry);
    }
    keyFor.set(color.id, key);
  }
  const cells = new Map(design.cells);
  let outside = 0;
  for (const cell of f.block.cells) {
    const at = { c: cell.c + f.dc, h: cell.h + f.dh };
    if (!canPaint(design, at)) {
      outside++;
      continue;
    }
    cells.set(cellKey(at.c, at.h), keyFor.get(cell.color.id)!);
  }
  cancelFloating();
  commit({ ...design, beads, cells });
  if (outside) showNotice(`${outside.toLocaleString()} bead${outside === 1 ? "" : "s"} fell outside the canvas and weren't placed.`);
}

els.placeDrop.addEventListener("click", dropFloating);
els.placeCancel.addEventListener("click", cancelFloating);

els.importFile.addEventListener("change", () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = "";
  if (file) void importFile(file, file.name);
});

els.wrap.addEventListener("dragover", (event) => {
  if (![...(event.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) return;
  event.preventDefault();
  els.wrap.classList.add("dropping");
});
els.wrap.addEventListener("dragleave", () => els.wrap.classList.remove("dropping"));
els.wrap.addEventListener("drop", (event) => {
  event.preventDefault();
  els.wrap.classList.remove("dropping");
  const file = event.dataTransfer?.files[0];
  if (file) void importFile(file, file.name);
});

document.addEventListener("paste", (event) => {
  if ((event.target as HTMLElement).closest("input, textarea")) return;
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (!file) return;
  event.preventDefault();
  void importFile(file, "pasted picture");
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
  let design = emptyDesign();
  const stored = readStored(STORAGE.draft);
  if (stored) {
    try {
      design = designFromYaml(stored);
      resolveBeadSize(catalog, design.bead);
    } catch (e) {
      design = emptyDesign();
      showNotice(`Couldn't reopen your last design: ${esc(e instanceof Error ? e.message : String(e))}`, true);
    }
  }
  state.paint = design.beads.keys().next().value ?? "";
  setDesign(design);
}
