// My profile: my designs (in every technique), my beads and my palettes, kept
// in this browser. Designs can be opened, pinned and deleted here, and palettes
// renamed, shared and deleted; beads are changed on the My beads page.

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
import { findMyPalette, putMyPalette, removeMyPalette } from "../src/collection/my-palettes.js";
import { readTags } from "../src/collection/palettes.js";
import { loadAccount } from "./account.js";
import { designCard, esc } from "./design-card.js";
import { loadMyDesigns, onMyDesignsChange, saveMyDesigns } from "./designs-store.js";
import { newDesignUrl } from "./examples.js";
import { loadMyBeads, onMyBeadsChange } from "./my-beads-store.js";
import { renderNav } from "./nav.js";
import { addPaletteToMyBeads, COPY_TEXT, myPaletteHead, paletteItem, publicLink, readSize, sizeOptions, writeSize } from "./palette-list.js";
import { openPaletteExport, openPaletteImport } from "./palette-text-dialog.js";
import { loadMyPalettes, saveMyPalettes } from "./palettes-store.js";
import { loadProfileName, saveProfileName } from "./profile-store.js";

const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

renderNav("profile");


const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  notice: $("notice"),
  avatar: $("avatar"),
  name: $<HTMLInputElement>("name"),
  stats: $("stats"),
  tabDesigns: $<HTMLButtonElement>("tab-designs"),
  tabBeads: $<HTMLButtonElement>("tab-beads"),
  tabPalettes: $<HTMLButtonElement>("tab-palettes"),
  panelDesigns: $("panel-designs"),
  panelBeads: $("panel-beads"),
  panelPalettes: $("panel-palettes"),
  paletteSize: $<HTMLSelectElement>("palette-size"),
  paletteList: $<HTMLUListElement>("palette-list"),
  paletteImport: $<HTMLButtonElement>("palette-import"),
  kindFilter: $("kind-filter"),
  filter: $<HTMLInputElement>("filter"),
  designList: $("design-list"),
  beadCount: $("bead-count"),
  beadGroups: $("bead-groups"),
};

let designs = loadMyDesigns();
let beads = loadMyBeads();
let palettes = loadMyPalettes();
let kind: DesignKind | "all" = "all";
/** Who is signed in: only they can make a palette public. */
let userId: string | undefined;

function render(): void {
  renderHead();
  renderDesigns();
  renderBeads();
  renderPalettes();
}

