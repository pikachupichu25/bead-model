// Draws the step-by-step diagrams as SVG.
//
// One image per step (usually one round; a tube start's rounds 1 and 2 are
// one step) shows that step's beads in full color, numbered in pickup order,
// with the step-up bead marked. Earlier rounds are faded, and the round being
// worked into (the up beads) is half faded.

import type { ResolvedBead, Shape } from "../catalog/catalog.js";
import { type CompiledPattern, type CompiledStep, describeStitches } from "../pattern/compile.js";
import { describeStep, stepLabel } from "../pattern/describe.js";
import { threadPasses } from "../pattern/thread.js";
import type { Layout, PlacedBead } from "./layout.js";

export interface DiagramInput {
  compiled: CompiledPattern;
  beads: Map<string, ResolvedBead>;
  layout: Layout;
}

const STEP_UP = "#d62728";
const THREAD = "#2a2724";
const INK = "#222222";
const MUTED = "#666666";
const FONT = "font-family=\"system-ui, -apple-system, 'Segoe UI', sans-serif\"";

/** Diagram for one step (by index into compiled.steps), with a header and legend. */
export function renderStepSvg(input: DiagramInput, stepIndex: number): string {
  const { compiled } = input;
  const step = stepAt(compiled, stepIndex);
  const round = step.rounds[0]!;

  const width = 720;
  const headerHeight = 116;
  const diagramSize = 560;
  const legend = legendRows(input, step);
  const legendHeight = 28 + legend.length * 26;
  const height = headerHeight + diagramSize + legendHeight;

  const before = previousRound(compiled, stepIndex);
  const added = step.beads.length;
  const changeText = before
    ? ` (${signed(added - before.beads.length)} on round ${before.round})`
    : "";
  const stitches = round.stitches.length > 0 ? `${round.gaps} gaps: ${describeStitches(round)}` : startText(compiled);
  const options = [
    round.edge === "back" ? "Worked from the back edge" : undefined,
    round.tension !== "normal" ? `${capitalize(round.tension)} tension` : undefined,
    round.close ? "Then pull its beads into a ring to close" : undefined,
    round.note ? `Note: ${round.note}` : undefined,
  ].filter(Boolean);

  const body = [
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    text(24, 34, `${compiled.pattern.title}`, 15, MUTED),
    text(24, 62, `${stepLabel(step)} of ${lastRound(compiled)}: ${added} beads${changeText}`, 22, INK, "600"),
    text(24, 86, stitches, 13, MUTED),
    options.length ? text(24, 106, options.join(" · "), 13, STEP_UP) : "",
    `<svg x="${(width - diagramSize) / 2}" y="${headerHeight}" width="${diagramSize}" height="${diagramSize}" viewBox="${viewBox(input.layout, visibleRounds(compiled, stepIndex))}">`,
    drawBeads(input, stepIndex, { numbers: true, upcoming: false, thread: true }),
    `</svg>`,
    ...legend.map((row, i) => drawLegendRow(row, 24, headerHeight + diagramSize + 20 + i * 26)),
  ];
  return svgDocument(width, height, body.join("\n"));
}

export interface DiagramOptions {
  /** Number the step's beads in pickup order. */
  numbers?: boolean;
  /** Also draw later rounds, very faintly, so the finished shape shows. */
  upcoming?: boolean;
  /** Draw the thread's path through the beads, with arrows for direction. */
  thread?: boolean;
}

/**
 * Just the bead picture for one step, as a standalone <svg> that scales to
 * its container. It is zoomed to the whole piece, so it doesn't jump between
 * steps. Each bead is a <g data-bead="id"> for interactive use.
 */
export function renderDiagramSvg(input: DiagramInput, stepIndex: number, options: DiagramOptions = {}): string {
  const step = stepAt(input.compiled, stepIndex);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(input.layout)}" width="100%" height="100%" role="img" aria-label="${stepLabel(step)} bead diagram">`,
    drawBeads(input, stepIndex, {
      numbers: options.numbers ?? true,
      upcoming: options.upcoming ?? true,
      thread: options.thread ?? true,
    }),
    `</svg>`,
  ].join("\n");
}

