// One public palette, for a shared link (palette.html?owner=…&id=…): its colors
// in any bead size, and "Save a copy" to keep it as one of my palettes.

import { catalogFromFiles } from "../src/catalog/catalog.js";
import { isOwned } from "../src/collection/color-source.js";
import { copyPalette, findMyPalette, newPaletteId, type PublicPalette, putMyPalette } from "../src/collection/my-palettes.js";
import { paletteColorsFor } from "../src/collection/palettes.js";
import { allBeadSizes, resolveBeadSize } from "../src/flat/beads.js";
import { loadMyBeads } from "./my-beads-store.js";
import { renderNav } from "./nav.js";
import { loadMyPalettes, saveMyPalettes } from "./palettes-store.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

renderNav("palettes");

/** The bead size last picked on the My beads page, shared with it. */
const SIZE_KEY = "bead-model:my-beads-size";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  notice: $("notice"),
  title: $("palette-title"),
  by: $("palette-by"),
  about: $("palette-about"),
  body: $("palette-body"),
  size: $<HTMLSelectElement>("size"),
  sizeCount: $("size-count"),
  colors: $<HTMLUListElement>("colors"),
  saveCopy: $<HTMLButtonElement>("save-copy"),
};

let shown: PublicPalette | undefined;

async function load(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const owner = params.get("owner") ?? "";
  const id = params.get("id") ?? "";
  const res = owner && id ? await fetch(`/api/palettes/public/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`).catch(() => undefined) : undefined;
  if (!res?.ok || !res.headers.get("content-type")?.includes("json")) {
    els.about.textContent =
      res?.status === 404 || !owner || !id
        ? "This palette isn't public, or there's no such palette. Its owner may have made it private."
        : "The palette can't be reached from here (the site's server isn't running).";
    return;
  }
  shown = (await res.json()) as PublicPalette;
  const { palette, by } = shown;
  document.title = `${palette.name} · Palette`;
  els.title.textContent = palette.name;
  els.by.textContent = `by ${by || "a beader"}`;
  els.about.textContent = palette.description ?? `${palette.colors.length} color${palette.colors.length === 1 ? "" : "s"}, shown in the bead size you pick.`;
  els.body.hidden = false;
  els.size.innerHTML = allBeadSizes(catalog)
    .map((s) => `<option value="${esc(s.text)}">${esc(s.label)}</option>`)
    .join("");
  els.size.value = readSize();
  if (!els.size.value) els.size.selectedIndex = 0;
  renderColors();
}

function renderColors(): void {
  if (!shown) return;
  const size = resolveBeadSize(catalog, els.size.value);
  const myBeads = loadMyBeads();
  const colors = paletteColorsFor(shown.palette, size, catalog);
  const mine = colors.filter((c) => isOwned(myBeads, size, c.entry)).length;
  els.sizeCount.textContent = `${colors.length} color${colors.length === 1 ? "" : "s"} in ${size.label}${myBeads.beads.length ? ` · ${mine} in my beads` : ""}`;
  els.colors.innerHTML = colors
    .map((c) => {
      const near = c.nearest && c.nearest.name !== c.name ? `for ${c.nearest.name}` : c.code === "own" ? "no catalog match: own color" : "";
      return `<li><span class="color-chip" aria-pressed="${isOwned(myBeads, size, c.entry)}">
        <span class="swatch big" style="background:${esc(c.rgb)}"></span>
        <span class="color-chip-text"><b class="mono">${esc(c.code)}</b><span class="muted">${esc(c.name)}${near ? ` · ${esc(near)}` : ""}</span></span>
        <span class="color-chip-check" aria-hidden="true">${isOwned(myBeads, size, c.entry) ? "✓" : ""}</span>
      </span></li>`;
    })
    .join("");
}

els.size.addEventListener("change", () => {
  writeSize(els.size.value);
  renderColors();
});

els.saveCopy.addEventListener("click", () => {
  if (!shown) return;
  const list = loadMyPalettes();
  let id = newPaletteId();
  while (findMyPalette(list, id)) id = newPaletteId();
  const saved = saveMyPalettes(putMyPalette(list, copyPalette(shown.palette, id)));
  showNotice(
    saved
      ? `Saved a copy to <a href="./profile.html#palettes">my palettes</a>. Pick it in <b>Colors from</b> in any design.`
      : "This browser won't keep the palette (storage is off, as in a private window).",
  );
});

let noticeTimer = 0;
function showNotice(html: string): void {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (els.notice.hidden = true), 6000);
}

function readSize(): string {
  try {
    return localStorage.getItem(SIZE_KEY) ?? "miyuki delica DB";
  } catch {
    return "miyuki delica DB";
  }
}

function writeSize(size: string): void {
  try {
    localStorage.setItem(SIZE_KEY, size);
  } catch {
    // Only a convenience.
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

void load();
