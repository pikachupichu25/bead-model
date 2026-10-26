// The designers' "Colors from" menu: a button showing the current source and
// its colors, which opens a searchable list of every palette (presets, mine,
// ones I picked before, and public ones), by name, tag or color.

import type { Catalog } from "../src/catalog/catalog.js";
import { type ColorSource, paletteOf } from "../src/collection/color-source.js";
import type { PublicPalette } from "../src/collection/my-palettes.js";
import { type PaletteEntry, paletteEntry, searchPalettes, topTags } from "../src/collection/palette-search.js";
import { paletteSwatches } from "../src/collection/palettes.js";
import { fetchPublicPalettes, MY_PALETTES } from "./palette-list.js";
import { allPalettes, loadMyPalettes, loadUsedPalettes, rememberUsedPalette } from "./palettes-store.js";
import { presetPalettes } from "./presets.js";

/** Public palettes fetched when the menu opens: the newest this many pages, searched in the browser. */
const PUBLIC_PAGES = 4;
/** At most this many swatches in a row; the rest are counted. */
const ROW_SWATCHES = 24;

const KIND_LABEL = { preset: "Preset", mine: "Mine", used: "Used before", public: "Public" } as const;

/** What the "Colors from" button shows: the source's name and, for a palette, its colors. */
export function sourceButtonHtml(source: ColorSource, catalog: Catalog): string {
  const palette = paletteOf(source, allPalettes());
  const name = source === "mine" ? "My beads" : palette ? palette.name : "All catalog colors";
  const swatches = palette ? paletteSwatches(palette, catalog) : [];
  return `<span class="source-name">${esc(name)}</span>${swatches.length ? swatchStrip(swatches, 10) : ""}<span class="source-caret" aria-hidden="true">▾</span>`;
}

