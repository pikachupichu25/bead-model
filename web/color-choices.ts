// "Colors from" and the colors to paint with, shared by the Flat and Nora
// designers: both offer colors in one bead size, from every catalog color, My
// beads, or a palette. A color that isn't one of the design's beads yet is only
// picked; it joins the beads when a stroke or fill uses it.

import type { Catalog } from "../src/catalog/catalog.js";
import { type ColorSource, offeredColors, paletteOf } from "../src/collection/color-source.js";
import type { PaletteMatch } from "../src/collection/palettes.js";
import { type MyBeads, ownedColorsFor } from "../src/collection/my-beads.js";
import type { FlatBeadSize } from "../src/flat/beads.js";
import { findMyPalette, newPaletteId, paletteFromEntries, putMyPalette } from "../src/collection/my-palettes.js";
import { allPalettes, loadMyPalettes, saveMyPalettes } from "./palettes-store.js";
import { sourceButtonHtml } from "./palette-picker.js";

export interface ColorChoiceElements {
  /** The "Colors from" button, which opens the palette menu. */
  colorSource: HTMLButtonElement;
  /** The rows of colors to paint with. */
  addColors: HTMLElement;
  /** Finds a color in the rows, when there are many. */
  addFilter: HTMLInputElement;
  usePalette: HTMLButtonElement;
  /** The own color picker and its button. */
  addOwn: HTMLElement;
  /** The link to the My beads page, next to the source. */
  count: HTMLAnchorElement;
}

/** A color to paint with: its `beads:` entry and how it looks. */
export interface PaintColor {
  entry: unknown;
  rgb: string;
  name: string;
}

/** What's being painted with: a bead of the design (`paint`), or a color only picked so far, not yet in the beads. */
export interface PaintState {
  beads: ReadonlyMap<string, unknown>;
  paint: string;
  picked?: PaintColor;
}

/** Above this many colors, the rows get a box to find one. */
const FILTER_FROM = 24;

/**
 * Draws "Colors from" and the rows of colors under the beads. Gives the color
 * behind each swatch, by its data-color.
 */
export function renderColorChoices(
  els: ColorChoiceElements,
  { source, size, myBeads, catalog, ...paint }: PaintState & { source: ColorSource; size: FlatBeadSize; myBeads: MyBeads; catalog: Catalog },
): PaintColor[] {
  const palettes = allPalettes();
  const offered = offeredColors(source, size, { myBeads, palettes, catalog });
  const palette = paletteOf(source, palettes);
  const keyOf = beadKeys(paint.beads);
  const query = els.addFilter.value.trim().toLowerCase();
  const shown = query ? offered.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(query)) : offered;
  els.addFilter.hidden = offered.length <= FILTER_FROM;
  const none = source === "mine" ? "None of my beads come in this size." : palette ? `${palette.name} has no colors in this size.` : "The catalog has no colors for this bead yet. Add your own below.";
  els.addColors.innerHTML =
    (paint.picked && !keyOf.has(JSON.stringify(paint.picked.entry))
      ? `<p class="muted paint-note">Painting with <b>${esc(paint.picked.name)}</b>. It joins the beads once you paint or fill with it.</p>`
      : "") +
    (shown.length
      ? `<div class="paint-colors" role="group" aria-label="Colors to paint with">${colorButtons(shown, offered, paint, Boolean(palette))}</div>`
      : `<p class="muted paint-note">${esc(query ? `No color matches “${els.addFilter.value.trim()}”.` : none)}</p>`);
  const unused = offered.filter((c) => !keyOf.has(JSON.stringify(c.entry))).length;
  els.usePalette.hidden = !palette || unused < 2;
  els.usePalette.textContent = palette ? `+ Add all ${unused} ${palette.name} colors to the beads` : "";
  // Only my beads: no new colors of my own here, they're added on the My beads page.
  els.addOwn.hidden = source === "mine";
  els.colorSource.innerHTML = sourceButtonHtml(source, catalog);
  const mine = ownedColorsFor(myBeads, size).length;
  els.count.textContent = palette
    ? `${offered.length} in this size${myBeads.beads.length ? ` · ${offered.filter((c) => c.mine).length} mine` : ""}`
    : mine
      ? `${mine} in this size`
      : myBeads.beads.length
        ? "none in this size: add some"
        : "add your beads";
  return offered.map(paintColor);
}

/**
 * The palette bar above the canvas: the picked palette's colors in this size,
 * to click and paint with. Hidden unless the source is a palette. Gives the
 * color behind each swatch, by its data-color.
 */
export function renderPaletteBar(
  bar: HTMLElement,
  { source, size, myBeads, catalog, ...paint }: PaintState & { source: ColorSource; size: FlatBeadSize; myBeads: MyBeads; catalog: Catalog },
): PaintColor[] {
  const palettes = allPalettes();
  const palette = paletteOf(source, palettes);
  bar.hidden = !palette;
  if (!palette) {
    bar.innerHTML = "";
    return [];
  }
  const colors = offeredColors(source, size, { myBeads, palettes, catalog });
  bar.innerHTML =
    `<span class="palette-bar-name" title="${esc(palette.name)}">${esc(palette.name)}</span>` +
    `<span class="paint-colors" role="group" aria-label="Paint with a color from ${esc(palette.name)}">${colorButtons(colors, colors, paint, true)}</span>` +
    `<span class="muted palette-bar-help">Click a color to paint or fill with it</span>`;
  return colors.map(paintColor);
}

