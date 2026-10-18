// The import dialog: a picture in, a block of beads out, with a live preview.
// The conversion runs in src/flat/import.worker.ts. See
// docs/flat-peyote-spec.md §6.

import type { ResolvedBead } from "../src/catalog/catalog.js";
import { catalogColors, type FlatBeadSize } from "../src/flat/beads.js";
import { hexToLab } from "../src/flat/color.js";
import type { FlatDesign } from "../src/flat/grid.js";
import { importCells, importRows } from "../src/flat/import.js";
import type { ImportRequest, ImportResponse } from "../src/flat/import.worker.js";
import { boundsRect, fitView } from "../src/flat/view.js";
import { drawScene } from "./flat-canvas.js";

export interface ImportContext {
  size: FlatBeadSize;
  design: FlatDesign;
  beads: ReadonlyMap<string, ResolvedBead>;
  /** A bead's short name, without the size every bead in the piece shares. */
  nameOf(key: string): string;
}

/** A color the import may use: a catalog color, or a bead already in the design. */
export interface ImportColor {
  id: string;
  name: string;
  rgb: string;
  /** The `beads:` entry for a new bead. */
  entry: unknown;
  /** Set when the design already has this bead. */
  key?: string;
}

/** The result, placed with column 0 high at (0, 0). */
export interface ImportBlock {
  columns: number;
  rows: number;
  cells: { c: number; h: number; color: ImportColor }[];
}

