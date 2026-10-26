// Flat peyote designer: paint beads on a canvas with no edges, then trim it to
// the piece. See docs/flat-peyote-spec.md.

import { catalogFromFiles, type ResolvedBead } from "../src/catalog/catalog.js";
import { type ColorSource, isOwned, offeredColors } from "../src/collection/color-source.js";
import { type MyBeads, ownedColorsFor, ownedSizes } from "../src/collection/my-beads.js";
import { allBeadSizes, catalogColors, type FlatBeadSize, resolveBeadSize, resolveFlatBeads } from "../src/flat/beads.js";
import { beadList, formatRow, oddTurnNote, pieceCount, renderFlatChartSvg, wordChart, wordChartText } from "../src/flat/chart.js";
import { deltaE2000, hexToLab, LINEAR, linearToLab } from "../src/flat/color.js";
import { designFromYaml, designToYaml, nextFlatKey, isFlatKey } from "../src/flat/format.js";
import {
  type Bounds,
  boundsBetween,
  boundsSize,
  type Cell,
  canPaint,
  cellAt,
  cellCenter,
  cellKey,
  cellsIn,
  cellsOutside,
  emptyCells,
  eraseCells,
  inBounds,
  liftBlock,
  makeUnlimited,
  mirrorCells,
  emptyDesign,
  fillEmptyCells,
  floodFill,
  type FlatDesign,
  paintedBounds,
  resize,
  snapMove,
  trim,
} from "../src/flat/grid.js";
import { boundsRect, cellsAlong, defaultView, fitView, type Rect, toMm, toScreen, turnView, type View, zoomAt } from "../src/flat/view.js";
import { markNotMine, paletteForImport, renderColorChoices, pickedColorSource, saveColorsAsPalette } from "./color-choices.js";
import { clearBackdrop, loadBackdrop, saveBackdrop } from "./flat-backdrop.js";
import { drawScene } from "./flat-canvas.js";
import { type ImportBlock, type ImportColor, setupImport } from "./flat-import.js";
import { findDesign } from "../src/collection/designs.js";
import { loadMyDesigns, openDesign, takeDesignHash } from "./designs-store.js";
import { findExample } from "./examples.js";
import { loadColorSource, loadMyBeads, onMyBeadsChange, saveColorSource } from "./my-beads-store.js";
import { renderNav } from "./nav.js";
import { allPalettes } from "./palettes-store.js";

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

renderNav("flat");

/** The design's entry in My designs. */
const mine = openDesign("flat");

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
  colorSource: $<HTMLSelectElement>("color-source"),
  usePalette: $<HTMLButtonElement>("use-palette"),
  savePalette: $<HTMLButtonElement>("save-palette"),
  onlyMineCount: $<HTMLAnchorElement>("only-mine-count"),
  tools: [...document.querySelectorAll<HTMLButtonElement>("[data-tool]")],
  zoomIn: $<HTMLButtonElement>("zoom-in"),
  zoomOut: $<HTMLButtonElement>("zoom-out"),
  zoomFit: $<HTMLButtonElement>("zoom-fit"),
  wrap: $("canvas-wrap"),
  canvas: $<HTMLCanvasElement>("canvas"),
  status: $("status"),
  trim: $<HTMLButtonElement>("trim"),
  downloadChart: $<HTMLButtonElement>("download-chart"),
  downloadWords: $<HTMLButtonElement>("download-words"),
  wordNote: $("word-note"),
  wordChart: $("word-chart"),
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
  turnView: $<HTMLButtonElement>("turn-view"),
  selectBar: $("select-bar"),
  selectText: $("select-text"),
  canvasUnlimited: $("canvas-unlimited"),
  canvasTrimmed: $("canvas-trimmed"),
  canvasColumns: $<HTMLInputElement>("canvas-columns"),
  canvasRows: $<HTMLInputElement>("canvas-rows"),
  canvasApply: $<HTMLButtonElement>("canvas-apply"),
  makeUnlimited: $<HTMLButtonElement>("make-unlimited"),
  backdropTools: $("backdrop-tools"),
  backdropShow: $<HTMLButtonElement>("backdrop-show"),
  backdropOpacity: $<HTMLInputElement>("backdrop-opacity"),
  backdropRemove: $<HTMLButtonElement>("backdrop-remove"),
};
const ctx = els.canvas.getContext("2d")!;