function renderHead(): void {
  const name = els.name.value.trim();
  els.avatar.textContent = (name.match(/\p{L}|\p{N}/u)?.[0] ?? "★").toUpperCase();
  const n = designs.designs.length;
  const b = beads.beads.length;
  els.stats.textContent = `${n} design${n === 1 ? "" : "s"} · ${b} bead${b === 1 ? "" : "s"} · ${designs.pinned.length} pinned`;
  els.tabDesigns.textContent = `My designs (${n})`;
  els.tabBeads.textContent = `My beads (${b})`;
  els.tabPalettes.textContent = `My palettes (${palettes.palettes.length})`;
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

function renderPalettes(): void {
  const context = { size: els.paletteSize.value, catalog, myBeads: beads };
  els.paletteList.innerHTML = palettes.palettes.length
    ? palettes.palettes.map((p) => paletteItem(p, { ...context, head: myPaletteHead(p, userId !== undefined), more: COPY_TEXT })).join("")
    : `<li class="muted feed-empty">No palettes yet. Save one from a design, or <a href="./palettes.html">save a copy</a> of a preset or a public one.</li>`;
}

function changePalettes(next: typeof palettes): void {
  palettes = next;
  if (!saveMyPalettes(palettes)) showNotice("This browser won't keep your palettes (storage is off, as in a private window).");
  render();
}

// ---- Tabs ----

type Tab = "designs" | "beads" | "palettes";

function setTab(tab: Tab): void {
  els.tabDesigns.setAttribute("aria-selected", String(tab === "designs"));
  els.tabBeads.setAttribute("aria-selected", String(tab === "beads"));
  els.tabPalettes.setAttribute("aria-selected", String(tab === "palettes"));
  els.panelDesigns.hidden = tab !== "designs";
  els.panelBeads.hidden = tab !== "beads";
  els.panelPalettes.hidden = tab !== "palettes";
  history.replaceState(null, "", tab === "designs" ? location.pathname : `#${tab}`);
}

els.tabDesigns.addEventListener("click", () => setTab("designs"));
els.tabBeads.addEventListener("click", () => setTab("beads"));
els.tabPalettes.addEventListener("click", () => setTab("palettes"));

// ---- Events ----

els.name.addEventListener("input", () => {
  saveProfileName(els.name.value);
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

els.paletteSize.addEventListener("change", () => {
  writeSize(els.paletteSize.value);
  renderPalettes();
});

els.paletteList.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  const palette = findMyPalette(palettes, target.closest<HTMLElement>("[data-id]")?.dataset.id ?? "");
  if (!action || !palette) return;
  if (action === "add") {
    const added = addPaletteToMyBeads(palette, els.paletteSize.value, catalog);
    beads = loadMyBeads();
    showNotice(added === undefined ? "This browser won't keep your beads (storage is off, as in a private window)." : `Added ${added} bead${added === 1 ? "" : "s"} from ${esc(palette.name)} to my beads.`);
    render();
  } else if (action === "delete") {
    if (confirm(`Delete the palette “${palette.name}”?${palette.visibility === "public" ? " It stops being public too." : ""}`)) changePalettes(removeMyPalette(palettes, palette.id));
  } else if (action === "text") {
    openPaletteExport(palette, catalog);
  } else if (action === "link") {
    const link = publicLink(userId ?? "", palette.id);
    try {
      await navigator.clipboard.writeText(link);
      showNotice(`Copied the link to “${esc(palette.name)}”. Anyone with it can see the palette and save a copy.`);
    } catch {
      showNotice(`The link: ${esc(link)}`);
    }
  }
});

els.paletteImport.addEventListener("click", () =>
  openPaletteImport(catalog, els.paletteSize.value, (name) => {
    palettes = loadMyPalettes();
    showNotice(name === undefined ? "This browser won't keep your palettes (storage is off, as in a private window)." : `Added “${esc(name)}” to my palettes.`);
    render();
  }),
);

els.paletteList.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const palette = findMyPalette(palettes, el.closest<HTMLElement>("[data-id]")?.dataset.id ?? "");
  if (!palette) return;
  if (el.dataset.field === "name") {
    const name = el.value.trim();
    if (name) changePalettes(putMyPalette(palettes, { ...palette, name }));
    else el.value = palette.name;
  } else if (el.dataset.field === "tags") {
    changePalettes(putMyPalette(palettes, { ...palette, tags: readTags(el.value) }));
  } else if (el.dataset.field === "visibility" && userId) {
    const visibility = el.value === "public" ? "public" : "private";
    changePalettes(putMyPalette(palettes, { ...palette, visibility }));
    if (visibility === "public") showNotice(`“${esc(palette.name)}” is public: anyone can find it on the <a href="./palettes.html">Palettes</a> page, with your display name. Copy its link to share it.`);
  }
});

onMyDesignsChange(() => {
  designs = loadMyDesigns();
  if (document.activeElement !== els.name) els.name.value = loadProfileName();
  render();
});
// My beads, my palettes or the color source changed in another tab or a sync. Not while a palette's name is being typed.
onMyBeadsChange(() => {
  beads = loadMyBeads();
  palettes = loadMyPalettes();
  if (!els.paletteList.contains(document.activeElement)) render();
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

els.name.value = loadProfileName();
els.paletteSize.innerHTML = sizeOptions(catalog, readSize());
if (!els.paletteSize.value) els.paletteSize.selectedIndex = 0;
render();
if (location.hash === "#beads" || location.hash === "#palettes") setTab(location.hash.slice(1) as Tab);
void loadAccount().then((account) => {
  userId = account?.user?.id;
  if (userId) renderPalettes();
});
