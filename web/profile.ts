// My profile: my designs (in every technique) and my beads, kept in this
// browser. Designs can be opened, pinned and deleted here; beads are changed
// on the My beads page.

import { catalogFromFiles } from "../src/catalog/catalog.js";
import {
  DESIGN_KINDS,
  type DesignKind,
  type FeedItem,
  findDesign,
  isPinned,
  KIND_LABELS,
  matchesDesign,
  orderFeed,
  removeDesign,
  setPinned,
} from "../src/collection/designs.js";
import { groupMyBeads } from "../src/collection/my-beads.js";
import { designCard, esc } from "./design-card.js";
import { loadMyDesigns, onMyDesignsChange, saveMyDesigns } from "./designs-store.js";
import { newDesignUrl } from "./examples.js";
import { loadMyBeads, onMyBeadsChange } from "./my-beads-store.js";
import { renderNav } from "./nav.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

renderNav("profile");

const NAME_KEY = "bead-model:profile-name";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  notice: $("notice"),
  avatar: $("avatar"),
  name: $<HTMLInputElement>("name"),
  stats: $("stats"),
  tabDesigns: $<HTMLButtonElement>("tab-designs"),
  tabBeads: $<HTMLButtonElement>("tab-beads"),
  panelDesigns: $("panel-designs"),
  panelBeads: $("panel-beads"),
  kindFilter: $("kind-filter"),
  filter: $<HTMLInputElement>("filter"),
  designList: $("design-list"),
  beadCount: $("bead-count"),
  beadGroups: $("bead-groups"),
};

let designs = loadMyDesigns();
let beads = loadMyBeads();
let kind: DesignKind | "all" = "all";

function render(): void {
  renderHead();
  renderDesigns();
  renderBeads();
}

function renderHead(): void {
  const name = els.name.value.trim();
  els.avatar.textContent = (name.match(/\p{L}|\p{N}/u)?.[0] ?? "★").toUpperCase();
  const n = designs.designs.length;
  const b = beads.beads.length;
  els.stats.textContent = `${n} design${n === 1 ? "" : "s"} · ${b} bead${b === 1 ? "" : "s"} · ${designs.pinned.length} pinned`;
  els.tabDesigns.textContent = `My designs (${n})`;
  els.tabBeads.textContent = `My beads (${b})`;
}

function renderDesigns(): void {
  const counts = new Map(DESIGN_KINDS.map((k) => [k, designs.designs.filter((d) => d.kind === k).length]));
  els.kindFilter.innerHTML = (["all", ...DESIGN_KINDS] as const)
    .map((k) => {
      const label = k === "all" ? "All" : `${KIND_LABELS[k]} · ${counts.get(k)}`;
      return `<button type="button" role="radio" class="chip" data-kind="${k}" aria-checked="${k === kind}">${esc(label)}</button>`;
    })
    .join("");
  const query = els.filter.value.trim();
  const items: FeedItem[] = designs.designs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, yaml: d.yaml, updated: d.updated }));
  const shown = orderFeed(items, designs.pinned).filter((item) => (kind === "all" || item.kind === kind) && (!query || matchesDesign(item, query)));
  if (shown.length) {
    els.designList.innerHTML = shown.map((item) => designCard(item, catalog, { pinned: isPinned(designs, item.id), deletable: true })).join("");
  } else if (items.length) {
    els.designList.innerHTML = `<p class="muted feed-empty">No design of yours matches.</p>`;
  } else {
    const starts = DESIGN_KINDS.map((k) => `<a class="button small" href="${newDesignUrl(k)}">+ ${esc(KIND_LABELS[k])}</a>`).join(" ");
    els.designList.innerHTML = `<div class="feed-empty"><p class="muted">No designs yet. Anything you make in a designer shows up here.</p><p>${starts}</p></div>`;
  }
}

function renderBeads(): void {
  const groups = groupMyBeads(beads, catalog);
  const n = beads.beads.length;
  els.beadCount.textContent = n ? `${n} bead${n === 1 ? "" : "s"} in ${groups.length} size${groups.length === 1 ? "" : "s"}` : "";
  els.beadGroups.innerHTML = groups.length
    ? groups
        .map(
          (g) => `<div class="mine-group"><h3>${esc(g.label)} <span class="muted">· ${g.beads.length}</span></h3>
          <ul class="bead-swatches">${g.beads
            .map(
              (b) => `<li title="${esc([b.code, b.name, b.bead.amount, b.bead.note].filter(Boolean).join(" · "))}">
                <span class="swatch big" style="background:${esc(b.rgb)}"></span>
                <span class="bead-swatch-text"><b class="mono">${esc(b.code)}</b><span class="muted">${esc(b.name)}</span>${b.bead.amount ? `<span class="muted">${esc(b.bead.amount)}</span>` : ""}</span>
              </li>`,
            )
            .join("")}</ul></div>`,
        )
        .join("")
    : `<p class="muted feed-empty">No beads yet. <a href="./beads.html">Add the beads you have</a>, and the designers can build from only those.</p>`;
}

// ---- Tabs ----

function setTab(tab: "designs" | "beads"): void {
  els.tabDesigns.setAttribute("aria-selected", String(tab === "designs"));
  els.tabBeads.setAttribute("aria-selected", String(tab === "beads"));
  els.panelDesigns.hidden = tab !== "designs";
  els.panelBeads.hidden = tab !== "beads";
  history.replaceState(null, "", tab === "beads" ? "#beads" : location.pathname);
}

els.tabDesigns.addEventListener("click", () => setTab("designs"));
els.tabBeads.addEventListener("click", () => setTab("beads"));

// ---- Events ----

els.name.addEventListener("input", () => {
  try {
    localStorage.setItem(NAME_KEY, els.name.value.trim());
  } catch {
    // Storage can be off: the name holds until the page closes.
  }
  renderHead();
});

els.filter.addEventListener("input", renderDesigns);

els.kindFilter.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
  if (!button) return;
  kind = button.dataset.kind as DesignKind | "all";
  renderDesigns();
});

els.designList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  const id = button?.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (!button || !id) return;
  const list = loadMyDesigns();
  if (button.dataset.action === "pin") {
    designs = setPinned(list, id, !isPinned(list, id));
  } else if (button.dataset.action === "delete") {
    const design = findDesign(list, id);
    if (!design || !confirm(`Delete “${design.title}”? This can't be undone. Download it from its designer first to keep a copy.`)) return;
    designs = removeDesign(list, id);
  }
  if (!saveMyDesigns(designs)) showNotice("This browser won't keep the change (storage is off, as in a private window).");
  render();
});

onMyDesignsChange(() => {
  designs = loadMyDesigns();
  render();
});
onMyBeadsChange(() => {
  beads = loadMyBeads();
  render();
});
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

// ---- Start ----

try {
  els.name.value = localStorage.getItem(NAME_KEY) ?? "";
} catch {
  // No storage, no saved name.
}
render();
if (location.hash === "#beads") setTab("beads");