/** The beads on the My beads page, and where the colors on offer come from. */
let myBeads: MyBeads = loadMyBeads();
let colorSource: ColorSource = loadColorSource();
/** The `beads:` entries behind the "+ Add a color" options, by option value. */
let addChoices: unknown[] = [];

type Tool = "paint" | "erase" | "fill" | "pick" | "select" | "hand";

type Edge = "c0" | "c1" | "h0" | "h1";

/** Copied beads, with their `beads:` entries so they paste into any design. */
interface Clipboard {
  cells: { c: number; h: number; key: string }[];
  colors: Map<string, ImportColor>;
}

interface Resolved {
  design: Pick<FlatDesign, "bead" | "beads">;
  size: FlatBeadSize;
  beads: Map<string, ResolvedBead>;
  problems: string[];
}

interface Backdrop {
  image: OffscreenCanvas;
  /** Where it lies, in mm. */
  rect: Rect;
  opacity: number;
  shown: boolean;
  /** Its pixels, read the first time a color is picked from it. */
  pixels?: ImageData;
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
    /** For a moved selection: the design before the cells were lifted, and where they came from. */
    lifted?: { design: FlatDesign; selection: Bounds; dc: number; dh: number };
    what: string;
  };
  selection?: Bounds;
  selecting?: Cell;
  clipboard?: Clipboard;
  /** An edge of a trimmed canvas being dragged, and the bounds it would give. */
  resizing?: { edge: Edge; bounds: Bounds };
  /** A picture behind the beads, to bead over. Not part of the design or its undo. */
  backdrop?: Backdrop;
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
  renderCanvasSize();
  renderSelectBar();
  renderWordChart();
  updateUndo();
  scheduleSave();
  draw();
}

function undo(): void {
  if (state.floating) {
    cancelFloating();
    return;
  }
  const previous = state.past.pop();
  if (!previous) return;
  state.future.push(state.design);
  setDesign(previous);
}

function redo(): void {
  if (state.floating) return;
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
function load(design: FlatDesign, from: { mine?: string; start?: string } = {}): void {
  resolveBeadSize(catalog, design.bead); // throws on a bad bead size, before anything changes
  saveNow();
  if (from.mine) mine.open(from.mine);
  else mine.start(from.start);
  state.past = [];
  state.future = [];
  setDesign(design);
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

/** "1,203 · 7 g", or just the count when the weight isn't known. */
function amount(count: number, grams: number | undefined): string {
  return count && grams !== undefined ? `${count.toLocaleString()} · ${grams.toLocaleString()} g` : count.toLocaleString();
}

/** The "Row by row" panel. Only a trimmed canvas with no empty spots has a word chart. */
function renderWordChart(): void {
  const chart = wordChart(state.design);
  const ok = !("problem" in chart);
  els.downloadWords.disabled = !ok;
  els.wordChart.hidden = !ok;
  if (!ok) {
    els.wordNote.textContent = chart.problem;
    return;
  }
  const note = oddTurnNote(chart);
  els.wordNote.textContent = `${chart.columns} columns, ${chart.count} count, ${chart.rows} rows.${note ? ` ${note}` : ""}`;
  els.wordChart.textContent = chart.lines.map(formatRow).join("\n");
}

/** The trim button and the empty-spots banner. */
function renderCanvasTools(): void {
  const { design } = state;
  const painted = paintedBounds(design);
  const b = design.bounds;
  const tight = b && painted && b.c0 === painted.c0 && b.c1 === painted.c1 && b.h0 === painted.h0 && b.h1 === painted.h1;
  els.trim.disabled = !painted || !!tight;
  els.trim.title = !painted ? "Paint some beads first" : tight ? "The canvas already ends at the beads" : "Cut the canvas down to the painted beads";

  // Hidden while lifted beads are being placed: the spots they left are about to be filled or put back.
  const n = state.floating?.lifted ? 0 : state.empty.length;
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

/** Whether a `beads:` entry is one of my beads in this piece's size. */
function isMine(entry: unknown): boolean {
  return isOwned(myBeads, state.resolved.size, entry);
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
  const parts: string[] = [design.bounds ? `Trimmed canvas, ${pieceCount(boundsSize(design.bounds).columns)} count` : "Unlimited canvas"];
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
        bounds: state.resizing?.bounds ?? design.bounds,
        selection: state.floating ? undefined : state.selection,
        handles: !state.floating && state.tool !== "hand",
        painted: design.bounds ? undefined : paintedBounds(design),
        origin: origin(),
        hover: state.tool === "hand" || state.pan ? undefined : state.hover,
        highlight: state.showEmpty ? state.empty : undefined,
        backdrop: backdropScene(),
        floating: state.floating && {
          cells: state.floating.drawn,
          dc: state.floating.dc,
          dh: state.floating.dh,
          bounds: blockBounds(state.floating.block),
        },
      },
      devicePixelRatio,
    );
  });
}