/** Opens the menu. Gives the source picked, or undefined when closed without picking. */
export function pickColorSource(current: ColorSource, catalog: Catalog): Promise<ColorSource | undefined> {
  const dialog = document.createElement("dialog");
  dialog.className = "new-dialog palette-picker";
  dialog.setAttribute("aria-label", "Colors from");
  dialog.innerHTML = `<form method="dialog" class="picker-form">
    <div class="ed-head"><h2>Colors from</h2><button type="button" class="icon-button" data-close aria-label="Close" title="Close">✕</button></div>
    <div class="picker-quick">
      <button type="button" class="button small" data-source="all" aria-pressed="${current === "all"}">All catalog colors</button>
      <button type="button" class="button small" data-source="mine" aria-pressed="${current === "mine"}">My beads</button>
      <a class="muted" href="${MY_PALETTES}">My palettes</a>
    </div>
    <div class="picker-search">
      <input type="search" name="q" placeholder="Search by name, tag or color: ocean, warm, blue, #2a6f97" aria-label="Search palettes" autocomplete="off" />
      <label class="toggle picker-color" title="Only palettes with a color like this one">
        <input type="checkbox" name="by-color" />
        <span>Has a color like</span>
        <input type="color" name="color" value="#2a6f97" aria-label="The color to look for" />
      </label>
    </div>
    <div class="picker-tags" role="group" aria-label="Tags"></div>
    <p class="muted picker-count" role="status"></p>
    <ul class="picker-list" role="listbox" aria-label="Palettes"></ul>
  </form>`;
  document.body.append(dialog);

  const $ = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
  const search = $<HTMLInputElement>('input[name="q"]');
  const byColor = $<HTMLInputElement>('input[name="by-color"]');
  const color = $<HTMLInputElement>('input[name="color"]');
  const tagBox = $<HTMLElement>(".picker-tags");
  const count = $<HTMLElement>(".picker-count");
  const list = $<HTMLUListElement>(".picker-list");

  const mine = loadMyPalettes().palettes;
  const used = loadUsedPalettes();
  const local: PaletteEntry[] = [
    ...used.filter((u) => !mine.some((m) => m.id === u.palette.id)).map((u) => paletteEntry(u.palette, "used", catalog, { owner: u.owner, by: u.by })),
    ...mine.map((p) => paletteEntry(p, "mine", catalog)),
    ...presetPalettes.map((p) => paletteEntry(p, "preset", catalog)),
  ];
  /** Public palettes by "<owner>/<id>", with what the server sent. */
  const publics = new Map<string, { entry: PaletteEntry; shared: PublicPalette }>();
  let publicState: "loading" | "ok" | "offline" = "loading";
  const chosenTags = new Set<string>();
  /** What each row stands for, by its index. */
  let rows: PaletteEntry[] = [];

  function entries(): PaletteEntry[] {
    const shown = new Set(local.map((e) => e.palette.id));
    return [...local, ...[...publics.values()].map((p) => p.entry).filter((e) => !shown.has(e.palette.id))];
  }

  function render(): void {
    const all = entries();
    tagBox.innerHTML = topTags(all, 14)
      .map((t) => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${chosenTags.has(t)}">${esc(t)}</button>`)
      .join("");
    rows = searchPalettes(all, { text: search.value, tags: [...chosenTags], ...(byColor.checked ? { color: color.value } : {}) });
    const note = publicState === "loading" ? " · looking for public palettes…" : publicState === "offline" ? " · public palettes can't be reached from here" : "";
    count.textContent = `${rows.length} palette${rows.length === 1 ? "" : "s"}${note}`;
    list.innerHTML = rows.length
      ? rows
          .map((e, i) => {
            const on = current === `palette:${e.palette.id}`;
            const who = e.kind === "public" || e.kind === "used" ? `by ${e.by || "a beader"}` : KIND_LABEL[e.kind];
            return `<li><button type="button" class="picker-row" role="option" aria-selected="${on}" data-row="${i}">
              <span class="picker-row-head"><b>${esc(e.palette.name)}</b> <span class="muted">${esc(who)}${e.kind === "used" ? " · used before" : ""}</span>
                ${(e.palette.tags ?? []).map((t) => `<span class="palette-tag">${esc(t)}</span>`).join("")}</span>
              ${swatchStrip(e.swatches, ROW_SWATCHES)}
            </button></li>`;
          })
          .join("")
      : `<li class="muted picker-empty">No palette matches. Try fewer words, another tag, or a color further off.</li>`;
  }

  async function loadPublic(query: string): Promise<void> {
    let cursor: number | undefined;
    for (let page = 0; page < (query ? 1 : PUBLIC_PAGES); page++) {
      const result = await fetchPublicPalettes(query, cursor);
      if (!result) {
        if (publicState === "loading") publicState = "offline";
        break;
      }
      publicState = "ok";
      for (const shared of result.palettes) {
        const key = `${shared.owner}/${shared.palette.id}`;
        if (!publics.has(key)) publics.set(key, { entry: paletteEntry(shared.palette, "public", catalog, { owner: shared.owner, by: shared.by }), shared });
      }
      if (result.next === undefined) break;
      cursor = result.next;
    }
    if (dialog.open) render();
  }

  // The newest public palettes now; a search also asks the server, for older ones.
  void loadPublic("");
  let timer = 0;
  search.addEventListener("input", () => {
    render();
    clearTimeout(timer);
    const query = search.value.trim();
    if (query) timer = window.setTimeout(() => void loadPublic(query), 300);
  });
  byColor.addEventListener("change", render);
  color.addEventListener("input", () => {
    byColor.checked = true;
    render();
  });
  tagBox.addEventListener("click", (event) => {
    const tag = (event.target as HTMLElement).closest<HTMLElement>("[data-tag]")?.dataset.tag;
    if (!tag) return;
    if (chosenTags.has(tag)) chosenTags.delete(tag);
    else chosenTags.add(tag);
    render();
  });
  // Down from the search goes into the list; up and down move along it.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>(".picker-row")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at < 0 ? 0 : Math.min(at + 1, buttons.length - 1)) : at <= 0 ? -1 : at - 1;
    event.preventDefault();
    (next < 0 ? search : buttons[next])?.focus();
  });

  return new Promise((resolve) => {
    let picked: ColorSource | undefined;
    const choose = (entry: PaletteEntry) => {
      // A public palette is kept in this browser, so the source can name it.
      const shared = [...publics.values()].find((p) => p.entry === entry)?.shared ?? used.find((u) => u.palette.id === entry.palette.id);
      if (shared) rememberUsedPalette({ ...shared, updated: Date.now() });
      picked = `palette:${entry.palette.id}`;
      dialog.close();
    };
    dialog.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const quick = target.closest<HTMLElement>("[data-source]")?.dataset.source;
      const row = target.closest<HTMLElement>("[data-row]")?.dataset.row;
      if (target.closest("[data-close]")) {
        dialog.close();
      } else if (quick) {
        picked = quick as ColorSource;
        dialog.close();
      } else if (row !== undefined && rows[Number(row)]) {
        choose(rows[Number(row)]!);
      }
    });
    // Enter in the search picks the first palette (the form itself never submits).
    $<HTMLFormElement>("form").addEventListener("submit", (event) => event.preventDefault());
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !rows[0]) return;
      event.preventDefault();
      choose(rows[0]);
    });
    dialog.addEventListener("close", () => {
      resolve(picked);
      dialog.remove();
    });
    render();
    dialog.showModal();
    search.focus();
  });
}

/** A row of small swatches, with "+N" for the rest. */
function swatchStrip(swatches: { name: string; rgb: string }[], max: number): string {
  const shown = swatches.slice(0, max);
  const more = swatches.length - shown.length;
  return `<span class="swatch-strip" aria-hidden="true">${shown
    .map((s) => `<span class="swatch" style="background:${esc(s.rgb)}" title="${esc(s.name)}"></span>`)
    .join("")}${more > 0 ? `<span class="muted swatch-more">+${more}</span>` : ""}</span>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
