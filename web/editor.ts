// Pattern editor for bead designers: write a pattern with a form (or as YAML)
// and see the chart update as you type. Beads can be painted straight onto
// the chart. The pattern goes through the same parser and compiler as the
// step viewer, so whatever the editor accepts, the viewer shows.

import { type Catalog, catalogFromFiles, type ResolvedBead, resolveBeads } from "../src/catalog/catalog.js";
import { layoutPattern } from "../src/diagram/layout.js";
import { type DiagramInput, renderChartSheetSvg, renderChartSvg, renderSheetSvg } from "../src/diagram/svg.js";
import {
  type Draft,
  type DraftBead,
  DraftError,
  draftFromYaml,
  draftToYaml,
  emptyDraft,
  isValidKey,
  MIN_START_BEADS,
  newRound,
  nextBeadKey,
  paintBead,
  paintRound,
  renameBeadKey,
  roundRanges,
  startBeadsText,
  startCountProblem,
  startKind,
} from "../src/editor/draft.js";
import { type CompiledPattern, compilePattern } from "../src/pattern/compile.js";
import { parsePattern, PatternError } from "../src/pattern/load.js";

const patternFiles = import.meta.glob<string>(["../patterns/*.peyote.yaml", "!../patterns/04-christmas-mug-trinket-box.peyote.yaml"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const catalogFiles = import.meta.glob<string>("../catalog/beads/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const catalog = catalogFromFiles(
  Object.entries(catalogFiles).map(([path, text]) => ({ name: path.split("/").pop()!, text })),
);

const examples = Object.entries(patternFiles)
  .map(([path, text]) => ({ id: path.split("/").pop()!.replace(/\.peyote\.ya?ml$/, ""), text }))
  .sort((a, b) => a.id.localeCompare(b.id));

/** Where the editor keeps its work between visits, and how it hands patterns to and from the viewer. */
const STORAGE = {
  draft: "bead-model:editor-draft",
  toViewer: "bead-model:viewer-draft",
  fromViewer: "bead-model:open-in-editor",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  newButton: $<HTMLButtonElement>("new-pattern"),
  newDialog: $<HTMLDialogElement>("new-dialog"),
  newForm: $<HTMLFormElement>("new-form"),
  newName: $<HTMLInputElement>("new-name"),
  newCount: $<HTMLInputElement>("new-count"),
  newHint: $("new-hint"),
  newExample: $<HTMLSelectElement>("new-example"),
  newCancel: $<HTMLButtonElement>("new-cancel"),
  newCreate: $<HTMLButtonElement>("new-create"),
  file: $<HTMLInputElement>("file-input"),
  undo: $<HTMLButtonElement>("undo"),
  redo: $<HTMLButtonElement>("redo"),
  downloadYaml: $<HTMLButtonElement>("download-yaml"),
  openViewer: $<HTMLButtonElement>("open-viewer"),
  notice: $("notice"),
  tabForm: $<HTMLButtonElement>("tab-form"),
  tabYaml: $<HTMLButtonElement>("tab-yaml"),
  title: $<HTMLInputElement>("f-title"),
  source: $<HTMLInputElement>("f-source"),
  status: $<HTMLSelectElement>("f-status"),
  stepUp: $<HTMLSelectElement>("f-stepup"),
  addBead: $<HTMLButtonElement>("add-bead"),
  beadList: $<HTMLUListElement>("bead-list"),
  startKind: $<HTMLSelectElement>("f-start-kind"),
  start: $<HTMLInputElement>("f-start"),
  startStatus: $("start-status"),
  roundList: $<HTMLOListElement>("round-list"),
  addRound: $<HTMLButtonElement>("add-round"),
  yaml: $<HTMLTextAreaElement>("yaml"),
  yamlStatus: $("yaml-status"),
  chartTitle: $("chart-title"),
  chartSubtitle: $("chart-subtitle"),
  toolBead: $<HTMLButtonElement>("tool-bead"),
  toolRound: $<HTMLButtonElement>("tool-round"),
  palette: $("palette"),
  chart: $("chart"),
  chartFocus: $<HTMLStyleElement>("chart-focus"),
  tooltip: $("tooltip"),
  stepUpToggle: $<HTMLInputElement>("stepup-toggle"),
  downloadChart: $<HTMLButtonElement>("download-chart"),
  downloadSteps: $<HTMLButtonElement>("download-steps"),
  problems: $("problems"),
};

interface Built {
  /** The pattern as far as it compiles. Missing when even the start is wrong. */
  input?: DiagramInput;
  /** True when the whole pattern compiled, not only the rounds before a mistake. */
  complete: boolean;
  /** Problems by where they show: the start, a draft round (by index), or the pattern as a whole. */
  errors: { start: string[]; rounds: Map<number, string[]>; general: string[] };
  warnings: { rounds: Map<number, string[]>; general: string[] };
}

const state: {
  draft: Draft;
  built: Built;
  resolved: Map<string, ResolvedBead>;
  /** The bead key to paint with. */
  paint: string;
  tool: "bead" | "round";
  tab: "form" | "yaml";
  /** Snapshots for undo and redo, as JSON. */
  past: string[];
  future: string[];
  /** The last committed snapshot. */
  saved: string;
} = {
  draft: emptyDraft(),
  built: emptyBuilt(),
  resolved: new Map(),
  paint: "A",
  tool: "bead",
  tab: "form",
  past: [],
  future: [],
  saved: "",
};

// ---- Building the chart ----

function emptyBuilt(): Built {
  return {
    complete: false,
    errors: { start: [], rounds: new Map(), general: [] },
    warnings: { rounds: new Map(), general: [] },
  };
}

/**
 * Compiles the draft. When a round has a mistake, the rounds before it are
 * compiled on their own, so the chart still shows everything up to it.
 */
function build(draft: Draft): Built {
  const built = emptyBuilt();
  const ranges = roundRanges(draft);
  const rowOf = (round: number) => ranges.findIndex((r) => r.from <= round && round <= r.to);
  const file = (issues: string[], into: { rounds: Map<number, string[]>; general: string[] }, start?: string[]) => {
    for (const issue of issues) {
      const m = /^round (\d+): (.*)$/.exec(issue);
      const row = m ? rowOf(Number(m[1])) : -1;
      if (row >= 0) {
        const list = into.rounds.get(row) ?? [];
        list.push(ranges[row]!.from === ranges[row]!.to ? m![2]! : issue);
        into.rounds.set(row, list);
      } else if (start && /^start\b/.test(issue)) start.push(issue.replace(/^start:\s*/, ""));
      else into.general.push(issue);
    }
  };

  const compile = (d: Draft): CompiledPattern => compilePattern(parsePattern(draftToYaml(d)));
  let compiled: CompiledPattern | undefined;
  try {
    compiled = compile(draft);
    built.complete = true;
  } catch (e) {
    const issues = e instanceof PatternError ? e.issues : [String(e)];
    file(issues, built.errors, built.errors.start);
    // The chart up to the first round with a mistake.
    const firstBad = Math.min(...[...built.errors.rounds.keys()]);
    if (built.errors.start.length === 0 && Number.isFinite(firstBad)) {
      try {
        compiled = compile({ ...draft, rounds: draft.rounds.slice(0, firstBad) });
      } catch {
        compiled = undefined;
      }
    }
  }

  if (compiled) {
    const beads = resolveBeads(compiled.pattern.beads, catalog);
    built.input = { compiled, beads, layout: layoutPattern(compiled, beads) };
    file(compiled.warnings, built.warnings);
    built.warnings.general.push(...[...beads.values()].flatMap((b) => b.warnings));
  }
  return built;
}

/** Recompiles and redraws everything that depends on the pattern, but not the form fields being typed in. */
function refresh(): void {
  state.built = build(state.draft);
  state.resolved = resolveBeads(Object.fromEntries(state.draft.beads.map((b) => [b.key, b.spec])), catalog);
  if (!state.draft.beads.some((b) => b.key === state.paint)) state.paint = state.draft.beads[0]?.key ?? "";
  renderChart();
  renderPalette();
  renderStatuses();
  renderProblems();
  save();
}

function renderChart(): void {
  const { input, complete } = state.built;
  const { draft } = state;
  els.chartTitle.textContent = draft.title || "Untitled";
  if (!input) {
    els.chart.innerHTML = `<p class="chart-empty">Fix the start ring to see the chart.</p>`;
    els.chartSubtitle.textContent = "";
    return;
  }
  els.chart.innerHTML = renderChartSvg(input, { stepUps: els.stepUpToggle.checked });
  const { compiled } = input;
  const last = compiled.rounds[compiled.rounds.length - 1]!;
  els.chartSubtitle.textContent = [
    `${last.round} rounds`,
    `${compiled.beads.length} beads`,
    `${last.beads.length} in the last round`,
    complete ? undefined : "showing the rounds before the first mistake",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---- Left panel: the form ----

/** Fills every form field from the draft. Used after loading, undo, and structural changes. */
function renderForm(): void {
  const { draft } = state;
  els.title.value = draft.title;
  els.source.value = draft.source;
  els.status.value = ["", "unverified", "verified"].includes(draft.status) ? draft.status : "";
  els.stepUp.value = draft.stepUp;
  els.startKind.value = startKind(draft.start);
  els.start.value = startBeadsText(draft.start);
  renderBeadList();
  renderRoundList();
}

function renderBeadList(): void {
  els.beadList.innerHTML = state.draft.beads.map((bead, i) => beadRow(bead, i)).join("");
}

function beadRow(bead: DraftBead, index: number): string {
  const resolved = state.resolved.get(bead.key);
  const kind = beadKind(bead.spec);
  const rgb = resolved?.display.rgb ?? "#999999";
  let fields: string;
  if (kind === "catalog") {
    const code = typeof bead.spec === "string" ? bead.spec : String((bead.spec as Record<string, unknown>).bead);
    fields = `<select data-field="product" aria-label="Catalog bead">${productOptions(code)}</select>`;
  } else if (kind === "generic") {
    const spec = bead.spec as Record<string, unknown>;
    const shape = String(spec.shape ?? "round");
    const size = String(spec.size ?? "11/0");
    const shapes = [...(catalog.get("generic")?.lines.keys() ?? [])];
    const sizes = [...(catalog.get("generic")?.lines.get(shape)?.sizes.keys() ?? [])];
    fields = `
      <select data-field="shape" aria-label="Shape">${shapes.map((s) => option(s, s, s === shape)).join("")}</select>
      <select data-field="size" aria-label="Size">${sizes.map((s) => option(s, s, s === size)).join("")}</select>
      <input type="text" data-field="color" value="${esc(String(spec.color ?? ""))}" placeholder="color name" aria-label="Color name" />
      <input type="color" data-field="rgb" value="${esc(toHex(rgb))}" aria-label="Display color" />`;
  } else {
    fields = `<code class="custom-spec">${esc(JSON.stringify(bead.spec))}</code><span class="muted">Edit in the YAML tab</span>`;
  }
  return `<li class="bead-item${bead.key === state.paint ? " active" : ""}" data-index="${index}">
    <button type="button" class="bead-pick" data-action="paint" aria-label="Paint with ${esc(bead.key)}" title="Paint with ${esc(bead.key)}">
      <span class="swatch big" style="background:${esc(rgb)}"></span>
    </button>
    <input type="text" class="key-input mono" data-field="key" value="${esc(bead.key)}" aria-label="Bead key" maxlength="6" />
    <select data-field="kind" aria-label="Bead from">
      ${option("catalog", "Catalog", kind === "catalog")}
      ${option("generic", "Generic", kind === "generic")}
      ${kind === "custom" ? option("custom", "Custom", true) : ""}
    </select>
    <span class="bead-fields">${fields}</span>
    <span class="bead-meta muted" data-count></span>
    <button type="button" class="icon-button" data-action="delete" aria-label="Delete bead ${esc(bead.key)}" title="Delete">✕</button>
    <span class="bead-label muted">${esc(resolved?.label ?? "")}</span>
  </li>`;
}

function beadKind(spec: unknown): "catalog" | "generic" | "custom" {
  if (typeof spec === "string") return "catalog";
  if (isRecord(spec) && typeof spec.bead === "string") return "catalog";
  if (isRecord(spec) && spec.brand !== undefined) return "custom";
  return "generic";
}

/** Every catalog bead with a color, by brand and line, for the bead picker. */
const products = catalogProducts(catalog);

function catalogProducts(catalog: Catalog): { group: string; items: { code: string; label: string }[] }[] {
  const groups: { group: string; items: { code: string; label: string }[] }[] = [];
  for (const brand of catalog.values()) {
    if (brand.id === "generic") continue;
    for (const line of brand.lines.values()) {
      const items: { code: string; label: string }[] = [];
      for (const size of line.sizes.values()) {
        for (const color of line.colors.values()) {
          if (color.sizes && !color.sizes.includes(size.code)) continue;
          const product = line.code.replaceAll("{size}", size.code).replaceAll("{color}", color.code);
          items.push({ code: `${brand.id} ${product}`, label: `${size.label} · ${product}${color.name ? ` ${color.name}` : ""}` });
        }
      }
      if (items.length) groups.push({ group: `${brand.name} ${line.name}`, items });
    }
  }
  return groups;
}

function productOptions(selected: string): string {
  const known = products.some((g) => g.items.some((i) => i.code === selected));
  return [
    known ? "" : option(selected, `${selected} (not in the catalog)`, true),
    ...products.map(
      (g) => `<optgroup label="${esc(g.group)}">${g.items.map((i) => option(i.code, i.label, i.code === selected)).join("")}</optgroup>`,
    ),
  ].join("");
}

function renderRoundList(): void {
  const { draft } = state;
  const ranges = roundRanges(draft);
  const tube = startKind(draft.start) === "tube";
  if (draft.rounds.length === 0) {
    els.roundList.innerHTML = `<li class="round-empty muted">No rounds yet. Add the first round after the start ring.</li>`;
    return;
  }
  els.roundList.innerHTML = draft.rounds
    .map((round, i) => {
      const { from, to } = ranges[i]!;
      const label = from === to ? `Round ${from}` : `Rounds ${from}–${to}`;
      return `<li class="round-item" data-index="${i}">
        <div class="round-item-head">
          <span class="round-num${String(to).length > 1 && from !== to ? " wide" : ""}" data-label>${from === to ? from : `${from}–${to}`}</span>
          <span class="round-item-title" data-title>${label}</span>
          <label class="repeat" title="How many rounds use this instruction">×<input type="number" data-field="count" min="1" max="200" value="${round.count}" aria-label="Number of rounds" /></label>
          <span class="spacer"></span>
          <button type="button" class="icon-button" data-action="up" aria-label="Move up" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="icon-button" data-action="down" aria-label="Move down" title="Move down" ${i === draft.rounds.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="icon-button" data-action="duplicate" aria-label="Duplicate" title="Duplicate">⧉</button>
          <button type="button" class="icon-button" data-action="delete" aria-label="Delete" title="Delete">✕</button>
        </div>
        <input type="text" class="mono stitch-input" data-field="stitches" value="${esc(round.stitches)}" spellcheck="false" aria-label="${label} stitches" placeholder="e.g. (1A, 2B) x6" />
        <div class="round-options">
          <select data-field="tension" aria-label="Tension">
            ${option("normal", "normal tension", round.tension === "normal")}
            ${option("tight", "tight", round.tension === "tight")}
            ${option("loose", "loose", round.tension === "loose")}
          </select>
          ${
            tube || round.edge === "back"
              ? `<select data-field="edge" aria-label="Edge">
                  ${option("front", "front edge", round.edge === "front")}
                  ${option("back", "back edge", round.edge === "back")}
                </select>`
              : ""
          }
          <input type="text" data-field="note" value="${esc(round.note)}" placeholder="note for the beader" aria-label="Note" />
        </div>
        <p class="ed-status" data-status></p>
      </li>`;
    })
    .join("");
}

/** Updates the round labels, bead counts and problems in place, without touching the inputs being typed in. */
function renderStatuses(): void {
  const { draft, built } = state;
  const compiled = built.input?.compiled;
  const ranges = roundRanges(draft);

  els.roundList.querySelectorAll<HTMLElement>(".round-item").forEach((li) => {
    const i = Number(li.dataset.index);
    const range = ranges[i];
    if (!range) return;
    const { from, to } = range;
    li.querySelector("[data-label]")!.textContent = from === to ? `${from}` : `${from}–${to}`;
    li.querySelector("[data-label]")!.classList.toggle("wide", from !== to);
    li.querySelector("[data-title]")!.textContent = from === to ? `Round ${from}` : `Rounds ${from}–${to}`;
    const status = li.querySelector<HTMLElement>("[data-status]")!;
    const errors = built.errors.rounds.get(i) ?? [];
    const warnings = built.warnings.rounds.get(i) ?? [];
    const first = compiled?.rounds.find((r) => r.round === from);
    const last = compiled?.rounds.find((r) => r.round === to);
    li.classList.toggle("bad", errors.length > 0);
    li.classList.toggle("unbuilt", !first && errors.length === 0);
    if (errors.length) {
      status.className = "ed-status bad";
      status.textContent = errors.join(" ");
    } else if (first && last) {
      status.className = `ed-status${warnings.length ? " warn" : ""}`;
      status.textContent =
        (first === last
          ? `${first.gaps} gaps → ${first.beads.length} beads`
          : `${first.gaps}→${last.gaps} gaps → ${first.beads.length}–${last.beads.length} beads per round`) +
        (warnings.length ? ` · ${warnings.join(" ")}` : "");
    } else {
      status.className = "ed-status muted";
      status.textContent = "Fix the round above to check this one.";
    }
  });

  if (built.errors.start.length) {
    els.startStatus.className = "ed-status bad";
    els.startStatus.textContent = built.errors.start.join(" ");
  } else if (compiled) {
    const { start } = compiled.pattern;
    els.startStatus.className = "ed-status";
    els.startStatus.textContent =
      start.kind === "center"
        ? `${start.beads.length} beads → round 1, ${start.beads.length} gaps for round 2`
        : `${start.beads.length} beads → rounds 1 and 2, ${start.beads.length / 2} gaps for round 3`;
  } else {
    els.startStatus.textContent = "";
  }

  // Bead counts and labels.
  els.beadList.querySelectorAll<HTMLElement>(".bead-item").forEach((li) => {
    const bead = state.draft.beads[Number(li.dataset.index)];
    if (!bead) return;
    const count = compiled?.beads.filter((b) => b.key === bead.key).length ?? 0;
    const resolved = state.resolved.get(bead.key);
    const grams = resolved?.beadsPerGram && count ? ` · ${(count / resolved.beadsPerGram).toFixed(1)} g` : "";
    li.querySelector("[data-count]")!.textContent = `${count}${grams}`;
    li.querySelector(".bead-label")!.textContent = resolved ? `${resolved.label}, ${resolved.outerDiameter} × ${resolved.length} mm` : "";
    li.querySelector<HTMLElement>(".swatch")!.style.background = resolved?.display.rgb ?? "#999";
    li.classList.toggle("active", bead.key === state.paint);
  });
}

function renderProblems(): void {
  const { errors, warnings } = state.built;
  const items = [
    ...errors.general.map((e) => `<li class="bad">${esc(e)}</li>`),
    ...warnings.general.map((w) => `<li>${esc(w)}</li>`),
  ];
  const roundErrors = [...errors.rounds.values()].flat().length + errors.start.length;
  if (roundErrors) {
    items.unshift(
      `<li class="bad">${roundErrors} problem${roundErrors === 1 ? "" : "s"} in the rounds or start. They are marked in red on the left.</li>`,
    );
  }
  els.problems.hidden = items.length === 0;
  els.problems.innerHTML = `<h2>Check</h2><ul>${items.join("")}</ul>`;
}

function renderPalette(): void {
  els.palette.innerHTML = state.draft.beads
    .map((bead) => {
      const resolved = state.resolved.get(bead.key);
      const rgb = resolved?.display.rgb ?? "#999";
      const on = bead.key === state.paint;
      return `<button type="button" role="radio" aria-checked="${on}" data-key="${esc(bead.key)}" title="${esc(resolved?.label ?? bead.key)}">
        <span class="swatch big" style="background:${esc(rgb)}"></span>${esc(bead.key)}</button>`;
    })
    .join("");
}

// ---- Changing the draft ----

/** Applies a change that alters the shape of the form (adds or removes rows, renames keys). */
function change(next: Draft): void {
  state.draft = next;
  refresh();
  renderForm();
  renderStatuses();
  commit();
}

/** Records the current draft for undo, if it changed since the last record. */
function commit(): void {
  const now = JSON.stringify(state.draft);
  if (now === state.saved) return;
  if (state.saved) state.past.push(state.saved);
  if (state.past.length > 200) state.past.shift();
  state.future = [];
  state.saved = now;
  updateUndo();
}

function restore(snapshot: string): void {
  state.draft = JSON.parse(snapshot) as Draft;
  state.saved = snapshot;
  refresh();
  renderForm();
  renderStatuses();
  if (state.tab === "yaml") els.yaml.value = draftToYaml(state.draft);
  updateUndo();
}

function undo(): void {
  // Text still being typed hasn't been recorded yet: record it, so redo can bring it back.
  commit();
  const previous = state.past.pop();
  if (!previous) return;
  state.future.push(state.saved);
  restore(previous);
}

function redo(): void {
  const next = state.future.pop();
  if (!next) return;
  state.past.push(state.saved);
  restore(next);
}

function updateUndo(): void {
  els.undo.disabled = state.past.length === 0;
  els.redo.disabled = state.future.length === 0;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE.draft, JSON.stringify(state.draft));
  } catch {
    // Storage can be off (private windows). The editor still works, it just won't remember.
  }
}

// ---- Events: pattern details and start ----

const typing = (el: HTMLInputElement | HTMLSelectElement, apply: (value: string) => void) => {
  el.addEventListener("input", () => {
    apply(el.value);
    refresh();
  });
  el.addEventListener("change", commit);
};
typing(els.title, (v) => (state.draft.title = v));
typing(els.source, (v) => (state.draft.source = v));
typing(els.status, (v) => (state.draft.status = v));
typing(els.stepUp, (v) => (state.draft.stepUp = v === "first" ? "first" : "group"));
typing(els.start, (v) => (state.draft.start = `${els.startKind.value} ${v}`));

els.startKind.addEventListener("change", () => {
  // A ring and a tube start number their rounds differently, so the round labels change too.
  const kind = els.startKind.value as "center" | "tube";
  let beads = els.start.value;
  if (kind === "tube" && !beads.trim()) beads = "(1A) x16";
  const rounds = kind === "center" ? state.draft.rounds.map((r) => ({ ...r, edge: "front" as const })) : state.draft.rounds;
  change({ ...state.draft, start: `${kind} ${beads}`, rounds });
});

// ---- Events: beads ----

els.addBead.addEventListener("click", () => {
  const key = nextBeadKey(state.draft);
  const palette = ["#4e79a7", "#e15759", "#f2b134", "#59a14f", "#b07aa1", "#76b7b2", "#ff9da7", "#9c755f"];
  const rgb = palette[state.draft.beads.length % palette.length]!;
  state.paint = key;
  change({
    ...state.draft,
    beads: [...state.draft.beads, { key, spec: { size: "11/0", shape: "cylinder", color: "", display: { rgb } } }],
  });
});

els.beadList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const li = target.closest<HTMLElement>(".bead-item");
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!li || !action) return;
  const bead = state.draft.beads[Number(li.dataset.index)]!;
  if (action === "paint") {
    state.paint = bead.key;
    renderPalette();
    renderStatuses();
  } else if (action === "delete") {
    change({ ...state.draft, beads: state.draft.beads.filter((b) => b !== bead) });
  }
});

