// The "Colors from" select and the "+ Add a color" list, shared by the Flat
// and Nora designers: both offer colors in one bead size, from every catalog
// color, My beads, or a palette.

import type { Catalog } from "../src/catalog/catalog.js";
import { type ColorSource, offeredColors, paletteOf } from "../src/collection/color-source.js";
import { type MyBeads, ownedColorsFor } from "../src/collection/my-beads.js";
import type { FlatBeadSize } from "../src/flat/beads.js";
import { findMyPalette, newPaletteId, paletteFromEntries, putMyPalette } from "../src/collection/my-palettes.js";
import { allPalettes, loadMyPalettes, saveMyPalettes } from "./palettes-store.js";
import { BROWSE_PALETTES, colorSourceOptions } from "./presets.js";

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
  const palettes = allPalettes();
  const offered = offeredColors(source, size, { myBeads, palettes, catalog });
  const colors = offered.filter((c) => !used.has(JSON.stringify(c.entry)));
  const palette = paletteOf(source, palettes);
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
  els.colorSource.innerHTML = colorSourceOptions(source, loadMyPalettes().palettes);
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
  const palettes = allPalettes();
  const palette = paletteOf(source, palettes);
  return palette && { name: palette.name, colors: offeredColors(source, size, { myBeads, palettes, catalog }) };
}

/**
 * The "Colors from" select changed: the new source, or undefined after
 * "Browse palettes…", which goes to the My beads page instead.
 */
export function pickedColorSource(select: HTMLSelectElement): ColorSource | undefined {
  if (select.value !== "browse") return select.value as ColorSource;
  location.href = BROWSE_PALETTES;
  return undefined;
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
