// Home: the feed of designs (pinned first, then my newest, then the examples),
// a search over designs and catalog beads, and a start for each technique.

import { catalogFromFiles } from "../src/catalog/catalog.js";
import { DESIGN_KINDS, type DesignKind, type FeedItem, isPinned, KIND_LABELS, matchesDesign, orderFeed, setPinned } from "../src/collection/designs.js";
import { addOwned, hasOwned, type MyBeads, removeOwned, ownedId } from "../src/collection/my-beads.js";
import { allBeadSizes, catalogColors, resolveBeadSize } from "../src/flat/beads.js";
import { designCard, esc } from "./design-card.js";
import { loadMyDesigns, onMyDesignsChange, saveMyDesigns } from "./designs-store.js";
import { EXAMPLES } from "./examples.js";
import { loadMyBeads, onMyBeadsChange, saveMyBeads } from "./my-beads-store.js";
import { renderNav } from "./nav.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

renderNav("home");

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  notice: $("notice"),
  search: $<HTMLInputElement>("search"),
  kindFilter: $("kind-filter"),
  startRow: $("start-row"),
  beadResults: $("bead-results"),
  beadCount: $("bead-results-count"),
  beadList: $<HTMLUListElement>("bead-list"),
  pinned: $("pinned"),
  pinnedList: $("pinned-list"),
  feedTitle: $("feed-title"),
  feedCount: $("feed-count"),
  feedList: $("feed-list"),
};

/** Every catalog bead once, with what search looks in. */
const catalogBeads = (() => {
  const seen = new Map<string, { entry: string; code: string; name: string; rgb: string; sizeLabel: string; text: string }>();
  for (const { text: sizeText, label } of allBeadSizes(catalog)) {
    for (const c of catalogColors(resolveBeadSize(catalog, sizeText))) {
      if (seen.has(c.entry)) continue;
      const code = c.entry.replace(/^\S+ /, "");
      seen.set(c.entry, { ...c, code, sizeLabel: label, text: `${c.entry} ${c.name} ${label}`.toLowerCase() });
    }
  }
  return [...seen.values()];
})();

const BEAD_LIMIT = 48;

let designs = loadMyDesigns();
let beads: MyBeads = loadMyBeads();
let kind: DesignKind | "all" = "all";

function render(): void {
  const query = els.search.value.trim();
  els.kindFilter.innerHTML = (["all", ...DESIGN_KINDS] as const)
    .map((k) => `<button type="button" role="radio" class="chip" data-kind="${k}" aria-checked="${k === kind}">${k === "all" ? "All" : esc(KIND_LABELS[k])}</button>`)
    .join("");
  els.startRow.hidden = !!query;
  renderBeads(query);
  renderDesigns(query);
}

function renderDesigns(query: string): void {
  const mine: FeedItem[] = designs.designs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, yaml: d.yaml, updated: d.updated }));
  const items = orderFeed([...mine, ...EXAMPLES], designs.pinned).filter(
    (item) => (kind === "all" || item.kind === kind) && (!query || matchesDesign(item, query)),
  );
  const card = (item: FeedItem) => designCard(item, catalog, { pinned: isPinned(designs, item.id) });
  const pinned = query ? [] : items.filter((item) => isPinned(designs, item.id));
  const rest = query ? items : items.filter((item) => !isPinned(designs, item.id));
  els.pinned.hidden = pinned.length === 0;
  els.pinnedList.innerHTML = pinned.map(card).join("");
  els.feedTitle.textContent = query ? "Designs" : "New";
  els.feedCount.textContent = !query ? "" : items.length ? `${items.length} match${items.length === 1 ? "" : "es"}` : "none match";
  els.feedList.innerHTML = rest.length
    ? rest.map(card).join("")
    : `<p class="muted feed-empty">${query ? `No design matches “${esc(query)}”.` : "Everything here is pinned."}</p>`;
}

function renderBeads(query: string): void {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // A bead search needs something to go on: at least two letters or a digit.
  if (!words.length || (query.length < 2 && !/\d/.test(query))) {
    els.beadResults.hidden = true;
    return;
  }
  const found = catalogBeads.filter((b) => words.every((w) => b.text.includes(w)));
  els.beadResults.hidden = found.length === 0;
  els.beadCount.textContent = found.length > BEAD_LIMIT ? `first ${BEAD_LIMIT} of ${found.length}` : `${found.length}`;
  els.beadList.innerHTML = found
    .slice(0, BEAD_LIMIT)
    .map((b) => {
      const on = hasOwned(beads, { kind: "catalog", bead: b.entry });
      return `<li><button type="button" class="color-chip" aria-pressed="${on}" data-entry="${esc(b.entry)}" title="${esc(`${b.code} ${b.name} · ${b.sizeLabel}. ${on ? "In my beads: click to take it off." : "Click to add to my beads."}`)}">
        <span class="swatch big" style="background:${esc(b.rgb)}"></span>
        <span class="color-chip-text"><b class="mono">${esc(b.code)}</b><span class="muted">${esc(b.name)}</span><span class="muted">${esc(b.sizeLabel)}</span></span>
        <span class="color-chip-check" aria-hidden="true">${on ? "✓" : "+"}</span>
      </button></li>`;
    })
    .join("");
}

// ---- Events ----

els.search.addEventListener("input", render);

els.kindFilter.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
  if (!button) return;
  kind = button.dataset.kind as DesignKind | "all";
  render();
});

document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action=pin]");
  const id = button?.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (!id) return;
  designs = setPinned(loadMyDesigns(), id, !isPinned(designs, id));
  if (!saveMyDesigns(designs)) showNotice("This browser won't keep your pins (storage is off, as in a private window).");
  render();
});

els.beadList.addEventListener("click", (event) => {
  const entry = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-entry]")?.dataset.entry;
  if (!entry) return;
  const bead = { kind: "catalog" as const, bead: entry };
  beads = hasOwned(beads, bead) ? removeOwned(beads, ownedId(bead)) : addOwned(beads, bead);
  if (!saveMyBeads(beads)) showNotice("This browser won't keep your beads (storage is off, as in a private window).");
  render();
});

// Changed in another tab.
onMyDesignsChange(() => {
  designs = loadMyDesigns();
  render();
});
onMyBeadsChange(() => {
  beads = loadMyBeads();
  render();
});
// Back from a designer: the feed may have changed.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  designs = loadMyDesigns();
  beads = loadMyBeads();
  render();
});

let noticeTimer: number | undefined;
function showNotice(html: string): void {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (els.notice.hidden = true), 6000);
}

render();