els.beadList.addEventListener("input", (event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const li = el.closest<HTMLElement>(".bead-item");
  const field = el.dataset.field;
  if (!li || !field || field === "key" || field === "kind") return;
  const index = Number(li.dataset.index);
  const bead = state.draft.beads[index]!;
  const spec: Record<string, unknown> = isRecord(bead.spec) ? { ...bead.spec } : { bead: bead.spec };
  if (field === "product") {
    bead.spec = isRecord(bead.spec) ? { ...spec, bead: el.value } : el.value;
  } else if (field === "rgb") {
    bead.spec = { ...spec, display: { ...(isRecord(spec.display) ? spec.display : {}), rgb: el.value } };
  } else {
    bead.spec = { ...spec, [field]: el.value };
  }
  refresh();
  // A new shape has its own sizes, and a new product its own label: redraw the row.
  if (field === "shape" || field === "product") {
    renderBeadList();
    renderStatuses();
  }
});

els.beadList.addEventListener("change", (event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const li = el.closest<HTMLElement>(".bead-item");
  if (!li) return;
  const bead = state.draft.beads[Number(li.dataset.index)]!;
  if (el.dataset.field === "key") {
    const key = el.value.trim();
    if (!isValidKey(key) || state.draft.beads.some((b) => b !== bead && b.key === key)) {
      el.value = bead.key;
      showNotice(`"${key}" can't be used as a bead key: use a letter, then letters or digits, not used by another bead.`);
      return;
    }
    if (state.paint === bead.key) state.paint = key;
    change(renameBeadKey(state.draft, bead.key, key));
  } else if (el.dataset.field === "kind") {
    const rgb = state.resolved.get(bead.key)?.display.rgb ?? "#4e79a7";
    const spec =
      el.value === "catalog"
        ? (products[0]?.items[0]?.code ?? "miyuki DB-0010")
        : { size: "11/0", shape: "cylinder", color: "", display: { rgb } };
    change({ ...state.draft, beads: state.draft.beads.map((b) => (b === bead ? { ...b, spec } : b)) });
  } else {
    commit();
  }
});