/** All steps on one sheet, without numbers, for an overview. */
export function renderSheetSvg(input: DiagramInput, columns = 4): string {
  const { compiled } = input;
  const cell = 260;
  const label = 28;
  const headerHeight = 56;
  const rows = Math.ceil(compiled.steps.length / columns);
  const width = columns * cell;
  const height = headerHeight + rows * (cell + label);

  const panels = compiled.steps.map((step, i) => {
    const x = (i % columns) * cell;
    const y = headerHeight + Math.floor(i / columns) * (cell + label);
    return [
      text(x + cell / 2, y + 20, `${stepLabel(step)}: ${step.beads.length} beads`, 14, INK, "600", "middle"),
      `<svg x="${x + 10}" y="${y + label}" width="${cell - 20}" height="${cell - 20}" viewBox="${viewBox(input.layout)}">`,
      drawBeads(input, i, { numbers: false, upcoming: false, thread: false }),
      `</svg>`,
    ].join("\n");
  });

  const body = [
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    text(20, 34, compiled.pattern.title, 20, INK, "600"),
    ...panels,
  ];
  return svgDocument(width, height, body.join("\n"));
}

export interface ChartOptions {
  /** Ring the step-up bead (first bead) of every round. */
  stepUps?: boolean;
}

/**
 * The design chart: the whole piece with every bead in full color, as a
 * standalone <svg> that scales to its container. Each bead is a
 * <g data-bead="id" data-round="n"> for interactive use.
 */
export function renderChartSvg(input: DiagramInput, options: ChartOptions = {}): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(input.layout)}" width="100%" height="100%" role="img" aria-label="${escapeXml(input.compiled.pattern.title)} chart">`,
    drawChart(input, options.stepUps ?? true),
    `</svg>`,
  ].join("\n");
}

/**
 * A printable chart for the whole pattern: the finished piece, the beads with
 * how many of each to buy, and the instruction for every step.
 */
export function renderChartSheetSvg(input: DiagramInput): string {
  const { compiled } = input;
  const width = 760;
  const margin = 32;
  const headerHeight = 96;
  const diagramSize = 560;
  const total = compiled.beads.length;
  const lastRoundNumber = lastRound(compiled);

  const beadRows = [...input.beads.values()].map((bead) => {
    const count = compiled.beads.filter((b) => b.key === bead.key).length;
    const grams = bead.beadsPerGram ? ` · about ${(count / bead.beadsPerGram).toFixed(1)} g` : "";
    return { bead, text: `${bead.label}, ${bead.outerDiameter} × ${bead.length} mm`, count: `${count} beads${grams}` };
  });
  const steps = compiled.steps.flatMap((step) => {
    const lines = wrap(describeStep(compiled, step), 92);
    const round = step.rounds[0]!;
    if (round.tension !== "normal") lines.push(`Keep the thread ${round.tension}.`);
    if (round.note) lines.push(...wrap(`Note: ${round.note}`, 92));
    return [{ label: `${stepLabel(step)} · ${step.beads.length} beads`, lines }];
  });

  let y = headerHeight + diagramSize + 24;
  const body: string[] = [
    text(margin, 42, compiled.pattern.title, 24, INK, "600"),
    text(
      margin,
      68,
      [`${lastRoundNumber} rounds`, `${total} beads`, compiled.pattern.source ?? ""].filter(Boolean).join(" · "),
      13,
      MUTED,
    ),
    `<svg x="${(width - diagramSize) / 2}" y="${headerHeight}" width="${diagramSize}" height="${diagramSize}" viewBox="${viewBox(input.layout)}">`,
    drawChart(input, true),
    `</svg>`,
    text(margin, y, "Beads", 16, INK, "600"),
  ];
  y += 14;
  for (const row of beadRows) {
    y += 26;
    const { rgb, opacity = 1 } = row.bead.display;
    body.push(
      `<rect x="${margin}" y="${y - 13}" width="22" height="16" rx="4" fill="${rgb}" fill-opacity="${Math.max(opacity, 0.35)}" stroke="${darken(rgb)}"/>`,
      text(margin + 32, y, row.bead.key, 14, INK, "600"),
      text(margin + 54, y, row.text, 13, INK),
      text(width - margin, y, row.count, 13, MUTED, "400", "end"),
    );
  }
  y += 44;
  body.push(text(margin, y, "Steps", 16, INK, "600"));
  y += 8;
  for (const step of steps) {
    y += 24;
    body.push(text(margin, y, step.label, 13, INK, "600"));
    for (const line of step.lines) {
      y += 18;
      body.push(text(margin + 12, y, line, 13, INK));
    }
  }
  const height = y + margin;
  return svgDocument(width, height, [`<rect width="${width}" height="${height}" fill="#ffffff"/>`, ...body].join("\n"));
}

