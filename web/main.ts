// Step-by-step pattern viewer: instruction rows on the left, the diagram of
// the selected step on the right with the other rounds faded. A step is
// usually one round; a tube start strings rounds 1 and 2 in one step.
// The 3D view shows the expected shape of the piece as built up to the step.

import { catalogFromFiles, type ResolvedBead, resolveBeads } from "../src/catalog/catalog.js";
import { DEFAULT_SPACING, layoutPattern, type LayoutOptions } from "../src/diagram/layout.js";
import { type DiagramInput, previousRound, renderDiagramSvg } from "../src/diagram/svg.js";
import { type CompiledPattern, type CompiledStep, compilePattern } from "../src/pattern/compile.js";
import { describeStep, stepLabel, stepNumber, summarizeStitches } from "../src/pattern/describe.js";
import { parsePattern, PatternError } from "../src/pattern/load.js";
import { isShapeEngine, SHAPE_ENGINES, type ShapeEngine, solveShape } from "../src/shape/engines.js";
import { type Shape, type ShapeModel, shapeModel, type Verdict } from "../src/shape/shape.js";
import { renderGrowthChart, VERDICT_COLORS } from "./growth-chart.js";
import type { BeadViewer } from "./viewer3d.js";

// Bundled patterns and catalog, read as text at build time. The Thread A Bead
// pattern is a paid pattern, so it stays out of the app (tests still use it).
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

interface PatternSource {
  id: string;
  name: string;
  text: string;
}

