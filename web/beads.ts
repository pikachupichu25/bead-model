// "My beads": the beads someone has at home. Kept in this browser, exported as
// readable text, and offered by the designers when "Colors from" is My beads.
// My beads in a size can be saved as a palette; palettes are on the Palettes page and My profile.

import { catalogFromFiles } from "../src/catalog/catalog.js";
import {
  addOwned,
  groupMyBeads,
  hasOwned,
  mergeMyBeads,
  type MyBeads,
  myBeadsFromJson,
  myBeadsText,
  myBeadsToJson,
  type OwnedBead,
  ownedColorsFor,
  ownedId,
  removeOwned,
  updateOwned,
} from "../src/collection/my-beads.js";
import {
  findMyPalette,
  mergeMyPalettes,
  type MyPalettes,
  myPalettesFromJson,
  newPaletteId,
  paletteFromEntries,
  putMyPalette,
} from "../src/collection/my-palettes.js";
import { allBeadSizes, catalogColors, resolveBeadSize } from "../src/flat/beads.js";
import { loadMyBeads, onMyBeadsChange, saveMyBeads } from "./my-beads-store.js";
import { renderNav } from "./nav.js";
import { loadMyPalettes, saveMyPalettes } from "./palettes-store.js";
import { MY_PALETTES } from "./palette-list.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

renderNav("profile");

/** The bead size last picked on this page. */
const SIZE_KEY = "bead-model:my-beads-size";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  notice: $("notice"),
  size: $<HTMLSelectElement>("size"),
  search: $<HTMLInputElement>("search"),
  sizeCount: $("size-count"),
  colors: $<HTMLUListElement>("colors"),
  ownName: $<HTMLInputElement>("own-name"),
  ownRgb: $<HTMLInputElement>("own-rgb"),
  ownAdd: $<HTMLButtonElement>("own-add"),
  mineCount: $("mine-count"),
  mineFilter: $<HTMLInputElement>("mine-filter"),
  mine: $("mine"),
  exportText: $<HTMLButtonElement>("export-text"),
  exportDialog: $<HTMLDialogElement>("export-dialog"),
  exportPreview: $("export-preview"),
  exportCopy: $<HTMLButtonElement>("export-copy"),
  exportDownload: $<HTMLButtonElement>("export-download"),
  backup: $<HTMLButtonElement>("backup"),
  restore: $<HTMLInputElement>("restore-file"),
  paletteFromMine: $<HTMLButtonElement>("palette-from-mine"),
};

let list: MyBeads = loadMyBeads();
let palettes: MyPalettes = loadMyPalettes();

function changePalettes(next: MyPalettes): void {
  palettes = next;
  if (!saveMyPalettes(palettes)) showNotice("This browser won't keep your palettes (storage is off, as in a private window).");
}

function change(next: MyBeads): void {
  list = next;
  if (!saveMyBeads(list)) showNotice("This browser won't keep your beads (storage is off, as in a private window). Back up before you close the page.");
  render();
}

// ---- Rendering ----

function render(): void {
  renderSizes();
  renderColors();
  renderMine();
}

function renderSizes(): void {
  const counts = new Map(groupMyBeads(list, catalog).map((g) => [g.size, g.beads.length]));
  const chosen = els.size.value || readSize();
  const byBrand = new Map<string, { text: string; label: string }[]>();
  for (const size of allBeadSizes(catalog)) {
    const brand = size.text.split(" ")[0]!;
    byBrand.set(brand, [...(byBrand.get(brand) ?? []), size]);
  }
  els.size.innerHTML = [...byBrand.entries()]
    .map(([brand, sizes]) => {
      const name = catalog.get(brand)?.name ?? brand;
      const options = sizes
        .map((s) => {
          const n = counts.get(s.text);
          return `<option value="${esc(s.text)}"${s.text === chosen ? " selected" : ""}>${esc(s.label)}${n ? ` · ${n} mine` : ""}</option>`;
        })
        .join("");
      return `<optgroup label="${esc(brand === "generic" ? "Generic" : name)}">${options}</optgroup>`;
    })
    .join("");
  if (!els.size.value) els.size.selectedIndex = 0;
}