function drawChart(input: DiagramInput, stepUps: boolean): string {
  const { compiled, layout } = input;
  const out = layout.beads.map((placed) => drawBead(placed, input.beads.get(placed.key)!, 1));
  if (stepUps) {
    const byId = new Map(layout.beads.map((b) => [b.id, b]));
    for (const round of compiled.rounds) {
      if (round.stitches.length === 0) continue;
      const first = byId.get(round.beads[0]!)!;
      const ring = Math.max(first.radial, first.tangential) * 0.6;
      out.push(
        `<circle cx="${fmt(first.x)}" cy="${fmt(first.y)}" r="${fmt(ring)}" fill="none" stroke="${STEP_UP}" stroke-width="0.12" pointer-events="none"/>`,
      );
    }
  }
  return out.join("\n");
}

/** Splits text into lines of at most `width` characters, at spaces. */
function wrap(content: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of content.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawBeads(input: DiagramInput, stepIndex: number, options: Required<DiagramOptions>): string {
  const { compiled, layout } = input;
  const step = stepAt(compiled, stepIndex);
  const current = new Set(step.rounds.map((r) => r.round));
  const visible = visibleRounds(compiled, stepIndex);
  // The round this step is worked into (its up beads). None for the start.
  const between = compiled.beads[step.beads[0]!]!.between;
  const upRound = between ? compiled.beads[between[0]]!.round : undefined;

  const byId = new Map(layout.beads.map((b) => [b.id, b]));
  const out: string[] = [];

  // Upcoming rounds as faint ghosts, then faded earlier rounds, so the current step is drawn on top.
  if (options.upcoming) {
    for (const placed of layout.beads) {
      if (!visible.has(placed.round)) out.push(drawBead(placed, input.beads.get(placed.key)!, 0.09));
    }
  }
  for (const placed of layout.beads) {
    if (!visible.has(placed.round) || current.has(placed.round)) continue;
    out.push(drawBead(placed, input.beads.get(placed.key)!, placed.round === upRound ? 0.5 : 0.22));
  }

  // The step-up path: a dashed line through the first bead of each step so far.
  // Left out when the thread is drawn, which shows the step-up itself.
  const edge = step.rounds[0]!.edge;
  const firsts = compiled.steps
    .slice(0, stepIndex + 1)
    .filter((s) => s.rounds[0]!.edge === edge)
    .map((s) => byId.get(s.beads[0]!)!);
  if (firsts.length > 1 && !options.thread) {
    const d = firsts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${STEP_UP}" stroke-width="0.12" stroke-dasharray="0.4 0.3" opacity="0.7" pointer-events="none"/>`);
  }

  for (const id of step.beads) {
    out.push(drawBead(byId.get(id)!, input.beads.get(compiled.beads[id]!.key)!, 1));
  }
  if (options.thread) {
    const passes = threadPasses(compiled, stepIndex).map((id) => byId.get(id)!);
    const inStep = new Set(step.beads);
    out.push(
      drawThread(passes, {
        // The start ring has no previous round to come out of.
        fromPrevious: Boolean(between),
        firstNew: passes.findIndex((p) => inStep.has(p.id)),
        outward: edge === "back" ? -1 : 1,
      }),
    );
  }

  // Numbers go on top of the thread, with a halo in the bead's color so they stay readable.
  if (options.numbers) {
    for (const id of step.beads) {
      const placed = byId.get(id)!;
      const { rgb } = input.beads.get(placed.key)!.display;
      const order = compiled.beads[id]!.order;
      const fontSize = Math.min(placed.radial, placed.tangential) * (order >= 10 ? 0.5 : 0.62);
      out.push(
        `<text x="${fmt(placed.x)}" y="${fmt(placed.y)}" font-size="${fmt(fontSize)}" ${FONT} pointer-events="none" text-anchor="middle" dominant-baseline="central" fill="${labelColor(rgb)}" stroke="${rgb}" stroke-width="${fmt(fontSize * 0.22)}" paint-order="stroke">${order}</text>`,
      );
    }
  }

  // Mark the step-up bead (the first bead of the step).
  const first = byId.get(step.beads[0]!)!;
  const ring = Math.max(first.radial, first.tangential) * 0.62;
  out.push(
    `<circle cx="${fmt(first.x)}" cy="${fmt(first.y)}" r="${fmt(ring)}" fill="none" stroke="${STEP_UP}" stroke-width="0.18" pointer-events="none"/>`,
  );
  return out.join("\n");
}

interface ThreadEnds {
  /** True when the thread comes out of a bead of the round before (every step but the start). */
  fromPrevious: boolean;
  /** Index in the passes of the step's first new bead, where the "in" arrow goes. */
  firstNew: number;
  /** Which way the "out" tail leaves the piece: 1 outward, -1 inward (back-edge rounds). */
  outward: 1 | -1;
}

/**
 * The thread as one line: straight along the hole of each bead it passes
 * through (the hole runs along the ring), and curving between beads, leaving
 * and entering each bead along its hole.
 *
 * Like printed pattern charts: a dot marks where the thread comes out of the
 * round before, an arrowhead points into the round's first bead, and a long
 * tail with a bold arrowhead shows the thread going out at the end.
 */
function drawThread(passes: PlacedBead[], ends: ThreadEnds): string {
  if (passes.length === 0) return "";
  const width = Math.min(...passes.map((p) => p.tangential)) * 0.07;
  // Travel is counter-clockwise: increasing theta, which is this direction in SVG coordinates.
  const holes = passes.map((p) => {
    const t: Point = [-Math.sin(p.theta), -Math.cos(p.theta)];
    const half = p.tangential * 0.47;
    return { t, entry: add([p.x, p.y], t, -half), exit: add([p.x, p.y], t, half) };
  });
  const first = holes[0]!;
  const last = holes[holes.length - 1]!;
  const lastBead = passes[passes.length - 1]!;

  // Where the thread starts: coming out of the step-up bead of the round
  // before, or, for the start ring, a short lead-in before the first bead.
  const startAt = ends.fromPrevious ? first.exit : add(first.entry, first.t, -passes[0]!.tangential * 1.2);
  let d = ends.fromPrevious
    ? `M${pt(startAt)}`
    : `M${pt(startAt)} L${pt(first.entry)} L${pt(first.exit)}`;

  let inArrow = "";
  for (let i = 1; i < holes.length; i++) {
    const from = holes[i - 1]!;
    const to = holes[i]!;
    const k = Math.hypot(to.entry[0] - from.exit[0], to.entry[1] - from.exit[1]) * 0.45;
    d += ` C${pt(add(from.exit, from.t, k))} ${pt(add(to.entry, to.t, -k))} ${pt(to.entry)} L${pt(to.exit)}`;
    if (i === ends.firstNew) inArrow = arrowhead(to.entry, to.t, width * 3.8);
  }
  if (ends.firstNew === 0) inArrow = arrowhead(first.entry, first.t, width * 3.8);

  // The "out" tail: leaves the last bead along its hole, then turns away from the piece.
  const radial: Point = [Math.cos(lastBead.theta) * ends.outward, -Math.sin(lastBead.theta) * ends.outward];
  const reach = Math.max(lastBead.radial, lastBead.tangential);
  const tailEnd = add(add(last.exit, last.t, reach * 1.1), radial, reach * 1.9);
  const c1 = add(last.exit, last.t, reach * 0.9);
  const c2 = add(tailEnd, radial, -reach * 0.9);
  d += ` C${pt(c1)} ${pt(c2)} ${pt(tailEnd)}`;

  return [
    `<g class="thread" pointer-events="none">`,
    `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${fmt(width * 2)}" stroke-linejoin="round" stroke-linecap="round" opacity="0.45"/>`,
    `<path d="${d}" fill="none" stroke="${THREAD}" stroke-width="${fmt(width)}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`,
    `<circle class="thread-start" cx="${fmt(startAt[0])}" cy="${fmt(startAt[1])}" r="${fmt(width * 2.3)}" fill="${THREAD}" stroke="#ffffff" stroke-width="${fmt(width * 0.6)}"/>`,
    `<g class="thread-in">${inArrow}</g>`,
    `<g class="thread-out">${arrowhead(tailEnd, radial, width * 4.5)}</g>`,
    `</g>`,
  ].join("");
}

/** An arrowhead with its tip at `tip`, pointing along `direction`. */
function arrowhead(tip: Point, direction: Point, size: number): string {
  const angle = (Math.atan2(direction[1], direction[0]) * 180) / Math.PI;
  return `<path d="M0 0 L${fmt(-size * 1.5)} ${fmt(-size * 0.75)} L${fmt(-size * 1.15)} 0 L${fmt(-size * 1.5)} ${fmt(size * 0.75)} Z" transform="translate(${pt(tip)}) rotate(${fmt(angle)})" fill="${THREAD}" stroke="#ffffff" stroke-width="${fmt(size * 0.12)}" stroke-linejoin="round" paint-order="stroke"/>`;
}

type Point = [number, number];

function add(p: Point, v: Point, k: number): Point {
  return [p[0] + v[0] * k, p[1] + v[1] * k];
}

function pt(p: Point): string {
  return `${fmt(p[0])} ${fmt(p[1])}`;
}


function drawBead(placed: PlacedBead, bead: ResolvedBead, opacity: number): string {
  // Local frame: x points out from the center (across the hole), y along the ring (along the hole).
  const w = placed.radial * 0.94;
  const h = placed.tangential * 0.94;
  const [rx, ry] = beadCorner(bead.shape, w, h);
  const rotation = (-placed.theta * 180) / Math.PI;
  const { rgb, opacity: glass = 1, finish = [] } = bead.display;
  const highlight = finish.includes("matte")
    ? ""
    : `<ellipse cx="${fmt(-w * 0.18)}" cy="${fmt(-h * 0.2)}" rx="${fmt(w * 0.14)}" ry="${fmt(h * 0.2)}" fill="#ffffff" opacity="${finish.includes("metallic") || finish.includes("silver-lined") ? 0.75 : 0.4}"/>`;
  return [
    `<g data-bead="${placed.id}" data-round="${placed.round}" transform="translate(${fmt(placed.x)} ${fmt(placed.y)}) rotate(${fmt(rotation)})" opacity="${opacity}">`,
    `<rect x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${rgb}" fill-opacity="${Math.max(glass, 0.35)}" stroke="${darken(rgb)}" stroke-width="0.08"/>`,
    highlight,
    `</g>`,
  ].join("");
}

/** Corner rounding of the bead outline seen from above, by shape. */
export function beadCorner(shape: Shape, w: number, h: number): [number, number] {
  switch (shape) {
    case "round":
    case "demi":
      return [w * 0.42, h * 0.32];
    case "cube":
    case "hex":
    case "triangle":
      return [w * 0.06, h * 0.06];
    default:
      return [w * 0.12, h * 0.12];
  }
}

interface LegendRow {
  key: string;
  bead: ResolvedBead;
  inRound: number;
  total: number;
}

function legendRows(input: DiagramInput, step: CompiledStep): LegendRow[] {
  const { compiled } = input;
  const soFar = visibleRounds(compiled, compiled.steps.indexOf(step));
  return [...input.beads.values()].map((bead) => ({
    key: bead.key,
    bead,
    inRound: step.beads.filter((id) => compiled.beads[id]!.key === bead.key).length,
    total: compiled.beads.filter((b) => b.key === bead.key && soFar.has(b.round)).length,
  }));
}

function drawLegendRow(row: LegendRow, x: number, y: number): string {
  const { rgb, opacity = 1 } = row.bead.display;
  return [
    `<rect x="${x}" y="${y - 13}" width="22" height="16" rx="4" fill="${rgb}" fill-opacity="${Math.max(opacity, 0.35)}" stroke="${darken(rgb)}"/>`,
    text(x + 32, y, `${row.key}`, 14, INK, "600"),
    text(x + 54, y, `${row.bead.label}, ${row.bead.outerDiameter} × ${row.bead.length} mm`, 13, INK),
    text(x + 672, y, `${row.inRound} this step · ${row.total} so far`, 13, MUTED, "400", "end"),
  ].join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function startText(compiled: CompiledPattern): string {
  const { start } = compiled.pattern;
  return start.kind === "center"
    ? `Start: ring of ${start.beads.length} beads`
    : `Start: tube of ${start.beads.length} beads, strung in one go`;
}

function lastRound(compiled: CompiledPattern): number {
  return compiled.rounds[compiled.rounds.length - 1]!.round;
}

/**
 * The square around the beads to show. Each round image zooms to the rounds
 * drawn so far, but no closer than 40% of the finished piece, so the first
 * rounds don't come out huge. Without `rounds`, fits the whole piece.
 */
function viewBox(layout: Layout, rounds?: Set<number>): string {
  let extent = layout.extent;
  if (rounds) {
    const visible = layout.beads.filter((b) => rounds.has(b.round));
    const fit = Math.max(...visible.map((b) => b.radius + Math.max(b.radial, b.tangential) / 2));
    extent = Math.max(fit, layout.extent * 0.4);
  }
  // Room around the outside for the thread's "out" tail, which reaches about three beads past the edge.
  const bead = Math.max(...layout.beads.map((b) => Math.max(b.radial, b.tangential)));
  const r = extent + bead * 3.2;
  return `${fmt(-r)} ${fmt(-r)} ${fmt(2 * r)} ${fmt(2 * r)}`;
}

/** Every round up to and including the step's last round. */
function visibleRounds(compiled: CompiledPattern, stepIndex: number): Set<number> {
  return new Set(compiled.steps.slice(0, stepIndex + 1).flatMap((s) => s.rounds.map((r) => r.round)));
}

function stepAt(compiled: CompiledPattern, stepIndex: number): CompiledStep {
  const step = compiled.steps[stepIndex];
  if (!step) throw new Error(`step ${stepIndex} does not exist`);
  return step;
}

/** The last round of the step before, for "+3 on round 4". */
export function previousRound(compiled: CompiledPattern, stepIndex: number) {
  const before = compiled.steps[stepIndex - 1];
  return before?.rounds[before.rounds.length - 1];
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>\n`;
}

function text(
  x: number,
  y: number,
  content: string,
  size: number,
  color: string,
  weight = "400",
  anchor: "start" | "middle" | "end" = "start",
): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" ${FONT} fill="${color}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

function rgbParts(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A darker shade of a color, for bead outlines. */
export function darken(hex: string): string {
  const [r, g, b] = rgbParts(hex).map((c) => Math.round(c * 0.55));
  return `rgb(${r},${g},${b})`;
}

function labelColor(hex: string): string {
  const [r, g, b] = rgbParts(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}