/** Which color a click picked: a bead of the design to paint with, or a color to paint with that isn't one yet. */
export function pickPaint(color: PaintColor, beads: ReadonlyMap<string, unknown>): { key: string } | { picked: PaintColor } {
  const key = beadKeys(beads).get(JSON.stringify(color.entry));
  return key ? { key } : { picked: color };
}

/**
 * The design with the color being painted with, and its key: the picked color
 * gets a new bead key here, so a stroke or fill can add it to the beads as it
 * uses it. Undefined when nothing can be painted with (a design has at most 62 beads).
 */
export function paintBead<D extends { beads: Map<string, unknown> }>(design: D, paint: PaintState, nextKey: (keys: Iterable<string>) => string | undefined): { design: D; key: string } | undefined {
  if (paint.picked) {
    const known = beadKeys(design.beads).get(JSON.stringify(paint.picked.entry));
    if (known) return { design, key: known };
    const key = nextKey(design.beads.keys());
    return key ? { design: { ...design, beads: new Map([...design.beads, [key, paint.picked.entry]]) }, key } : undefined;
  }
  return design.beads.has(paint.paint) ? { design, key: paint.paint } : undefined;
}

/** Swatches to paint with. `index` lists every color in data-color order; a color already in the design shows its key. */
function colorButtons(colors: (PaletteMatch & { mine: boolean })[], index: (PaletteMatch & { mine: boolean })[], paint: PaintState, fromPalette: boolean): string {
  const keyOf = beadKeys(paint.beads);
  const picked = paint.picked && JSON.stringify(paint.picked.entry);
  return colors
    .map((c) => {
      const entry = JSON.stringify(c.entry);
      const key = keyOf.get(entry);
      const on = picked ? entry === picked : key !== undefined && key === paint.paint;
      const title = `${colorLabel(c, fromPalette)}${key ? ` · bead ${key}` : ""}`;
      return `<button type="button" class="paint-color" data-color="${index.indexOf(c)}" aria-pressed="${on}" title="${esc(title)}" aria-label="${esc(title)}">
        <span class="swatch big" style="background:${esc(c.rgb)}"></span>${key ? `<span class="paint-color-key">${esc(key)}</span>` : ""}
      </button>`;
    })
    .join("");
}

function paintColor(c: PaletteMatch): PaintColor {
  return { entry: c.entry, rgb: c.rgb, name: c.code === "own" ? c.name : `${c.code} ${c.name}` };
}

/** The key of each `beads:` entry in a design, by the entry as JSON. */
export function beadKeys(beads: ReadonlyMap<string, unknown>): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [key, entry] of beads) if (!keys.has(JSON.stringify(entry))) keys.set(JSON.stringify(entry), key);
  return keys;
}

/** Beads not in My beads are marked with only my beads on, or with a palette once there are beads to compare with. */
export function markNotMine(source: ColorSource, myBeads: MyBeads): boolean {
  return source === "mine" || (source !== "all" && myBeads.beads.length > 0);
}

/** The palette's colors in this size, for the picture import. Undefined unless the source is a palette. */
export function paletteForImport(source: ColorSource, size: FlatBeadSize, myBeads: MyBeads, catalog: Catalog) {
  const palettes = allPalettes();
  const palette = paletteOf(source, palettes);
  return palette && { name: palette.name, colors: offeredColors(source, size, { myBeads, palettes, catalog }) };
}

/**
 * "Save these colors as a palette…": asks for a name, then keeps the design's
 * beads as one of my palettes. Gives its name, or undefined when cancelled or there was nothing to keep.
 */
export async function saveColorsAsPalette(entries: unknown[], suggested: string): Promise<{ name: string; saved: boolean } | undefined> {
  const name = await askName(suggested);
  if (name === undefined) return undefined;
  const list = loadMyPalettes();
  let id = newPaletteId();
  while (findMyPalette(list, id)) id = newPaletteId();
  const palette = paletteFromEntries(name, entries, id);
  if (!palette) return undefined;
  return { name: palette.name, saved: saveMyPalettes(putMyPalette(list, palette)) };
}

/** A small dialog asking for a palette's name. Undefined when cancelled. */
function askName(suggested: string): Promise<string | undefined> {
  const dialog = document.createElement("dialog");
  dialog.className = "new-dialog";
  dialog.innerHTML = `<form method="dialog">
    <h2>Save as a palette</h2>
    <label class="ed-field"><span>Name</span><input type="text" name="name" maxlength="80" required /></label>
    <p class="muted ed-help">The design's colors are kept as one of <a href="./profile.html#palettes">my palettes</a>, to pick in <b>Colors from</b> in any design. Only you see it unless you make it public.</p>
    <div class="dialog-actions"><span class="spacer"></span><button type="button" class="button" value="cancel">Cancel</button><button type="submit" class="button primary" value="save">Save</button></div>
  </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  input.value = suggested;
  dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!.addEventListener("click", () => dialog.close());
  // Enter in the name field submits without a submitter, so say "save" here rather than through the button's value.
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    dialog.close("save");
  });
  dialog.showModal();
  input.select();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "save" && input.value.trim() ? input.value.trim() : undefined);
      dialog.remove();
    });
  });
}

/** "DB-0726 · opaque cobalt", with what a palette color stands in for and whether it's mine. */
function colorLabel(c: { code: string; name: string; mine: boolean; nearest?: { name: string } }, fromPalette: boolean): string {
  const near = c.nearest && c.nearest.name !== c.name ? ` (for ${c.nearest.name})` : "";
  return `${c.code} · ${c.name}${near}${fromPalette && c.mine ? " · mine" : ""}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