els.palette.addEventListener("click", (event) => {
  const key = (event.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key;
  if (!key) return;
  state.paint = key;
  renderPalette();
  renderStatuses();
});

// ---- Events: rounds ----

els.addRound.addEventListener("click", () => {
  const compiled = state.built.input?.compiled;
  const last = compiled?.rounds[compiled.rounds.length - 1];
  const key = state.paint || state.draft.beads[0]?.key || "A";
  // One bead per gap: the next round needs as many stitches as the last round added beads.
  const gaps = last && state.built.complete ? last.beads.length : undefined;
  const stitches = gaps ? `(1${key}) x${gaps}` : `1${key}*`;
  change({ ...state.draft, rounds: [...state.draft.rounds, newRound(stitches)] });
  els.roundList.querySelector<HTMLInputElement>(".round-item:last-child .stitch-input")?.focus();
});

els.roundList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const li = target.closest<HTMLElement>(".round-item");
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!li || !action) return;
  const i = Number(li.dataset.index);
  const rounds = [...state.draft.rounds];
  if (action === "delete") rounds.splice(i, 1);
  else if (action === "duplicate") rounds.splice(i + 1, 0, { ...rounds[i]! });
  else if (action === "up" && i > 0) [rounds[i - 1], rounds[i]] = [rounds[i]!, rounds[i - 1]!];
  else if (action === "down" && i < rounds.length - 1) [rounds[i + 1], rounds[i]] = [rounds[i]!, rounds[i + 1]!];
  change({ ...state.draft, rounds });
});