/** The picture to draw behind the beads: the one being placed, or the one already there. */
function backdropScene() {
  const f = state.floating;
  const shown = state.backdrop?.shown ?? true;
  const opacity = state.backdrop?.opacity ?? Number(els.backdropOpacity.value) / 100;
  if (f?.block.picture) {
    const r = blockRect(f.block);
    const dx = f.dc * box().w;
    const dy = (f.dh * box().d) / 2;
    return { image: f.block.picture, rect: { x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy }, opacity: Math.max(opacity, 0.5) };
  }
  return state.backdrop && shown ? state.backdrop : undefined;
}

function setView(view: View): void {
  state.view = view;
  els.turnView.setAttribute("aria-pressed", String(!!view.turned));
  scheduleSaveView();
  draw();
}

function fit(): void {
  const area = state.design.bounds ?? paintedBounds(state.design);
  const { width, height } = state.size;
  const turned = !!state.view.turned;
  setView(area ? fitView(boundsRect(area, box()), width, height, box(), 40, turned) : defaultView(width, height, box(), turned));
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

function updateCursor(edge?: Edge): void {
  const panning = state.tool === "hand" || state.spaceDown;
  let cursor = "";
  if (state.pan) cursor = "grabbing";
  else if (panning) cursor = "grab";
  else if (state.floating) cursor = "move";
  else if (edge ?? state.resizing?.edge) {
    const across = (edge ?? state.resizing!.edge).startsWith("c");
    cursor = across !== !!state.view.turned ? "ew-resize" : "ns-resize";
  } else if (state.tool === "pick") cursor = "pick";
  els.wrap.dataset.cursor = cursor;
}

/** The resize handle of a trimmed canvas under a screen point, if any. */
function handleAt(p: { x: number; y: number }): Edge | undefined {
  const b = state.design.bounds;
  if (!b || state.floating || state.tool === "hand") return undefined;
  const r = boundsRect(b, box());
  const mx = (r.x0 + r.x1) / 2;
  const my = (r.y0 + r.y1) / 2;
  const handles: [Edge, number, number][] = [
    ["c0", r.x0, my],
    ["c1", r.x1, my],
    ["h0", mx, r.y0],
    ["h1", mx, r.y1],
  ];
  for (const [edge, x, y] of handles) {
    const s = toScreen(state.view, x, y);
    if (Math.abs(s.x - p.x) <= 9 && Math.abs(s.y - p.y) <= 9) return edge;
  }
  return undefined;
}

/** The bounds a trimmed canvas gets with one edge moved to the cell under a point. */
function resizedBounds(b: Bounds, edge: Edge, at: { x: number; y: number }): Bounds {
  const { w, d } = box();
  const c = Math.round(at.x / w);
  const h = Math.round((2 * at.y) / d);
  if (edge === "c0") return { ...b, c0: Math.min(c, b.c1) };
  if (edge === "c1") return { ...b, c1: Math.max(c, b.c0) };
  if (edge === "h0") return { ...b, h0: Math.min(h, b.h1) };
  return { ...b, h1: Math.max(h, b.h0) };
}

/** Resizes the canvas, asking first if beads would be deleted. */
function resizeTo(bounds: Bounds): void {
  const lost = cellsOutside(state.design, bounds).length;
  if (lost && !confirm(`Resizing deletes ${lost.toLocaleString()} bead${lost === 1 ? "" : "s"} outside the new edges. Resize anyway?`)) {
    draw();
    return;
  }
  commit(resize(state.design, bounds));
}

function pick(at: { x: number; y: number }): void {
  const cell = cellAt(at.x, at.y, box());
  const key = state.design.cells.get(cellKey(cell.c, cell.h)) ?? closestToBackdrop(cell);
  if (key) selectBead(key);
}

/** On an empty spot over the picture: the design's bead closest to the picture's color there, averaged in linear light as the import does. */
function closestToBackdrop(cell: Cell): string | undefined {
  const b = state.backdrop;
  if (!b?.shown || state.design.beads.size === 0) return undefined;
  const { w, d } = box();
  const { image, rect } = b;
  const sx = image.width / (rect.x1 - rect.x0);
  const sy = image.height / (rect.y1 - rect.y0);
  const x0 = Math.floor((cell.c * w - w / 2 - rect.x0) * sx);
  const x1 = Math.ceil((cell.c * w + w / 2 - rect.x0) * sx);
  const y0 = Math.floor(((cell.h * d) / 2 - d / 2 - rect.y0) * sy);
  const y1 = Math.ceil(((cell.h * d) / 2 + d / 2 - rect.y0) * sy);
  if (x1 <= 0 || y1 <= 0 || x0 >= image.width || y0 >= image.height) return undefined;
  b.pixels ??= image.getContext("2d")!.getImageData(0, 0, image.width, image.height);
  const { data, width } = b.pixels;
  let r = 0;
  let g = 0;
  let bl = 0;
  let alpha = 0;
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
      const p = (y * width + x) * 4;
      const a = data[p + 3]! / 255;
      r += LINEAR[data[p]!]! * a;
      g += LINEAR[data[p + 1]!]! * a;
      bl += LINEAR[data[p + 2]!]! * a;
      alpha += a;
    }
  }
  if (alpha === 0) return undefined;
  const lab = linearToLab(r / alpha, g / alpha, bl / alpha);
  let best: string | undefined;
  let bestDelta = Infinity;
  for (const [key, bead] of state.resolved.beads) {
    const delta = deltaE2000(lab, hexToLab(bead.display.rgb));
    if (delta < bestDelta) [best, bestDelta] = [key, delta];
  }
  if (best) showNotice(`Picked ${esc(best)}, the closest bead in this design to the picture here (ΔE ${bestDelta.toFixed(1)}).`);
  return best;
}