function renderColors(): void {
  const size = resolveBeadSize(catalog, els.size.value);
  els.paletteFromMine.disabled = ownedColorsFor(list, size).length === 0;
  const query = els.search.value.trim().toLowerCase();
  const all = catalogColors(size);
  const shown = all.filter((c) => !query || c.entry.toLowerCase().includes(query) || c.name.toLowerCase().includes(query));
  const have = all.filter((c) => hasOwned(list, { kind: "catalog", bead: c.entry })).length;
  els.sizeCount.textContent = all.length
    ? `${have} of ${all.length} catalog colors in ${size.label}${query ? ` · ${shown.length} match` : ""}`
    : `The catalog has no colors for ${size.label} yet. Add your own below.`;
  els.colors.innerHTML = shown
    .map((c) => {
      const on = hasOwned(list, { kind: "catalog", bead: c.entry });
      const code = c.entry.replace(/^\S+ /, "");
      return `<li><button type="button" class="color-chip" aria-pressed="${on}" data-entry="${esc(c.entry)}" title="${esc(`${code} ${c.name}`)}">
        <span class="swatch big" style="background:${esc(c.rgb)}"></span>
        <span class="color-chip-text"><b class="mono">${esc(code)}</b><span class="muted">${esc(c.name)}</span></span>
        <span class="color-chip-check" aria-hidden="true">${on ? "✓" : "+"}</span>
      </button></li>`;
    })
    .join("");
  if (all.length && !shown.length) els.colors.innerHTML = `<li class="muted">No color matches “${esc(els.search.value)}”.</li>`;
}

function renderMine(): void {
  const query = els.mineFilter.value.trim().toLowerCase();
  const groups = groupMyBeads(list, catalog)
    .map((g) => ({
      ...g,
      beads: g.beads.filter((b) => !query || [g.label, b.code, b.name, b.bead.amount ?? "", b.bead.note ?? ""].some((t) => t.toLowerCase().includes(query))),
    }))
    .filter((g) => g.beads.length);
  els.mineCount.textContent = list.beads.length ? `${list.beads.length} bead${list.beads.length === 1 ? "" : "s"}` : "";
  if (!list.beads.length) {
    els.mine.innerHTML = `<p class="muted mine-empty">No beads yet. Pick a size on the left and click the colors you have.</p>`;
    return;
  }
  if (!groups.length) {
    els.mine.innerHTML = `<p class="muted mine-empty">Nothing matches “${esc(els.mineFilter.value)}”.</p>`;
    return;
  }
  els.mine.innerHTML = groups
    .map(
      (g) => `<section class="mine-group">
        <h3><button type="button" class="link-button" data-size="${esc(g.size ?? "")}" ${g.size ? "" : "disabled"}>${esc(g.label)}</button> <span class="muted">${g.beads.length}</span></h3>
        <ul class="mine-list">${g.beads
          .map(
            (b) => `<li data-id="${esc(b.id)}">
              <span class="swatch big" style="background:${esc(b.rgb)}"></span>
              <span class="mine-name"><b class="mono">${esc(b.code)}</b> ${esc(b.name)}</span>
              <input type="text" data-field="amount" value="${esc(b.bead.amount ?? "")}" placeholder="amount" aria-label="Amount of ${esc(b.code)}" />
              <input type="text" data-field="note" value="${esc(b.bead.note ?? "")}" placeholder="note" aria-label="Note for ${esc(b.code)}" />
              <button type="button" class="icon-button" data-action="remove" aria-label="Remove ${esc(b.code)} ${esc(b.name)}" title="Remove">✕</button>
            </li>`,
          )
          .join("")}</ul>
      </section>`,
    )
    .join("");
}

// ---- Events ----

els.size.addEventListener("change", () => {
  writeSize(els.size.value);
  renderColors();
});

els.paletteFromMine.addEventListener("click", () => {
  const size = resolveBeadSize(catalog, els.size.value);
  const name = prompt("Name the palette", `My ${size.label} beads`);
  if (name === null) return;
  let id = newPaletteId();
  while (findMyPalette(palettes, id)) id = newPaletteId();
  const palette = paletteFromEntries(name, ownedColorsFor(list, size).map((c) => c.entry), id);
  if (!palette) return;
  changePalettes(putMyPalette(palettes, palette));
  showNotice(`Saved “${esc(palette.name)}” to <a href="${MY_PALETTES}">my palettes</a>. Pick it in Colors from in any design.`);
});
els.search.addEventListener("input", renderColors);
els.mineFilter.addEventListener("input", renderMine);