els.roundList.addEventListener("input", (event) => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const li = el.closest<HTMLElement>(".round-item");
  const field = el.dataset.field;
  if (!li || !field) return;
  const round = state.draft.rounds[Number(li.dataset.index)]!;
  if (field === "count") {
    const count = Math.floor(Number(el.value));
    if (!(count >= 1)) return;
    round.count = Math.min(count, 200);
  } else if (field === "tension") round.tension = el.value as typeof round.tension;
  else if (field === "edge") round.edge = el.value as typeof round.edge;
  else if (field === "stitches" || field === "note") round[field] = el.value;
  refresh();
});
els.roundList.addEventListener("change", commit);

// Hovering a round row highlights its beads in the chart.
els.roundList.addEventListener("pointerover", (event) => {
  const li = (event.target as HTMLElement).closest<HTMLElement>(".round-item");
  const range = li ? roundRanges(state.draft)[Number(li.dataset.index)] : undefined;
  focusRounds(range ? range : undefined);
});
els.roundList.addEventListener("pointerleave", () => focusRounds(undefined));

function focusRounds(range: { from: number; to: number } | undefined): void {
  if (!range) {
    els.chartFocus.textContent = "";
    return;
  }
  const rounds = Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i);
  els.chartFocus.textContent = `.chart [data-round]:not(${rounds.map((r) => `[data-round="${r}"]`).join(",")}) { opacity: 0.25; }`;
}