/** Pixels per bead side the picture is drawn at before sampling (§6.4). */
const SAMPLES_PER_BEAD = 8;
const MAX_SIDE = 4096;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupImport(getContext: () => ImportContext, onPlace: (block: ImportBlock) => void): { open(file: Blob, name?: string): void } {
  const els = {
    dialog: $<HTMLDialogElement>("import-dialog"),
    form: $<HTMLFormElement>("import-form"),
    source: $<HTMLImageElement>("import-source"),
    sourceCaption: $("import-source-caption"),
    preview: $<HTMLCanvasElement>("import-preview"),
    previewCaption: $("import-preview-caption"),
    width: $<HTMLInputElement>("import-width"),
    height: $<HTMLInputElement>("import-height"),
    link: $<HTMLInputElement>("import-link"),
    colorsFrom: $<HTMLSelectElement>("import-source-colors"),
    max: $<HTMLInputElement>("import-max"),
    alpha: $<HTMLInputElement>("import-alpha"),
    summary: $("import-summary"),
    colors: $<HTMLUListElement>("import-colors"),
    allow: $<HTMLButtonElement>("import-allow"),
    cancel: $<HTMLButtonElement>("import-cancel"),
    place: $<HTMLButtonElement>("import-place"),
  };

  const worker = new Worker(new URL("../src/flat/import.worker.ts", import.meta.url), { type: "module" });

  const state: {
    bitmap?: ImageBitmap;
    imageId: number;
    sourceUrl?: string;
    context?: ImportContext;
    palette: ImportColor[];
    excluded: Set<string>;
    requestId: number;
    /** The sample key the worker has pixels for. */
    workerKey?: string;
    result?: { columns: number; rows: number; assign: Int32Array; used: { index: number; count: number }[]; meanDeltaE: number; palette: ImportColor[] };
    timer?: number;
  } = { imageId: 0, palette: [], excluded: new Set(), requestId: 0 };

  function columns(): number {
    return clampInt(els.width.value, 4, 300, 60);
  }

  function rows(): number {
    const { bitmap, context } = state;
    if (!bitmap || !context) return 1;
    if (els.link.checked) return importRows(bitmap.width, bitmap.height, columns(), context.size.box);
    return clampInt(els.height.value, 1, 600, 1);
  }

  /** The colors the current settings allow, before the ones the designer ruled out. */
  function allowedColors(context: ImportContext): ImportColor[] {
    const from = els.colorsFrom.value;
    const out = new Map<string, ImportColor>();
    if (from === "design" || from === "both") {
      for (const [key, entry] of context.design.beads) {
        const bead = context.beads.get(key);
        const id = typeof entry === "string" ? entry : `design:${key}`;
        out.set(id, { id, key, entry, name: `${key} · ${context.nameOf(key)}`, rgb: bead?.display.rgb ?? "#999999" });
      }
    }
    if (from === "catalog" || from === "both") {
      for (const c of catalogColors(context.size)) {
        if (!out.has(c.entry)) out.set(c.entry, { id: c.entry, entry: c.entry, name: `${c.entry.replace(/^\S+ /, "")} · ${c.name}`, rgb: c.rgb });
      }
    }
    return [...out.values()];
  }

  function schedule(delay = 120): void {
    clearTimeout(state.timer);
    state.timer = window.setTimeout(run, delay);
  }

  function run(): void {
    const { bitmap, context } = state;
    if (!bitmap || !context) return;
    if (els.link.checked) els.height.value = String(rows());
    const palette = allowedColors(context).filter((c) => !state.excluded.has(c.id));
    state.palette = palette;
    els.allow.hidden = state.excluded.size === 0;
    if (palette.length === 0) {
      state.result = undefined;
      els.summary.textContent =
        els.colorsFrom.value === "catalog" ? "This bead has no catalog colors yet. Choose “Only colors in this design”." : "No colors left to use.";
      els.summary.classList.add("bad");
      els.place.disabled = true;
      els.colors.innerHTML = "";
      drawPreview();
      return;
    }
    els.summary.classList.remove("bad");
    els.summary.textContent = "Working…";
    send(false);
  }

  function send(withPixels: boolean): void {
    const { bitmap, context } = state;
    if (!bitmap || !context) return;
    const cols = columns();
    const rowCount = rows();
    const alphaThreshold = clampInt(els.alpha.value, 1, 100, 50) / 100;
    const sampleKey = `${state.imageId}:${cols}:${rowCount}:${alphaThreshold}:${context.size.box.w}:${context.size.box.d}`;
    const request: ImportRequest = {
      id: ++state.requestId,
      sampleKey,
      columns: cols,
      rows: rowCount,
      box: context.size.box,
      alphaThreshold,
      palette: state.palette.map((c) => hexToLab(c.rgb)),
      maxColors: clampInt(els.max.value, 2, 62, 12),
    };
    if (withPixels || state.workerKey !== sampleKey) {
      request.pixels = pixelsFor(bitmap, cols);
      state.workerKey = sampleKey;
    }
    pending.set(request.id, state.palette);
    worker.postMessage(request, request.pixels ? [request.pixels.data.buffer] : []);
  }

  const pending = new Map<number, ImportColor[]>();
  worker.addEventListener("message", (event: MessageEvent<ImportResponse>) => {
    const res = event.data;
    const palette = pending.get(res.id);
    pending.delete(res.id);
    if (res.id !== state.requestId || !palette) return; // a newer request is on its way
    if (res.needPixels) {
      state.workerKey = undefined;
      send(true);
      return;
    }
    state.result = { columns: res.columns, rows: res.rows, assign: res.assign!, used: res.used!, meanDeltaE: res.meanDeltaE!, palette };
    renderResult(res.ms ?? 0);
  });

  worker.addEventListener("error", (event) => {
    els.summary.textContent = `The conversion failed: ${event.message}`;
    els.summary.classList.add("bad");
  });

  function renderResult(ms: number): void {
    const result = state.result!;
    const beads = result.used.reduce((sum, u) => sum + u.count, 0);
    els.summary.textContent = beads
      ? `${result.columns} × ${result.rows} · ${beads.toLocaleString()} beads · ${result.used.length} color${result.used.length === 1 ? "" : "s"} · average difference ΔE ${result.meanDeltaE.toFixed(1)} · ${Math.round(ms)} ms`
      : "The picture is all transparent at this threshold.";
    els.place.disabled = beads === 0;
    els.colors.innerHTML = result.used
      .map(({ index, count }) => {
        const color = result.palette[index]!;
        return `<li title="${esc(color.name)}"><span class="swatch" style="background:${esc(color.rgb)}"></span>${esc(shortName(color.name))} <span class="muted">${count.toLocaleString()}</span>
          <button type="button" data-id="${esc(color.id)}" aria-label="Don't use ${esc(color.name)}" title="Don't use this color">✕</button></li>`;
      })
      .join("");
    els.previewCaption.textContent = `Beads, ${state.context!.size.label}`;
    drawPreview();
  }

  function drawPreview(): void {
    const canvas = els.preview;
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d")!;
    const result = state.result;
    const context = state.context;
    if (!result || !context) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const box = context.size.box;
    const bounds = { c0: 0, c1: result.columns - 1, h0: 0, h1: result.rows - 1 };
    const cells = new Map<string, string>();
    importCells(result.columns, result.rows).forEach(({ c, h }, i) => {
      const p = result.assign[i]!;
      if (p >= 0) cells.set(`${c},${h}`, String(p));
    });
    drawScene(
      ctx,
      {
        view: fitView(boundsRect(bounds, box), rect.width, rect.height, box, 8),
        width: rect.width,
        height: rect.height,
        box,
        shape: context.size.shape,
        cells,
        colors: new Map(result.palette.map((c, i) => [String(i), c.rgb])),
        origin: { c: 0, h: 0 },
        plain: true,
      },
      dpr,
    );
  }

  els.width.addEventListener("input", () => schedule());
  els.height.addEventListener("input", () => {
    els.link.checked = false;
    schedule();
  });
  els.link.addEventListener("change", () => schedule(0));
  els.colorsFrom.addEventListener("change", () => schedule(0));
  els.max.addEventListener("input", () => schedule());
  els.alpha.addEventListener("input", () => schedule());
  els.colors.addEventListener("click", (event) => {
    const id = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]")?.dataset.id;
    if (!id) return;
    state.excluded.add(id);
    schedule(0);
  });
  els.allow.addEventListener("click", () => {
    state.excluded.clear();
    schedule(0);
  });
  els.cancel.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("close", () => {
    clearTimeout(state.timer);
    state.requestId++;
  });

  els.form.addEventListener("submit", () => {
    const result = state.result;
    if (!result) return;
    const cells: ImportBlock["cells"] = [];
    importCells(result.columns, result.rows).forEach(({ c, h }, i) => {
      const p = result.assign[i]!;
      if (p >= 0) cells.push({ c, h, color: result.palette[p]! });
    });
    onPlace({ columns: result.columns, rows: result.rows, cells });
  });

  return {
    async open(file: Blob, name = "picture") {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        throw new Error(`couldn't read ${name} as a picture (PNG, JPEG, WebP or GIF)`);
      }
      state.bitmap?.close();
      state.bitmap = bitmap;
      state.imageId++;
      state.excluded.clear();
      state.result = undefined;
      state.context = getContext();
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      state.sourceUrl = URL.createObjectURL(file);
      els.source.src = state.sourceUrl;
      els.sourceCaption.textContent = `${name} · ${bitmap.width} × ${bitmap.height} px`;
      if (catalogColors(state.context.size).length === 0) els.colorsFrom.value = "design";
      els.place.disabled = true;
      els.dialog.showModal();
      run();
    },
  };
}

/** The picture drawn at SAMPLES_PER_BEAD pixels per bead across, keeping its shape. */
function pixelsFor(bitmap: ImageBitmap, columns: number): { width: number; height: number; data: Uint8ClampedArray } {
  let width = Math.min(MAX_SIDE, columns * SAMPLES_PER_BEAD);
  let height = Math.round((width * bitmap.height) / bitmap.width);
  if (height > MAX_SIDE) {
    width = Math.max(1, Math.round((width * MAX_SIDE) / height));
    height = MAX_SIDE;
  }
  height = Math.max(1, height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  return { width, height, data };
}

function shortName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value.trim() !== "" ? Math.min(max, Math.max(min, n)) : fallback;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
