// Palettes: the public palettes people shared, to search and save a copy of,
// and the presets that come with the app. My own palettes are on My profile.

import { catalogFromFiles } from "../src/catalog/catalog.js";
import type { PublicPalette } from "../src/collection/my-palettes.js";
import type { Palette } from "../src/collection/palettes.js";
import { loadMyBeads, onMyBeadsChange } from "./my-beads-store.js";
import { renderNav } from "./nav.js";
import {
  addPaletteToMyBeads,
  fetchPublicPalettes,
  MY_PALETTES,
  paletteItem,
  presetHead,
  publicLink,
  readSize,
  savePaletteCopy,
  sizeOptions,
  writeSize,
} from "./palette-list.js";
import { presetPalettes } from "./presets.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

renderNav("palettes");

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  notice: $("notice"),
  size: $<HTMLSelectElement>("size"),
  search: $<HTMLInputElement>("search"),
  publicNote: $("public-note"),
  publicList: $<HTMLUListElement>("public-list"),
  more: $<HTMLButtonElement>("more"),
  presetList: $<HTMLUListElement>("preset-list"),
};

/** The public palettes shown, and where the next page starts. */
const shown: { palettes: PublicPalette[]; next?: number; request: number } = { palettes: [], request: 0 };

function render(): void {
  const context = { size: els.size.value, catalog, myBeads: loadMyBeads() };
  els.publicList.innerHTML = shown.palettes
    .map((p, i) =>
      paletteItem(p.palette, {
        ...context,
        key: `public:${i}`,
        head: `<a href="${esc(publicLink(p.owner, p.palette.id))}"><b>${esc(p.palette.name)}</b></a> <span class="muted">by ${esc(p.by || "a beader")}${p.palette.description ? ` · ${esc(p.palette.description)}` : ""}</span>`,
        more: `<button type="button" class="button small" data-action="copy">Save a copy</button>`,
      }),
    )
    .join("");
  els.more.hidden = shown.next === undefined;
  const copy = `<button type="button" class="button small" data-action="copy">Save a copy</button>`;
  els.presetList.innerHTML = presetPalettes.map((p) => paletteItem(p, { ...context, head: presetHead(p), more: copy })).join("");
}

/** Fetches public palettes: the first page for a new search, or the next one. */
async function load(more = false): Promise<void> {
  const query = els.search.value.trim();
  const request = ++shown.request;
  const page = await fetchPublicPalettes(query, more ? shown.next : undefined);
  if (request !== shown.request) return; // a newer search is on its way
  if (!page) {
    els.publicNote.textContent = "Public palettes can't be reached from here (the site's server isn't running).";
    return;
  }
  shown.palettes = more ? [...shown.palettes, ...page.palettes] : page.palettes;
  shown.next = page.next;
  els.publicNote.innerHTML = shown.palettes.length
    ? "Palettes people made public. Save a copy to use one in <b>Colors from</b>."
    : query
      ? `No public palette matches “${esc(query)}”.`
      : `No public palettes yet. Make one of <a href="${MY_PALETTES}">my palettes</a> public to be the first.`;
  render();
}

function paletteOf(key: string): Palette | undefined {
  if (key.startsWith("public:")) return shown.palettes[Number(key.slice(7))]?.palette;
  return presetPalettes.find((p) => p.id === key);
}

// ---- Events ----

els.size.addEventListener("change", () => {
  writeSize(els.size.value);
  render();
});

let searchTimer = 0;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void load(), 250);
});
els.more.addEventListener("click", () => void load(true));

for (const list of [els.publicList, els.presetList]) {
  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    const palette = paletteOf(target.closest<HTMLElement>("[data-id]")?.dataset.id ?? "");
    if (!action || !palette) return;
    if (action === "add") {
      const added = addPaletteToMyBeads(palette, els.size.value, catalog);
      showNotice(added === undefined ? "This browser won't keep your beads (storage is off, as in a private window)." : `Added ${added} bead${added === 1 ? "" : "s"} from ${esc(palette.name)} to <a href="./beads.html">My beads</a>.`);
      render();
    } else if (action === "copy") {
      showNotice(
        savePaletteCopy(palette)
          ? `Saved a copy of “${esc(palette.name)}” to <a href="${MY_PALETTES}">my palettes</a>. Pick it in Colors from in any design.`
          : "This browser won't keep the palette (storage is off, as in a private window).",
      );
    }
  });
}

onMyBeadsChange(render);

let noticeTimer = 0;
function showNotice(html: string): void {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (els.notice.hidden = true), 6000);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---- Start ----

els.size.innerHTML = sizeOptions(catalog, readSize());
if (!els.size.value) els.size.selectedIndex = 0;
render();
void load();