// ---- Events: painting on the chart ----

let stroke: { painted: Set<number> } | undefined;

function paintAt(target: EventTarget | null, wholeRound: boolean): void {
  const input = state.built.input;
  const id = beadAt(target);
  if (!input || id === undefined || !state.paint || !stroke || stroke.painted.has(id)) return;
  const bead = input.compiled.beads[id]!;
  stroke.painted.add(id);
  if (wholeRound) {
    for (const b of input.compiled.beads) if (b.round === bead.round) stroke.painted.add(b.id);
    state.draft = paintRound(state.draft, input.compiled, bead.round, state.paint);
  } else {
    if (bead.key === state.paint) return;
    state.draft = paintBead(state.draft, input.compiled, id, state.paint);
  }
  refresh();
}

els.chart.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || beadAt(event.target) === undefined) return;
  event.preventDefault();
  stroke = { painted: new Set() };
  paintAt(event.target, event.shiftKey || state.tool === "round");
});

els.chart.addEventListener("pointermove", (event) => {
  // Pointer events stay on the bead that was pressed (touch capture), so look up what is under the pointer.
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (stroke && event.buttons === 1) paintAt(target, event.shiftKey || state.tool === "round");
  const id = beadAt(target);
  if (id === undefined || !state.built.input) {
    els.tooltip.hidden = true;
    return;
  }
  const { compiled, beads } = state.built.input;
  const bead = compiled.beads[id]!;
  els.tooltip.textContent = `Round ${bead.round} · bead ${bead.order} · ${bead.key}: ${beads.get(bead.key)?.label ?? ""}`;
  const card = els.chart.parentElement!.getBoundingClientRect();
  els.tooltip.style.left = `${event.clientX - card.left}px`;
  els.tooltip.style.top = `${event.clientY - card.top}px`;
  els.tooltip.hidden = false;
  if (!stroke) highlightRow(bead.round);
});