/** Fills the area of one color under a point (§5). On an unlimited canvas it stays inside the painted area. */
function fillAt(at: { x: number; y: number }): void {
  if (!state.design.beads.has(state.paint)) {
    showNotice("Add a bead color first.");
    return;
  }
  const cell = cellAt(at.x, at.y, box());
  const area = state.design.bounds ?? paintedBounds(state.design);
  if (!area || !inBounds(area, cell)) {
    showNotice("Fill works inside the painted area. Outside it the canvas has no edges to stop at.");
    return;
  }
  commit(floodFill(state.design, cell, state.paint));
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
  const edge = event.button === 0 ? handleAt(p) : undefined;
  if (edge && state.design.bounds) {
    state.resizing = { edge, bounds: state.design.bounds };
    return;
  }
  if (event.button === 0 && state.tool === "select" && !event.altKey) {
    const cell = cellAt(at.x, at.y, box());
    if (state.selection && inBounds(state.selection, cell) && cellsIn(state.design, state.selection).length) {
      liftSelection();
      state.floating!.drag = { ...at, dc: state.floating!.dc, dh: state.floating!.dh };
    } else {
      state.selecting = cell;
      state.selection = boundsBetween(cell, cell);
      renderSelectBar();
      draw();
    }
    return;
  }
  if (event.button === 2) startStroke("erase", at);
  else if (event.button === 0 && (event.altKey || state.tool === "pick")) pick(at);
  else if (event.button === 0 && state.tool === "fill") fillAt(at);
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
  if (state.resizing && state.design.bounds) {
    state.resizing.bounds = resizedBounds(state.design.bounds, state.resizing.edge, at);
    renderStatus();
    draw();
    return;
  }
  const drag = state.floating?.drag;
  if (drag) {
    const { w, d } = box();
    const move = snapMove((at.x - drag.x) / w, (2 * (at.y - drag.y)) / d);
    moveFloating(drag.dc + move.dc, drag.dh + move.dh);
    return;
  }
  const cell = cellAt(at.x, at.y, box());
  if (state.selecting) {
    state.selection = boundsBetween(state.selecting, cell);
    renderSelectBar();
  } else if (!state.stroke && event.buttons === 0) {
    updateCursor(handleAt(p));
  }
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
  if (state.resizing) {
    const { bounds } = state.resizing;
    state.resizing = undefined;
    updateCursor();
    const b = state.design.bounds!;
    if (bounds.c0 !== b.c0 || bounds.c1 !== b.c1 || bounds.h0 !== b.h0 || bounds.h1 !== b.h1) resizeTo(bounds);
    else draw();
    return;
  }
  if (state.selecting) {
    state.selecting = undefined;
    renderSelectBar();
    draw();
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
  // While lifted beads are being placed, keep the design from before the lift, so a reload loses nothing.
  const design = state.floating?.lifted?.design ?? state.design;
  const yaml = designToYaml(design);
  let kept = mine.save(design.title, yaml, design.cells.size === 0);
  try {
    localStorage.setItem(STORAGE.draft, yaml);
  } catch {
    kept = false;
  }
  // Storage can be off (private windows) or full. The designer still works, it just won't remember.
  if (!kept && !saveWarned) showNotice("This design can't be kept in the browser. Download it to keep it.");
  if (!kept) saveWarned = true;
}

window.addEventListener("pagehide", saveNow);

let viewTimer: number | undefined;
function scheduleSaveView(): void {
  clearTimeout(viewTimer);
  viewTimer = window.setTimeout(() => {
    try {
      // Kept as where the top-left of the piece shows: reopening the file places it at new coordinates.
      const o = originMm();
      const at = toScreen(state.view, o.x, o.y);
      localStorage.setItem(STORAGE.view, JSON.stringify({ zoom: state.view.zoom, turned: !!state.view.turned, x: at.x, y: at.y }));
    } catch {
      // Not worth a message.
    }
  }, 300);
}

function readView(): View | undefined {
  try {
    const saved = JSON.parse(readStored(STORAGE.view) ?? "null") as { zoom: number; turned: boolean; x: number; y: number } | null;
    if (!saved || ![saved.x, saved.y, saved.zoom].every(Number.isFinite) || saved.zoom <= 0) return undefined;
    const view: View = { zoom: saved.zoom, panX: 0, panY: 0, ...(saved.turned && { turned: true }) };
    const o = originMm();
    const at = toScreen(view, o.x, o.y);
    return { ...view, panX: saved.x - at.x, panY: saved.y - at.y };
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
      ? `Saved “${esc(saved.name)}” to <a href="./beads.html#my-palettes">my palettes</a>. Pick it in Colors from in any design.`
      : "This browser won't keep the palette (storage is off, as in a private window).",
  );
  renderPanel();
});