const sources: PatternSource[] = Object.entries(patternFiles)
  .map(([path, text]) => {
    const id = path.split("/").pop()!.replace(/\.peyote\.ya?ml$/, "");
    return { id, name: titleOf(text) ?? id, text };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

// A pattern sent over from the editor ("Step through it"), kept so a reload still shows it.
try {
  const draft = localStorage.getItem("bead-model:viewer-draft");
  if (draft) sources.push({ id: "draft", name: `${titleOf(draft) ?? "Untitled"} (from the editor)`, text: draft });
} catch {
  // Storage can be off (private windows): there is just no draft to show.
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  select: $<HTMLSelectElement>("pattern-select"),
  file: $<HTMLInputElement>("file-input"),
  edit: $<HTMLButtonElement>("edit-pattern"),
  info: $("pattern-info"),
  list: $<HTMLOListElement>("round-list"),
  warnings: $("warnings"),
  title: $("stage-title"),
  subtitle: $("stage-subtitle"),
  upcoming: $<HTMLInputElement>("upcoming-toggle"),
  thread: $<HTMLInputElement>("thread-toggle"),
  roundGap: $<HTMLInputElement>("round-gap"),
  beadGap: $<HTMLInputElement>("bead-gap"),
  roundGapValue: $("round-gap-value"),
  beadGapValue: $("bead-gap-value"),
  diagram: $("diagram"),
  tooltip: $("tooltip"),
  prev: $<HTMLButtonElement>("prev"),
  next: $<HTMLButtonElement>("next"),
  slider: $<HTMLInputElement>("round-slider"),
  error: $("error"),
  view2d: $<HTMLButtonElement>("view-2d"),
  view3d: $<HTMLButtonElement>("view-3d"),
  fade: $<HTMLInputElement>("fade-toggle"),
  shapeColor: $<HTMLInputElement>("shape-color-toggle"),
  engine: $<HTMLSelectElement>("engine-select"),
  viewer: $("viewer3d"),
  key3d: $("key3d"),
  chart: $("growth-chart"),
  chartTooltip: $("chart-tooltip"),
  stage: document.querySelector<HTMLElement>(".stage")!,
};

const state: {
  source?: PatternSource;
  input?: DiagramInput;
  /** Index into compiled.steps. */
  index: number;
  view: "2d" | "3d";
  /** The 3D model of the current pattern, made the first time the 3D view needs it. */
  model?: ShapeModel;
  /** Which 3D model solves the shape. */
  engine: ShapeEngine;
  /** Shapes already solved, by model and step ("tension:3"). */
  shapes: Map<string, Shape>;
  /** Whether the camera has been fitted to the current pattern. */
  framed: boolean;
} = { index: 0, view: "2d", engine: savedEngine(), shapes: new Map(), framed: false };

let viewer: BeadViewer | undefined;

// ---- Loading ----

function loadSource(source: PatternSource, roundNumber?: number): void {
  state.source = source;
  els.select.value = source.id;
  try {
    const pattern = parsePattern(source.text);
    const compiled = compilePattern(pattern);
    const beads = resolveBeads(pattern.beads, catalog);
    state.input = { compiled, beads, layout: layoutPattern(compiled, beads, spacing()) };
    state.model = undefined;
    state.shapes = new Map();
    state.framed = false;
    state.index = Math.max(stepOfRound(compiled, roundNumber), 0);
    els.error.hidden = true;
    els.stage.classList.remove("has-error");
    renderPattern();
    selectStep(state.index);
  } catch (e) {
    state.input = undefined;
    showError(source, e);
  }
}

function showError(source: PatternSource, e: unknown): void {
  const issues = e instanceof PatternError ? e.issues : [e instanceof Error ? e.message : String(e)];
  els.info.innerHTML = `<h2>${esc(source.name)}</h2>`;
  els.list.innerHTML = "";
  els.warnings.hidden = true;
  els.diagram.innerHTML = "";
  els.title.textContent = "This pattern can't be shown";
  els.subtitle.textContent = "Fix the problems below and open it again.";
  els.error.hidden = false;
  els.stage.classList.add("has-error");
  els.error.innerHTML = `<h2>Problems in the pattern</h2><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  setControls(0, 0);
}

// ---- Left column: pattern info and one row per step ----

function renderPattern(): void {
  const { compiled, beads } = state.input!;
  const { pattern } = compiled;
  const verified = pattern.status === "verified";
  const source = pattern.source
    ? /^https?:\/\//.test(pattern.source)
      ? `<a href="${esc(pattern.source)}" target="_blank" rel="noopener">source</a>`
      : esc(pattern.source)
    : "";
  const totals = [...beads.values()].map((bead) => {
    const count = compiled.beads.filter((b) => b.key === bead.key).length;
    const grams = bead.beadsPerGram ? ` · ${formatGrams(count / bead.beadsPerGram)}` : "";
    return `<li>${swatch(bead)}<span><b>${esc(bead.key)}</b>${esc(bead.label)}<br><span class="muted">${bead.outerDiameter} × ${bead.length} mm</span></span><span class="muted">${count}${grams}</span></li>`;
  });

  els.info.innerHTML = `
    <h2>${esc(pattern.title)}${pattern.status ? `<span class="badge${verified ? " ok" : ""}">${esc(pattern.status)}</span>` : ""}</h2>
    <p class="meta muted">${compiled.rounds.length} rounds · ${compiled.beads.length} beads${source ? ` · ${source}` : ""}</p>
    <ul class="bead-legend">${totals.join("")}</ul>`;

  els.list.innerHTML = compiled.steps.map((step, i) => stepRow(compiled, beads, step, i)).join("");

  const warnings = [...compiled.warnings, ...[...beads.values()].flatMap((b) => b.warnings)];
  els.warnings.hidden = warnings.length === 0;
  els.warnings.innerHTML = `<details><summary>${warnings.length} warning${warnings.length === 1 ? "" : "s"}</summary><ul>${warnings
    .map((w) => `<li>${esc(w)}</li>`)
    .join("")}</ul></details>`;

  setControls(compiled.steps.length, state.index);
}

function stepRow(
  compiled: CompiledPattern,
  beads: Map<string, ResolvedBead>,
  step: CompiledStep,
  index: number,
): string {
  const round = step.rounds[0]!;
  const before = previousRound(compiled, index);
  const change = before ? step.beads.length - before.beads.length : 0;
  const delta = before && change !== 0 ? `<span class="delta">${change > 0 ? "+" : ""}${change}</span>` : "";
  const { start } = compiled.pattern;
  const summary =
    round.stitches.length > 0
      ? summarizeStitches(round.stitches)
      : `Start: ${start.kind === "center" ? "ring" : "tube"} of ${start.beads.length}`;
  const tags = [
    round.edge === "back" ? `<span class="tag">back edge</span>` : "",
    round.tension !== "normal" ? `<span class="tag">${round.tension}</span>` : "",
    round.note ? `<span class="tag note">note</span>` : "",
  ].join("");
  const counts = [...beads.values()]
    .map((bead) => [bead, step.beads.filter((id) => compiled.beads[id]!.key === bead.key).length] as const)
    .filter(([, n]) => n > 0)
    .map(([bead, n]) => `<span>${swatch(bead)}${n} ${esc(bead.key)}</span>`)
    .join("");
  const number = stepNumber(step);

  return `<li><button type="button" class="round-row" data-index="${index}" aria-label="${esc(stepLabel(step))}">
    <span class="round-num${number.length > 2 ? " wide" : ""}">${esc(number)}</span>
    <span class="round-title">${step.beads.length} beads ${delta}<span class="tags">${tags}</span></span>
    <span class="round-summary">${esc(summary)}</span>
    <span class="round-detail">
      <p>${esc(describeStep(compiled, step))}</p>
      ${round.note ? `<p><strong>Note:</strong> ${esc(round.note)}</p>` : ""}
      ${round.tension !== "normal" ? `<p>Keep the thread ${round.tension}.</p>` : ""}
      <span class="counts">${counts}</span>
    </span>
  </button></li>`;
}

// ---- Right column: the diagram ----

function selectStep(index: number): void {
  const input = state.input;
  if (!input) return;
  const { compiled } = input;
  const steps = compiled.steps;
  state.index = Math.max(0, Math.min(steps.length - 1, index));
  const step = steps[state.index]!;
  const round = step.rounds[0]!;
  const before = previousRound(compiled, state.index);

  if (state.view === "2d") {
    els.diagram.innerHTML = renderDiagramSvg(input, state.index, {
      numbers: true,
      upcoming: els.upcoming.checked,
      thread: els.thread.checked,
    });
  } else {
    renderShape();
  }
  els.title.textContent = `${stepLabel(step)} of ${compiled.rounds[compiled.rounds.length - 1]!.round}`;
  const change = before ? step.beads.length - before.beads.length : 0;
  els.subtitle.textContent = [
    `${step.beads.length} beads`,
    before ? `${change >= 0 ? "+" : ""}${change} from round ${before.round}` : undefined,
    round.stitches.length > 0 ? `${round.gaps} gaps` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  els.list.querySelectorAll<HTMLButtonElement>(".round-row").forEach((row) => {
    const i = Number(row.dataset.index);
    row.toggleAttribute("aria-current", i === state.index);
    if (i === state.index) row.setAttribute("aria-current", "step");
    row.classList.toggle("done", i < state.index);
  });
  revealRow(els.list.querySelector<HTMLElement>(`[data-index="${state.index}"]`));

  setControls(steps.length, state.index);
  els.tooltip.hidden = true;
  writeHash();
}

/** The step that makes a round, or -1. */
function stepOfRound(compiled: CompiledPattern, round: number | undefined): number {
  return compiled.steps.findIndex((s) => s.rounds.some((r) => r.round === round));
}

/**
 * Scrolls the instruction column so the row shows. Only when the column
 * scrolls by itself (wide screens): on phones the list sits below the
 * diagram, and scrolling the page would move the diagram out of view.
 */
function revealRow(row: HTMLElement | null): void {
  const box = els.list.closest<HTMLElement>(".steps");
  if (!row || !box || box.scrollHeight <= box.clientHeight + 1) return;
  const r = row.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 8, behavior: "smooth" });
  else if (r.bottom > b.bottom) box.scrollBy({ top: r.bottom - b.bottom + 8, behavior: "smooth" });
}

function setControls(count: number, index: number): void {
  els.slider.max = String(Math.max(count - 1, 0));
  els.slider.value = String(index);
  els.slider.disabled = count <= 1;
  els.prev.disabled = index <= 0;
  els.next.disabled = index >= count - 1;
}

// ---- Events ----

els.select.addEventListener("change", () => {
  const source = sources.find((s) => s.id === els.select.value);
  if (source) loadSource(source);
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  const text = await file.text();
  const source = { id: `file:${file.name}`, name: titleOf(text) ?? file.name, text };
  const existing = sources.findIndex((s) => s.id === source.id);
  if (existing >= 0) sources[existing] = source;
  else sources.push(source);
  fillSelect();
  loadSource(source);
  els.file.value = "";
});

// Opens the current pattern in the editor, which picks it up from storage.
els.edit.addEventListener("click", () => {
  if (!state.source) return;
  try {
    localStorage.setItem("bead-model:open-in-editor", state.source.text);
  } catch {
    // Without storage the editor opens with its own draft.
  }
  location.href = "./editor.html";
});

els.list.addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLButtonElement>(".round-row");
  if (row) selectStep(Number(row.dataset.index));
});

els.prev.addEventListener("click", () => selectStep(state.index - 1));
els.next.addEventListener("click", () => selectStep(state.index + 1));
els.slider.addEventListener("input", () => selectStep(Number(els.slider.value)));
els.upcoming.addEventListener("change", () => selectStep(state.index));
els.thread.addEventListener("change", () => selectStep(state.index));

// Spacing between rounds and between beads in a round: lay the beads out again.
for (const slider of [els.roundGap, els.beadGap]) {
  slider.addEventListener("input", () => {
    showSpacing();
    if (!state.input) return;
    const { compiled, beads } = state.input;
    state.input = { compiled, beads, layout: layoutPattern(compiled, beads, spacing()) };
    selectStep(state.index);
  });
}

function spacing(): LayoutOptions {
  return { roundGap: Number(els.roundGap.value), beadGap: Number(els.beadGap.value) };
}

function showSpacing(): void {
  els.roundGapValue.textContent = `${Number(els.roundGap.value).toFixed(2)} mm`;
  els.beadGapValue.textContent = `${Number(els.beadGap.value).toFixed(2)} mm`;
}

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches("input[type=range], select, input[type=file]") || event.metaKey || event.ctrlKey) return;
  const steps = state.input?.compiled.steps.length ?? 0;
  const moves: Record<string, number> = {
    ArrowLeft: state.index - 1,
    ArrowUp: state.index - 1,
    ArrowRight: state.index + 1,
    ArrowDown: state.index + 1,
    Home: 0,
    End: steps - 1,
  };
  if (event.key in moves) {
    event.preventDefault();
    selectStep(moves[event.key]!);
  }
});

// Hovering a bead shows what it is; clicking it jumps to its round.
els.diagram.addEventListener("pointermove", (event) => {
  const bead = beadAt(event.target);
  if (!bead) {
    els.tooltip.hidden = true;
    return;
  }
  showBeadTip(bead, event);
});

function showBeadTip(bead: number, event: PointerEvent): void {
  const { compiled, beads } = state.input!;
  const info = compiled.beads[bead]!;
  const step = compiled.steps[info.step]!;
  const resolved = beads.get(info.key)!;
  const where = step.rounds.length > 1 ? `${stepLabel(step)} (round ${info.round})` : `Round ${info.round}`;
  els.tooltip.textContent = `${where} · bead ${info.order} of ${step.beads.length} · ${info.key}: ${resolved.label}`;
  const card = els.diagram.parentElement!.getBoundingClientRect();
  els.tooltip.style.left = `${event.clientX - card.left}px`;
  els.tooltip.style.top = `${event.clientY - card.top}px`;
  els.tooltip.hidden = false;
}
els.diagram.addEventListener("pointerleave", () => (els.tooltip.hidden = true));
els.diagram.addEventListener("click", (event) => {
  const bead = beadAt(event.target);
  if (bead === undefined || !state.input) return;
  selectStep(state.input.compiled.beads[bead]!.step);
});

function beadAt(target: EventTarget | null): number | undefined {
  const g = (target as Element | null)?.closest?.("[data-bead]");
  return g ? Number(g.getAttribute("data-bead")) : undefined;
}

// ---- 3D view ----

function setView(view: "2d" | "3d"): void {
  state.view = view;
  els.view2d.setAttribute("aria-selected", String(view === "2d"));
  els.view3d.setAttribute("aria-selected", String(view === "3d"));
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((el) => (el.hidden = el.dataset.view !== view));
  els.tooltip.hidden = true;
  viewer?.setActive(view === "3d");
  if (view === "3d" && !viewer) {
    // three.js is only loaded the first time the 3D view is opened.
    void import("./viewer3d.js").then(({ BeadViewer }) => {
      viewer ??= new BeadViewer(els.viewer);
      viewer.setActive(state.view === "3d");
      if (state.view === "3d") selectStep(state.index);
    });
  }
  selectStep(state.index);
}

/** The piece as built up to the current step, solved once per step. */
function renderShape(): void {
  const input = state.input;
  if (!input || !viewer) return;
  state.model ??= shapeModel(input.compiled, input.beads);
  const shapeAt = (step: number) => {
    const key = `${state.engine}:${step}`;
    let shape = state.shapes.get(key);
    if (!shape) state.shapes.set(key, (shape = solveShape(state.model!, state.engine, { upToStep: step })));
    return shape;
  };
  const shape = shapeAt(state.index);
  const colorBy = els.shapeColor.checked ? "shape" : "bead";
  viewer.show(state.model, shape, { step: state.index, highlight: els.fade.checked, colorBy });
  if (!state.framed) {
    // Fit the camera to the finished piece, so it stays put while stepping.
    viewer.frame(shapeAt(input.compiled.steps.length - 1));
    state.framed = true;
  }

  const verdicts = [...new Set(shape.rounds.map((r) => r.verdict))];
  els.key3d.innerHTML =
    colorBy === "shape"
      ? (Object.keys(VERDICT_COLORS) as Verdict[])
          .filter((v) => verdicts.includes(v))
          .map((v) => `<li><span class="key-dot" style="background:${VERDICT_COLORS[v]}"></span>${v}</li>`)
          .join("")
      : [...input.beads.values()]
          .map((b) => `<li>${swatch(b)}${esc(b.key)}</li>`)
          .join("") + (els.fade.checked ? `<li><span class="key-swatch key-done"></span>Earlier steps</li>` : "");

  const current = input.compiled.steps[state.index]!.rounds.map((r) => r.round);
  els.chart.innerHTML = renderGrowthChart(state.model.profiles, shape.rounds, current, els.chart.clientWidth || 600);
}

els.view2d.addEventListener("click", () => setView("2d"));
els.view3d.addEventListener("click", () => setView("3d"));
els.fade.addEventListener("change", () => selectStep(state.index));
els.shapeColor.addEventListener("change", () => selectStep(state.index));
els.engine.innerHTML = Object.entries(SHAPE_ENGINES)
  .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
  .join("");
els.engine.value = state.engine;
els.engine.addEventListener("change", () => {
  if (!isShapeEngine(els.engine.value)) return;
  state.engine = els.engine.value;
  try {
    localStorage.setItem("bead-model:engine", state.engine);
  } catch {
    // Storage can be off: the choice just isn't remembered.
  }
  selectStep(state.index);
});

/** The 3D model chosen last time, or the thread-tension model. */
function savedEngine(): ShapeEngine {
  try {
    const saved = localStorage.getItem("bead-model:engine");
    if (isShapeEngine(saved)) return saved;
  } catch {
    // Storage can be off (private windows).
  }
  return "tension";
}

// Hover a bead for its details; click (without dragging) to go to its step.
let pressed: { x: number; y: number } | undefined;
els.viewer.addEventListener("pointerdown", (e) => (pressed = { x: e.clientX, y: e.clientY }));
els.viewer.addEventListener("pointermove", (event) => {
  if (event.buttons !== 0) return void (els.tooltip.hidden = true);
  const bead = viewer?.pick(event.clientX, event.clientY);
  if (bead === undefined) els.tooltip.hidden = true;
  else showBeadTip(bead, event);
});
els.viewer.addEventListener("pointerleave", () => (els.tooltip.hidden = true));
els.viewer.addEventListener("pointerup", (event) => {
  const moved = pressed ? Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) : Infinity;
  pressed = undefined;
  if (moved > 4 || !state.input) return;
  const bead = viewer?.pick(event.clientX, event.clientY);
  if (bead !== undefined) selectStep(state.input.compiled.beads[bead]!.step);
});

// The chart: hover a round for its numbers, click it to go to that round.
els.chart.addEventListener("pointermove", (event) => {
  const hit = (event.target as Element).closest?.<SVGElement>("[data-tip]");
  if (!hit) return void (els.chartTooltip.hidden = true);
  const card = els.chart.parentElement!.getBoundingClientRect();
  els.chartTooltip.textContent = hit.dataset.tip!;
  els.chartTooltip.style.left = `${Math.min(Math.max(event.clientX - card.left, 140), card.width - 140)}px`;
  els.chartTooltip.style.top = `${event.clientY - card.top}px`;
  els.chartTooltip.hidden = false;
});
els.chart.addEventListener("pointerleave", () => (els.chartTooltip.hidden = true));
els.chart.addEventListener("click", (event) => {
  const hit = (event.target as Element).closest?.<SVGElement>("[data-round]");
  if (!hit || !state.input) return;
  const index = stepOfRound(state.input.compiled, Number(hit.dataset.round));
  if (index >= 0) selectStep(index);
});

// ---- URL: #pattern=<id>&round=<n> so a step can be linked or reloaded ----

function writeHash(): void {
  if (!state.source || state.source.id.startsWith("file:") || !state.input) return;
  const round = state.input.compiled.steps[state.index]!.rounds[0]!.round;
  const view = state.view === "3d" ? "&view=3d" : "";
  history.replaceState(null, "", `#pattern=${encodeURIComponent(state.source.id)}&round=${round}${view}`);
}

// Follow links and back/forward that change the hash.
window.addEventListener("hashchange", () => {
  const { id, round, view } = readHash();
  const source = sources.find((s) => s.id === id);
  if (!source) return;
  if (view !== state.view) setView(view);
  if (source !== state.source) loadSource(source, round);
  else if (round !== undefined && state.input) {
    const index = stepOfRound(state.input.compiled, round);
    if (index >= 0) selectStep(index);
  }
});

function readHash(): { id?: string; round?: number; view: "2d" | "3d" } {
  const params = new URLSearchParams(location.hash.slice(1));
  const round = Number(params.get("round"));
  return {
    id: params.get("pattern") ?? undefined,
    round: Number.isFinite(round) && round > 0 ? round : undefined,
    view: params.get("view") === "3d" ? "3d" : "2d",
  };
}

// ---- Helpers ----

function fillSelect(): void {
  els.select.innerHTML = sources
    .map((s) => `<option value="${esc(s.id)}">${esc(s.id.startsWith("file:") ? `${s.name} (your file)` : s.name)}</option>`)
    .join("");
}

function titleOf(text: string): string | undefined {
  return /^title:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, "");
}

function formatGrams(grams: number): string {
  return grams < 0.1 ? "<0.1 g" : `${grams.toFixed(1)} g`;
}

function swatch(bead: ResolvedBead): string {
  const { rgb, opacity = 1 } = bead.display;
  return `<span class="swatch" style="background:${esc(rgb)};opacity:${Math.max(opacity, 0.5)}"></span>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---- Start ----

fillSelect();
els.roundGap.value = String(DEFAULT_SPACING.roundGap);
els.beadGap.value = String(DEFAULT_SPACING.beadGap);
showSpacing();
const initial = readHash();
if (initial.view === "3d") setView("3d");
loadSource(sources.find((s) => s.id === initial.id) ?? sources[0]!, initial.round);