const endStroke = () => {
  if (!stroke) return;
  stroke = undefined;
  // Painting splits ranges into rows, so the form has to be redrawn.
  renderForm();
  renderStatuses();
  commit();
};
window.addEventListener("pointerup", endStroke);
window.addEventListener("pointercancel", endStroke);
els.chart.addEventListener("pointerleave", () => {
  els.tooltip.hidden = true;
  highlightRow(undefined);
});

function highlightRow(round: number | undefined): void {
  const ranges = roundRanges(state.draft);
  els.roundList.querySelectorAll<HTMLElement>(".round-item").forEach((li) => {
    const r = ranges[Number(li.dataset.index)];
    li.classList.toggle("hover", round !== undefined && !!r && r.from <= round && round <= r.to);
  });
}

function beadAt(target: EventTarget | null): number | undefined {
  const g = (target as Element | null)?.closest?.("[data-bead]");
  return g ? Number(g.getAttribute("data-bead")) : undefined;
}

function setTool(tool: "bead" | "round"): void {
  state.tool = tool;
  els.toolBead.setAttribute("aria-checked", String(tool === "bead"));
  els.toolRound.setAttribute("aria-checked", String(tool === "round"));
}
els.toolBead.addEventListener("click", () => setTool("bead"));
els.toolRound.addEventListener("click", () => setTool("round"));
els.stepUpToggle.addEventListener("change", renderChart);

