// The "Colors from" select and the "+ Add a color" list, shared by the Flat
// and Nora designers: both offer colors in one bead size, from every catalog
// color, My beads, or a palette.

import type { Catalog } from "../src/catalog/catalog.js";
import { type ColorSource, offeredColors, paletteOf } from "../src/collection/color-source.js";
import { type MyBeads, ownedColorsFor } from "../src/collection/my-beads.js";
import type { FlatBeadSize } from "../src/flat/beads.js";
import { colorSourceOptions, presetPalettes } from "./presets.js";

export interface ColorChoiceElements {
  colorSource: HTMLSelectElement;
  /** The "+ Add a color" select. */
  addCatalog: HTMLSelectElement;
  usePalette: HTMLButtonElement;
  /** The own color picker and its button. */
  addOwn: HTMLElement;
  /** The link to the My beads page, next to the source. */
  count: HTMLAnchorElement;
}

/** Draws the choices, and gives the `beads:` entries behind the "+ Add a color" options, by option value. */
export function renderColorChoices(
  els: ColorChoiceElements,
  { source, size, used, myBeads, catalog }: { source: ColorSource; size: FlatBeadSize; used: ReadonlySet<string>; myBeads: MyBeads; catalog: Catalog },
): unknown[] {
  const offered = offeredColors(source, size, { myBeads, palettes: presetPalettes, catalog });
  const colors = offered.filter((c) => !used.has(JSON.stringify(c.entry)));
  const palette = paletteOf(source, presetPalettes);
  const none = source === "mine" ? "No more of my beads in this size" : palette ? `No more ${palette.name} colors` : "No more catalog colors for this bead";
  const prompt = source === "mine" ? "+ Add one of my beads…" : palette ? `+ Add a color from ${palette.name}…` : "+ Add a catalog color…";
  els.addCatalog.innerHTML =
    `<option value="">${esc(colors.length ? prompt : none)}</option>` +
    colors.map((c, i) => `<option value="${i}">${esc(colorLabel(c, Boolean(palette)))}</option>`).join("");
  els.addCatalog.disabled = colors.length === 0;
  els.usePalette.hidden = !palette || colors.length < 2;
  els.usePalette.textContent = palette ? `+ Use all ${colors.length} ${palette.name} colors` : "";
  // Only my beads: no new colors of my own here, they're added on the My beads page.
  els.addOwn.hidden = source === "mine";
  els.colorSource.innerHTML = colorSourceOptions(source);
  const mine = ownedColorsFor(myBeads, size).length;
  els.count.textContent = palette
    ? `${offered.length} in this size${myBeads.beads.length ? ` · ${offered.filter((c) => c.mine).length} mine` : ""}`
    : mine
      ? `${mine} in this size`
      : myBeads.beads.length
        ? "none in this size: add some"
        : "add your beads";
  return colors.map((c) => c.entry);
}

/** Beads not in My beads are marked with only my beads on, or with a palette once there are beads to compare with. */
export function markNotMine(source: ColorSource, myBeads: MyBeads): boolean {
  return source === "mine" || (source !== "all" && myBeads.beads.length > 0);
}

/** The palette's colors in this size, for the picture import. Undefined unless the source is a palette. */
export function paletteForImport(source: ColorSource, size: FlatBeadSize, myBeads: MyBeads, catalog: Catalog) {
  const palette = paletteOf(source, presetPalettes);
  return palette && { name: palette.name, colors: offeredColors(source, size, { myBeads, palettes: presetPalettes, catalog }) };
}

/** "DB-0726 · opaque cobalt", with what a palette color stands in for and whether it's mine. */
function colorLabel(c: { code: string; name: string; mine: boolean; nearest?: { name: string } }, fromPalette: boolean): string {
  const near = c.nearest && c.nearest.name !== c.name ? ` (for ${c.nearest.name})` : "";
  return `${c.code} · ${c.name}${near}${fromPalette && c.mine ? " · mine" : ""}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