// My beads changed in another tab.
onMyBeadsChange(() => {
  myBeads = loadMyBeads();
  colorSource = loadColorSource();
  renderPanel();
});

/** The bead sizes for a new design. With only my beads, the sizes I have come first. */
function renderNewBeadOptions(): void {
  const option = (s: { text: string; label: string }) => `<option value="${esc(s.text)}">${esc(s.label)}</option>`;
  const sizes = allBeadSizes(catalog);
  const mine = ownedSizes(myBeads, catalog);
  els.newBead.innerHTML =
    colorSource === "mine" && mine.size
      ? `<optgroup label="Sizes I have">${sizes.filter((s) => mine.has(s.text)).map(option).join("")}</optgroup>` +
        `<optgroup label="Other sizes">${sizes.filter((s) => !mine.has(s.text)).map(option).join("")}</optgroup>`
      : sizes.map(option).join("");
}

els.newButton.addEventListener("click", () => {
  renderNewBeadOptions();
  els.newBead.value = colorSource === "mine" && !ownedSizes(myBeads, catalog).has(state.design.bead) ? (els.newBead.options[0]?.value ?? state.design.bead) : state.design.bead;
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
  const design: FlatDesign = { title, bead: els.newBead.value, beads: new Map([["A", first]]), cells: new Map() };
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

els.downloadYaml.addEventListener("click", () => download(`${fileName()}.flat-peyote.yaml`, designToYaml(state.design), "text/yaml"));

els.downloadChart.addEventListener("click", () => {
  const { size, beads } = state.resolved;
  const svg = renderFlatChartSvg({ design: state.design, beads, box: size.box, shape: size.shape, sizeLabel: size.label, turned: !!state.view.turned });
  download(`${fileName()}-chart.svg`, svg, "image/svg+xml");
});

els.downloadWords.addEventListener("click", () => {
  const chart = wordChart(state.design);
  if ("problem" in chart) return;
  download(`${fileName()}-rows.txt`, wordChartText(state.design, chart, state.resolved.beads, state.resolved.size.label), "text/plain");
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
  if ((event.metaKey || event.ctrlKey) && (key === "c" || key === "x") && state.selection && !state.floating) {
    event.preventDefault();
    if (key === "c") copySelection();
    else cutSelection();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (state.floating) {
    const f = state.floating;
    // Arrows move the block on screen, so they swap meaning when the view is turned.
    const arrows: Record<string, [number, number]> = state.view.turned
      ? { arrowleft: [0, 2], arrowright: [0, -2], arrowup: [-1, 1], arrowdown: [1, 1] }
      : { arrowleft: [-1, 1], arrowright: [1, 1], arrowup: [0, -2], arrowdown: [0, 2] };
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
  if (state.selection && (key === "delete" || key === "backspace")) {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (state.selection && key === "escape") {
    deselect();
    return;
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
  else if (key === "m") setTool("select");
  else if (key === "g") setTool("fill");
  else if (key === "r") turn();
  else if (key === "p") toggleBackdrop();
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
    mine: ownedColorsFor(myBeads, state.resolved.size),
    source: colorSource,
    palette: paletteForImport(colorSource, state.resolved.size, myBeads, catalog),
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

/** The whole columns × rows of a block at no offset, in mm. Its picture covers exactly this. */
function blockRect(block: ImportBlock): Rect {
  return boundsRect({ c0: 0, c1: block.columns - 1, h0: 0, h1: block.rows - 1 }, box());
}

/** The rectangle a block's cells cover, for its outline. */
function blockBounds(block: ImportBlock): Bounds {
  const cs = block.cells.map((x) => x.c);
  const hs = block.cells.map((x) => x.h);
  return cs.length
    ? { c0: Math.min(...cs), c1: Math.max(...cs), h0: Math.min(...hs), h1: Math.max(...hs) }
    : { c0: 0, c1: block.columns - 1, h0: 0, h1: block.rows - 1 };
}

/**
 * Starts placing a block, to be dragged into place. It starts in the middle
 * of the view, or at `at` (a valid move) when given.
 */
function startPlacing(block: ImportBlock, what = `${block.columns} × ${block.rows} picture`, at?: { dc: number; dh: number }, lifted?: NonNullable<typeof state.floating>["lifted"]): void {
  let move = at;
  if (!move) {
    const center = toMm(state.view, state.size.width / 2, state.size.height / 2);
    const cell = cellAt(center.x, center.y, box());
    const b = blockBounds(block);
    move = snapMove(cell.c - (b.c0 + b.c1) / 2, cell.h - (b.h0 + b.h1) / 2);
  }
  const drawn = block.cells.map((cell) => ({ c: cell.c, h: cell.h, rgb: cell.color.rgb }));
  state.floating = { block, drawn, dc: move.dc, dh: move.dh, what, lifted };
  state.stroke = undefined;
  els.placeBar.hidden = false;
  els.placeText.textContent = `Drag the ${what} into place, or move it with the arrow keys. Moving one column also moves it half a bead.`;
  renderSelectBar();
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
  const lifted = state.floating?.lifted;
  state.floating = undefined;
  els.placeBar.hidden = true;
  if (lifted) setDesign(lifted.design);
  renderSelectBar();
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
    let key = color.key && sameEntry(beads.get(color.key), color.entry) ? color.key : undefined;
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
  const lifted = f.lifted;
  if (f.block.picture) {
    const rect = backdropScene()!.rect;
    setBackdrop({ image: f.block.picture, rect, opacity: Number(els.backdropOpacity.value) / 100, shown: true });
  }
  state.floating = undefined;
  els.placeBar.hidden = true;
  updateCursor();
  if (f.block.cells.length === 0) {
    // Just the picture: the design doesn't change.
    renderSelectBar();
    draw();
  } else if (lifted) {
    // A moved selection: one undo step from before the cells were lifted, and the selection moves with them.
    state.past.push(lifted.design);
    state.future = [];
    const dc = f.dc - lifted.dc;
    const dh = f.dh - lifted.dh;
    const s0 = lifted.selection;
    state.selection = { c0: s0.c0 + dc, c1: s0.c1 + dc, h0: s0.h0 + dh, h1: s0.h1 + dh };
    setDesign({ ...design, beads, cells });
  } else {
    commit({ ...design, beads, cells });
  }
  if (outside) showNotice(`${outside.toLocaleString()} bead${outside === 1 ? "" : "s"} fell outside the canvas and weren't placed.`);
}

els.placeDrop.addEventListener("click", dropFloating);

// ---- The picture behind the beads ----

function setBackdrop(backdrop: Backdrop | undefined, save = true): void {
  state.backdrop = backdrop;
  els.backdropTools.hidden = !backdrop;
  if (backdrop) {
    els.backdropShow.setAttribute("aria-pressed", String(backdrop.shown));
    els.backdropOpacity.value = String(Math.round(backdrop.opacity * 100));
    els.backdropOpacity.disabled = !backdrop.shown;
  }
  if (save) saveBackdropSoon(true);
  draw();
}

let backdropTimer: number | undefined;
/** The picture as stored, so changing a setting doesn't encode it again. */
let backdropBlob: Blob | undefined;
/** Stores the picture's settings, and the picture itself when it is new (`withImage`). */
function saveBackdropSoon(withImage = false): void {
  if (withImage) backdropBlob = undefined;
  clearTimeout(backdropTimer);
  backdropTimer = window.setTimeout(async () => {
    const b = state.backdrop;
    if (!b) {
      await clearBackdrop();
      return;
    }
    backdropBlob ??= await b.image.convertToBlob();
    await saveBackdrop({ image: backdropBlob, rect: b.rect, opacity: b.opacity, shown: b.shown });
  }, 300);
}

function toggleBackdrop(): void {
  const b = state.backdrop;
  if (!b) return;
  b.shown = !b.shown;
  els.backdropShow.setAttribute("aria-pressed", String(b.shown));
  els.backdropOpacity.disabled = !b.shown;
  saveBackdropSoon();
  draw();
}

els.backdropShow.addEventListener("click", toggleBackdrop);
els.backdropOpacity.addEventListener("input", () => {
  if (!state.backdrop) return;
  state.backdrop.opacity = Number(els.backdropOpacity.value) / 100;
  saveBackdropSoon();
  draw();
});
els.backdropRemove.addEventListener("click", () => setBackdrop(undefined));
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
  if (event.target instanceof Element && event.target.closest("input, textarea")) return;
  const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (file) {
    event.preventDefault();
    void importFile(file, "pasted picture");
    return;
  }
  if (state.clipboard && !state.floating) {
    event.preventDefault();
    pasteClipboard();
  }
});

// ---- Selections ----

function renderSelectBar(): void {
  const sel = state.selection;
  els.selectBar.hidden = !sel || !!state.floating || !!state.selecting;
  if (!sel || state.floating || state.selecting) return;
  const n = cellsIn(state.design, sel).length;
  const { columns, rows } = boundsSize(sel);
  els.selectText.textContent = `${columns} × ${rows} selected, ${n.toLocaleString()} bead${n === 1 ? "" : "s"}. Drag inside it to move it.`;
}

function deselect(): void {
  state.selection = undefined;
  renderSelectBar();
  draw();
}

/** The selected cells with their colors, ready to paste anywhere. */
function clipboardOf(sel: Bounds): Clipboard {
  const { cells } = liftBlock(state.design, sel);
  const colors = new Map<string, ImportColor>();
  for (const { key } of cells) {
    if (colors.has(key)) continue;
    const bead = state.resolved.beads.get(key);
    colors.set(key, { id: `copy:${key}:${JSON.stringify(state.design.beads.get(key))}`, key, entry: state.design.beads.get(key), name: beadName(bead), rgb: bead?.display.rgb ?? "#999999" });
  }
  return { cells, colors };
}

function blockOf(clip: Clipboard): ImportBlock {
  const cells = clip.cells.map(({ c, h, key }) => ({ c, h, color: clip.colors.get(key)! }));
  const b = cells.length ? { columns: Math.max(...cells.map((x) => x.c)) + 1, rows: Math.max(...cells.map((x) => x.h)) + 1 } : { columns: 1, rows: 1 };
  return { ...b, cells };
}

function copySelection(): void {
  if (!state.selection) return;
  state.clipboard = clipboardOf(state.selection);
  const n = state.clipboard.cells.length;
  showNotice(`Copied ${n.toLocaleString()} bead${n === 1 ? "" : "s"}. Paste with ⌘V.`);
}

function cutSelection(): void {
  if (!state.selection) return;
  state.clipboard = clipboardOf(state.selection);
  commit(eraseCells(state.design, cellsIn(state.design, state.selection)));
}

function deleteSelection(): void {
  if (!state.selection) return;
  commit(eraseCells(state.design, cellsIn(state.design, state.selection)));
}

function pasteClipboard(): void {
  const clip = state.clipboard;
  if (!clip?.cells.length) return;
  state.selection = undefined;
  startPlacing(blockOf(clip), "pasted beads");
}

/** Lifts the selected beads off the canvas to be dragged somewhere else. Cancel puts them back. */
function liftSelection(): void {
  const sel = state.selection!;
  const before = state.design;
  const clip = clipboardOf(sel);
  const { dc, dh } = liftBlock(before, sel);
  startPlacing(blockOf(clip), "selection", { dc, dh }, { design: before, selection: sel, dc, dh });
  setDesign(eraseCells(before, cellsIn(before, sel)));
}

els.selectBar.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]")?.dataset.action;
  const sel = state.selection;
  if (!action || !sel) return;
  if (action === "copy") copySelection();
  else if (action === "cut") cutSelection();
  else if (action === "delete") deleteSelection();
  else if (action === "mirror-columns") commit(mirrorCells(state.design, sel, "columns"));
  else if (action === "mirror-rows") commit(mirrorCells(state.design, sel, "rows"));
  else if (action === "deselect") deselect();
});

// ---- Canvas size and turning ----

function renderCanvasSize(): void {
  const b = state.design.bounds;
  els.canvasUnlimited.hidden = !!b;
  els.canvasTrimmed.hidden = !b;
  if (!b) return;
  const { columns, rows } = boundsSize(b);
  if (document.activeElement !== els.canvasColumns) els.canvasColumns.value = String(columns);
  if (document.activeElement !== els.canvasRows) els.canvasRows.value = String(rows);
}

els.canvasApply.addEventListener("click", () => {
  const b = state.design.bounds;
  if (!b) return;
  const columns = Math.max(1, Math.round(Number(els.canvasColumns.value)) || 1);
  const rows = Math.max(1, Math.round(Number(els.canvasRows.value)) || 1);
  // Grows and shrinks from the bottom right, so the top-left stays put.
  resizeTo({ ...b, c1: b.c0 + columns - 1, h1: b.h0 + rows - 1 });
});

els.makeUnlimited.addEventListener("click", () => {
  if (state.design.bounds) commit(makeUnlimited(state.design));
});

function turn(): void {
  setView(turnView(state.view, state.size.width, state.size.height));
}

els.turnView.addEventListener("click", turn);

// ---- Helpers ----

let noticeTimer: number | undefined;
function showNotice(html: string, keep = false): void {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  if (!keep) noticeTimer = window.setTimeout(() => (els.notice.hidden = true), 6000);
}

function sameEntry(a: unknown, b: unknown): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
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
      const example = findExample("flat", asked.example);
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

void loadBackdrop().then(async (stored) => {
  if (!stored || state.backdrop) return;
  try {
    const bitmap = await createImageBitmap(stored.image);
    const image = new OffscreenCanvas(bitmap.width, bitmap.height);
    image.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    backdropBlob = stored.image;
    setBackdrop({ image, rect: stored.rect, opacity: stored.opacity, shown: stored.shown }, false);
  } catch {
    // A picture that no longer reads: forget it.
    await clearBackdrop();
  }
});