// ---- Events: YAML tab ----

function setTab(tab: "form" | "yaml"): void {
  state.tab = tab;
  els.tabForm.setAttribute("aria-selected", String(tab === "form"));
  els.tabYaml.setAttribute("aria-selected", String(tab === "yaml"));
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => (el.hidden = el.dataset.tab !== tab));
  if (tab === "yaml") {
    els.yaml.value = draftToYaml(state.draft);
    els.yamlStatus.hidden = true;
  } else {
    renderForm();
    renderStatuses();
  }
}
els.tabForm.addEventListener("click", () => setTab("form"));
els.tabYaml.addEventListener("click", () => setTab("yaml"));

els.yaml.addEventListener("input", () => {
  try {
    state.draft = draftFromYaml(els.yaml.value);
    els.yamlStatus.hidden = true;
    refresh();
  } catch (e) {
    els.yamlStatus.hidden = false;
    els.yamlStatus.textContent = e instanceof DraftError ? e.message : String(e);
  }
});
els.yaml.addEventListener("change", commit);

// ---- Events: files, examples, export ----

// The New dialog asks how the piece starts and how many beads the start ring has.

/** The default start ring of each kind, used until the designer types their own count. */
const DEFAULT_START = { center: 3, tube: 16 } as const;
let countEdited = false;

function newKind(): "center" | "tube" {
  return els.newForm.querySelector<HTMLInputElement>("input[name=new-kind]:checked")?.value === "tube" ? "tube" : "center";
}

function checkNewForm(): void {
  const kind = newKind();
  const count = Number(els.newCount.value);
  const problem = els.newCount.value.trim() === "" ? "Enter the number of start beads." : startCountProblem(kind, count);
  els.newCount.min = String(MIN_START_BEADS[kind]);
  els.newCount.step = kind === "tube" ? "2" : "1";
  els.newCreate.disabled = problem !== undefined;
  els.newHint.className = `ed-status${problem ? " bad" : ""}`;
  els.newHint.textContent =
    problem ??
    (kind === "center"
      ? `Round 1 is a ring of ${count} beads, so round 2 has ${count} gaps.`
      : `The ${count} beads settle into rounds 1 and 2, ${count / 2} each, so round 3 has ${count / 2} gaps.`);
}