els.colors.addEventListener("click", (event) => {
  const entry = (event.target as HTMLElement).closest<HTMLElement>("[data-entry]")?.dataset.entry;
  if (!entry) return;
  const bead: OwnedBead = { kind: "catalog", bead: entry };
  change(hasOwned(list, bead) ? removeOwned(list, ownedId(bead)) : addOwned(list, bead));
});

els.ownAdd.addEventListener("click", () => {
  const name = els.ownName.value.trim();
  if (!name) {
    els.ownName.focus();
    showNotice("Give your color a name first.");
    return;
  }
  const bead: OwnedBead = { kind: "own", size: els.size.value, name, rgb: els.ownRgb.value.toLowerCase() };
  if (hasOwned(list, bead)) {
    showNotice(`You already have “${esc(name)}” in this size.`);
    return;
  }
  els.ownName.value = "";
  change(addOwned(list, bead));
});
els.ownName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.ownAdd.click();
});

els.mine.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const size = target.closest<HTMLElement>("[data-size]")?.dataset.size;
  if (size) {
    els.size.value = size;
    writeSize(size);
    els.search.value = "";
    renderColors();
    return;
  }
  if (target.closest<HTMLElement>("[data-action]")?.dataset.action !== "remove") return;
  const id = target.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (id) change(removeOwned(list, id));
});

// Amounts and notes save as you type, without redrawing the field being typed in.
els.mine.addEventListener("input", (event) => {
  const el = event.target as HTMLInputElement;
  const id = el.closest<HTMLElement>("[data-id]")?.dataset.id;
  const field = el.dataset.field;
  if (!id || (field !== "amount" && field !== "note")) return;
  list = updateOwned(list, id, { [field]: el.value });
  saveMyBeads(list);
});

els.exportText.addEventListener("click", () => {
  els.exportPreview.textContent = myBeadsText(list, catalog);
  els.exportDialog.showModal();
});
els.exportCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(myBeadsText(list, catalog));
    els.exportCopy.textContent = "Copied";
    setTimeout(() => (els.exportCopy.textContent = "Copy"), 1500);
  } catch {
    showNotice("Couldn't copy. Select the text and copy it yourself.");
  }
});
els.exportDownload.addEventListener("click", () => download(myBeadsText(list, catalog), `my-beads-${today()}.txt`, "text/plain"));
// The backup holds my palettes too, next to the beads: the same file restores both.
els.backup.addEventListener("click", () =>
  download(JSON.stringify({ ...JSON.parse(myBeadsToJson(list)), palettes: palettes.palettes }, null, 2), `my-beads-${today()}.json`, "application/json"),
);

els.restore.addEventListener("change", async () => {
  const file = els.restore.files?.[0];
  els.restore.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const backup = myBeadsFromJson(text);
    const before = list.beads.length;
    const palettesBefore = palettes.palettes.length;
    changePalettes(mergeMyPalettes(palettes, myPalettesFromJson(text)));
    change(mergeMyBeads(list, backup));
    const added = list.beads.length - before;
    const newPalettes = palettes.palettes.length - palettesBefore;
    showNotice(
      `Restored ${esc(file.name)}: ${added} bead${added === 1 ? "" : "s"} added, ${backup.beads.length - added} you already had` +
        (newPalettes ? `, and ${newPalettes} palette${newPalettes === 1 ? "" : "s"} (private).` : "."),
    );
  } catch (e) {
    showNotice(`Couldn't restore ${esc(file.name)}: ${esc(e instanceof Error ? e.message : String(e))}`);
  }
});

// Another tab changed the list: show the new one, unless an amount or note is being typed here.
onMyBeadsChange(() => {
  list = loadMyBeads();
  palettes = loadMyPalettes();
  if (!els.mine.contains(document.activeElement)) render();
});

// ---- Helpers ----

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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

render();
