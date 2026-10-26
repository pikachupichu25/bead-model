// Lists of palettes, shared by the Palettes page (presets and public ones) and
// My profile's My palettes tab: each palette's swatches in a bead size, with
// the colors in My beads ringed, and the buttons under it.

import type { Catalog } from "../src/catalog/catalog.js";
import { addOwned, hasOwned, type MyBeads, type OwnedBead } from "../src/collection/my-beads.js";
import { copyPalette, findMyPalette, type MyPalette, newPaletteId, type PublicPalettePage, putMyPalette } from "../src/collection/my-palettes.js";
import { type Palette, paletteColorsFor } from "../src/collection/palettes.js";
import { allBeadSizes, resolveBeadSize } from "../src/flat/beads.js";
import { loadMyBeads, saveMyBeads } from "./my-beads-store.js";
import { loadMyPalettes, saveMyPalettes } from "./palettes-store.js";

/** The bead size last picked, shared with the My beads page. */
const SIZE_KEY = "bead-model:my-beads-size";

/** Where my palettes are kept and changed. */
export const MY_PALETTES = "./profile.html#palettes";

/** The button that shows a palette as text, for `paletteItem`'s `more`. */
export const COPY_TEXT = `<button type="button" class="button small" data-action="text">Copy as text</button>`;

/** A palette's colors in a bead size ("<brand> <line> <size>"), as the beads they add to My beads. */
export function paletteBeads(palette: Palette, size: string, catalog: Catalog): { bead: OwnedBead; name: string; rgb: string; code: string }[] {
  return paletteColorsFor(palette, resolveBeadSize(catalog, size), catalog).map((c) => ({
    bead: typeof c.entry === "string" ? { kind: "catalog", bead: c.entry } : { kind: "own", size, name: c.name, rgb: c.rgb },
    name: c.name,
    rgb: c.rgb,
    code: c.code,
  }));
}

/** One palette: its head, its swatches in this size, "Add these to My beads", and any more buttons. `key` goes in data-id. */
export function paletteItem(
  p: Palette,
  { head, key = p.id, more = "", size, catalog, myBeads }: { head: string; key?: string; more?: string; size: string; catalog: Catalog; myBeads: MyBeads },
): string {
  const beads = paletteBeads(p, size, catalog);
  const missing = beads.filter((b) => !hasOwned(myBeads, b.bead)).length;
  return `<li class="palette-item" data-id="${esc(key)}">
    <div class="palette-head">${head}</div>
    <ul class="palette-swatches">${beads
      .map((b) => {
        const on = hasOwned(myBeads, b.bead);
        return `<li title="${esc(`${b.code} ${b.name}${on ? " · mine" : ""}`)}"><span class="swatch big${on ? " mine" : ""}" style="background:${esc(b.rgb)}"></span></li>`;
      })
      .join("")}</ul>
    <span class="palette-tools">
      <button type="button" class="button small" data-action="add"${missing ? "" : " disabled"}>${missing ? `Add ${missing === beads.length ? "these" : `the ${missing} I don't have`} to My beads` : "All in My beads"}</button>
      ${more}
    </span>
  </li>`;
}

/** A preset's head: its name and what it is. */
export function presetHead(p: Palette): string {
  return `<b>${esc(p.name)}</b> <span class="muted">${esc(p.description ?? "")}</span>${tagList(p)}`;
}

/** A palette's tags, as small labels. */
export function tagList(p: Palette): string {
  return p.tags?.length ? `<span class="palette-tag-list">${p.tags.map((t) => `<span class="palette-tag">${esc(t)}</span>`).join("")}</span>` : "";
}

/** My palette's head: its name to change, who may see it, its link when public, and delete. */
export function myPaletteHead(p: MyPalette, signedIn: boolean): string {
  return `<input type="text" class="palette-name" data-field="name" value="${esc(p.name)}" maxlength="80" aria-label="Palette name" />
    <input type="text" class="palette-tags" data-field="tags" value="${esc((p.tags ?? []).join(", "))}" placeholder="tags, e.g. ocean, cool" aria-label="Tags for ${esc(p.name)}, comma separated" />
    <span class="palette-tools">
      <select data-field="visibility" aria-label="Who can see ${esc(p.name)}"${signedIn ? "" : ' disabled title="Sign in to share"'}>
        <option value="private"${p.visibility === "private" ? " selected" : ""}>Private</option>
        <option value="public"${p.visibility === "public" ? " selected" : ""}>Public</option>
      </select>
      ${signedIn ? "" : `<span class="muted">Sign in to share</span>`}
      ${signedIn && p.visibility === "public" ? `<button type="button" class="button small" data-action="link">Copy link</button>` : ""}
      <button type="button" class="icon-button" data-action="delete" aria-label="Delete ${esc(p.name)}" title="Delete">✕</button>
    </span>`;
}

/** Adds the palette's colors in this size that My beads doesn't have. Gives how many, or undefined when the browser won't keep them. */
export function addPaletteToMyBeads(palette: Palette, size: string, catalog: Catalog): number | undefined {
  const list = loadMyBeads();
  const beads = paletteBeads(palette, size, catalog).filter((b) => !hasOwned(list, b.bead));
  return saveMyBeads(beads.reduce((l, b) => addOwned(l, b.bead), list)) ? beads.length : undefined;
}

/** Keeps a copy of someone's palette (or a preset) as one of my palettes. False when the browser won't keep it. */
export function savePaletteCopy(palette: Palette): boolean {
  const list = loadMyPalettes();
  let id = newPaletteId();
  while (findMyPalette(list, id)) id = newPaletteId();
  return saveMyPalettes(putMyPalette(list, copyPalette(palette, id)));
}

/** A page of public palettes, or undefined when the site's server can't be reached. */
export async function fetchPublicPalettes(query: string, cursor?: number): Promise<PublicPalettePage | undefined> {
  const next = cursor === undefined ? "" : `&cursor=${cursor}`;
  return fetch(`/api/palettes/public?q=${encodeURIComponent(query)}${next}`, { credentials: "same-origin" })
    .then(async (res) => (res.ok && res.headers.get("content-type")?.includes("json") ? ((await res.json()) as PublicPalettePage) : undefined))
    .catch(() => undefined);
}

/** The link that shows a public palette to anyone. */
export function publicLink(owner: string, id: string): string {
  return new URL(`./palette.html?owner=${encodeURIComponent(owner)}&id=${encodeURIComponent(id)}`, location.href).href;
}

/** The options of a bead size select, by brand, with `chosen` selected. */
export function sizeOptions(catalog: Catalog, chosen: string): string {
  const byBrand = new Map<string, { text: string; label: string }[]>();
  for (const size of allBeadSizes(catalog)) {
    const brand = size.text.split(" ")[0]!;
    byBrand.set(brand, [...(byBrand.get(brand) ?? []), size]);
  }
  return [...byBrand.entries()]
    .map(([brand, sizes]) => {
      const name = brand === "generic" ? "Generic" : (catalog.get(brand)?.name ?? brand);
      const options = sizes.map((s) => `<option value="${esc(s.text)}"${s.text === chosen ? " selected" : ""}>${esc(s.label)}</option>`).join("");
      return `<optgroup label="${esc(name)}">${options}</optgroup>`;
    })
    .join("");
}

export function readSize(): string {
  try {
    return localStorage.getItem(SIZE_KEY) ?? "miyuki delica DB";
  } catch {
    return "miyuki delica DB";
  }
}

export function writeSize(size: string): void {
  try {
    localStorage.setItem(SIZE_KEY, size);
  } catch {
    // Only a convenience.
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