function openNewDialog(): void {
  els.newForm.reset();
  countEdited = false;
  els.newExample.innerHTML = [
    `<option value="" selected>an example…</option>`,
    ...examples.map((e) => `<option value="${esc(e.id)}">${esc(titleOf(e.text) ?? e.id)}</option>`),
  ].join("");
  checkNewForm();
  els.newDialog.showModal();
  els.newName.select();
}

els.newButton.addEventListener("click", openNewDialog);
els.newCancel.addEventListener("click", () => els.newDialog.close());
els.newCount.addEventListener("input", () => {
  countEdited = true;
  checkNewForm();
});
els.newForm.addEventListener("change", (event) => {
  if ((event.target as HTMLInputElement).name !== "new-kind") return;
  // Switching kind swaps in that kind's usual count, unless the designer chose one.
  if (!countEdited) els.newCount.value = String(DEFAULT_START[newKind()]);
  checkNewForm();
});

els.newForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const kind = newKind();
  const count = Number(els.newCount.value);
  if (startCountProblem(kind, count)) return;
  els.newDialog.close();
  load(emptyDraft(kind, count, els.newName.value.trim() || "Untitled pattern"));
  setTab("form");
});

els.newExample.addEventListener("change", () => {
  const example = examples.find((e) => e.id === els.newExample.value);
  if (!example) return;
  els.newDialog.close();
  load({ ...draftFromYaml(example.text), status: "unverified" });
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  els.file.value = "";
  try {
    load(draftFromYaml(await file.text()));
  } catch (e) {
    showNotice(`Couldn't open ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
});

/** Replaces the draft. Undo brings the old one back. */
function load(draft: Draft): void {
  state.paint = draft.beads[0]?.key ?? "";
  change(draft);
  if (state.tab === "yaml") els.yaml.value = draftToYaml(state.draft);
}

els.downloadYaml.addEventListener("click", () => {
  download(`${fileName()}.peyote.yaml`, draftToYaml(state.draft), "text/yaml");
});

els.downloadChart.addEventListener("click", () => {
  if (!needsComplete()) return;
  download(`${fileName()}-chart.svg`, renderChartSheetSvg(state.built.input!), "image/svg+xml");
});

els.downloadSteps.addEventListener("click", () => {
  if (!needsComplete()) return;
  download(`${fileName()}-steps.svg`, renderSheetSvg(state.built.input!), "image/svg+xml");
});

els.openViewer.addEventListener("click", () => {
  if (!needsComplete()) return;
  try {
    localStorage.setItem(STORAGE.toViewer, draftToYaml(state.draft));
  } catch {
    showNotice("The browser won't let this page store the pattern, so it can't be passed to the step viewer. Download the .yaml and open it there.");
    return;
  }
  location.href = "./index.html#pattern=draft";
});

function needsComplete(): boolean {
  if (state.built.complete && state.built.input) return true;
  showNotice("Fix the problems marked in red first.");
  return false;
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileName(): string {
  return (
    state.draft.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pattern"
  );
}

let noticeTimer: number | undefined;
function showNotice(html: string, keep = false): void {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  if (!keep) noticeTimer = window.setTimeout(() => (els.notice.hidden = true), 6000);
}

els.undo.addEventListener("click", undo);
els.redo.addEventListener("click", redo);

document.addEventListener("keydown", (event) => {
  // Text fields keep their own undo.
  if ((event.target as HTMLElement).matches("input[type=text], textarea")) return;
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
});

// ---- Helpers ----

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}

function titleOf(text: string): string | undefined {
  return /^title:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, "");
}

/** `<input type=color>` only takes #rrggbb. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join("")}`;
  return "#999999";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

// ---- Start ----

{
  // A pattern sent from the step viewer wins over the saved draft. The saved
  // draft stays one undo away.
  const stored = readStored(STORAGE.draft);
  const incoming = readStored(STORAGE.fromViewer);
  let saved: Draft | undefined;
  try {
    saved = stored ? (JSON.parse(stored) as Draft) : undefined;
  } catch {
    saved = undefined;
  }
  state.draft = saved ?? draftFromYaml(examples.find((e) => e.id === "03-flat-triangle")?.text ?? draftToYaml(emptyDraft()));
  state.paint = state.draft.beads[0]?.key ?? "";
  refresh();
  renderForm();
  renderStatuses();
  commit();
  if (incoming) {
    try {
      localStorage.removeItem(STORAGE.fromViewer);
    } catch {
      // Nothing to clean up.
    }
    try {
      load(draftFromYaml(incoming));
      if (saved) showNotice("Opened the pattern from the step viewer. Your previous draft is one undo away.");
    } catch (e) {
      showNotice(`Couldn't open the pattern from the viewer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
