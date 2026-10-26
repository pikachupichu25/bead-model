// "My beads": the beads someone has at home. Kept in this browser, exported as
// readable text, and offered by the designers when "Colors from" is My beads.
// Also lists the preset palettes, to add a palette's colors in one go.

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
  ownedId,
  removeOwned,
  updateOwned,
} from "../src/collection/my-beads.js";
import { paletteColorsFor } from "../src/collection/palettes.js";
import { allBeadSizes, catalogColors, resolveBeadSize } from "../src/flat/beads.js";
import { loadMyBeads, onMyBeadsChange, saveMyBeads } from "./my-beads-store.js";
import { renderNav } from "./nav.js";
import { presetPalettes } from "./presets.js";

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
  palettes: $<HTMLUListElement>("palettes"),
  palettesSize: $("palettes-size"),
};

let list: MyBeads = loadMyBeads();

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
  renderPalettes();
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

/** A palette color in the picked size, as the bead it adds to My beads. */
function paletteBeads(index: number): { bead: OwnedBead; name: string; rgb: string; code: string }[] {
  const size = els.size.value;
  return paletteColorsFor(presetPalettes[index]!, resolveBeadSize(catalog, size), catalog).map((c) => ({
    bead: typeof c.entry === "string" ? { kind: "catalog", bead: c.entry } : { kind: "own", size, name: c.name, rgb: c.rgb },
    name: c.name,
    rgb: c.rgb,
    code: c.code,
  }));
}

function renderPalettes(): void {
  els.palettesSize.textContent = `in ${resolveBeadSize(catalog, els.size.value).label}`;
  els.palettes.innerHTML = presetPalettes
    .map((p, i) => {
      const beads = paletteBeads(i);
      const missing = beads.filter((b) => !hasOwned(list, b.bead)).length;
      return `<li class="palette-item">
        <div class="palette-head"><b>${esc(p.name)}</b> <span class="muted">${esc(p.description ?? "")}</span></div>
        <ul class="palette-swatches">${beads
          .map((b) => {
            const on = hasOwned(list, b.bead);
            return `<li title="${esc(`${b.code} ${b.name}${on ? " · mine" : ""}`)}"><span class="swatch big${on ? " mine" : ""}" style="background:${esc(b.rgb)}"></span></li>`;
          })
          .join("")}</ul>
        <button type="button" class="button small" data-palette="${i}"${missing ? "" : " disabled"}>${missing ? `Add ${missing === beads.length ? "these" : `the ${missing} I don't have`} to My beads` : "All in My beads"}</button>
      </li>`;
    })
    .join("");
}

// ---- Events ----

els.size.addEventListener("change", () => {
  writeSize(els.size.value);
  renderColors();
  renderPalettes();
});

els.palettes.addEventListener("click", (event) => {
  const index = (event.target as HTMLElement).closest<HTMLElement>("[data-palette]")?.dataset.palette;
  if (index === undefined) return;
  const beads = paletteBeads(Number(index)).filter((b) => !hasOwned(list, b.bead));
  change(beads.reduce((l, b) => addOwned(l, b.bead), list));
  showNotice(`Added ${beads.length} bead${beads.length === 1 ? "" : "s"} from ${esc(presetPalettes[Number(index)]!.name)}.`);
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
    renderPalettes();
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
els.backup.addEventListener("click", () => download(myBeadsToJson(list), `my-beads-${today()}.json`, "application/json"));

els.restore.addEventListener("change", async () => {
  const file = els.restore.files?.[0];
  els.restore.value = "";
  if (!file) return;
  try {
    const backup = myBeadsFromJson(await file.text());
    const before = list.beads.length;
    change(mergeMyBeads(list, backup));
    const added = list.beads.length - before;
    showNotice(`Restored ${esc(file.name)}: ${added} bead${added === 1 ? "" : "s"} added, ${backup.beads.length - added} you already had.`);
  } catch (e) {
    showNotice(`Couldn't restore ${esc(file.name)}: ${esc(e instanceof Error ? e.message : String(e))}`);
  }
});

// Another tab changed the list: show the new one, unless an amount or note is being typed here.
onMyBeadsChange(() => {
  list = loadMyBeads();
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
