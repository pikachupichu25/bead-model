// Draws the round-by-round diagrams as SVG.
//
// One image per round shows that round's beads in full color, numbered in
// pickup order, with the step-up bead marked. Earlier rounds are faded, and
// the round being worked into (the up beads) is half faded.

import type { ResolvedBead, Shape } from "../catalog/catalog.js";
import { type CompiledPattern, type CompiledRound, describeStitches } from "../pattern/compile.js";
import type { Layout, PlacedBead } from "./layout.js";

export interface DiagramInput {
  compiled: CompiledPattern;
  beads: Map<string, ResolvedBead>;
  layout: Layout;
}

const STEP_UP = "#d62728";
const INK = "#222222";
const MUTED = "#666666";
const FONT = "font-family=\"system-ui, -apple-system, 'Segoe UI', sans-serif\"";

/** Diagram for one round, with a header and legend. */
export function renderRoundSvg(input: DiagramInput, roundNumber: number): string {
  const { compiled } = input;
  const index = compiled.rounds.findIndex((r) => r.round === roundNumber);
  const round = compiled.rounds[index];
  if (!round) throw new Error(`round ${roundNumber} does not exist`);
  const previous = compiled.rounds[index - 1];

  const width = 720;
  const headerHeight = 116;
  const diagramSize = 560;
  const legend = legendRows(input, round);
  const legendHeight = 28 + legend.length * 26;
  const height = headerHeight + diagramSize + legendHeight;

  const added = round.beads.length;
  const change = previous ? added - previous.beads.length : 0;
  const changeText = previous ? ` (${change >= 0 ? "+" : ""}${change} on round ${previous.round})` : "";
  const stitches = round.stitches.length > 0 ? `${round.gaps} gaps: ${describeStitches(round)}` : startText(compiled);
  const options = [
    round.edge === "back" ? "Worked from the back edge" : undefined,
    round.tension !== "normal" ? `${capitalize(round.tension)} tension` : undefined,
    round.note ? `Note: ${round.note}` : undefined,
  ].filter(Boolean);

  const body = [
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    text(24, 34, `${compiled.pattern.title}`, 15, MUTED),
    text(24, 62, `Round ${round.round} of ${lastRound(compiled)}: ${added} beads${changeText}`, 22, INK, "600"),
    text(24, 86, stitches, 13, MUTED),
    options.length ? text(24, 106, options.join(" · "), 13, STEP_UP) : "",
    `<svg x="${(width - diagramSize) / 2}" y="${headerHeight}" width="${diagramSize}" height="${diagramSize}" viewBox="${viewBox(input.layout, visibleRounds(compiled, round))}">`,
    drawBeads(input, round, { numbers: true, upcoming: false }),
    `</svg>`,
    ...legend.map((row, i) => drawLegendRow(row, 24, headerHeight + diagramSize + 20 + i * 26)),
  ];
  return svgDocument(width, height, body.join("\n"));
}

export interface DiagramOptions {
  /** Number the round's beads in pickup order. */
  numbers?: boolean;
  /** Also draw later rounds, very faintly, so the finished shape shows. */
  upcoming?: boolean;
}

/**
 * Just the bead picture for one round, as a standalone <svg> that scales to
 * its container. It is zoomed to the whole piece, so it doesn't jump between
 * rounds. Each bead is a <g data-bead="id"> for interactive use.
 */
export function renderDiagramSvg(input: DiagramInput, roundNumber: number, options: DiagramOptions = {}): string {
  const round = input.compiled.rounds.find((r) => r.round === roundNumber);
  if (!round) throw new Error(`round ${roundNumber} does not exist`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox(input.layout)}" width="100%" height="100%" role="img" aria-label="Round ${round.round} bead diagram">`,
    drawBeads(input, round, { numbers: options.numbers ?? true, upcoming: options.upcoming ?? true }),
    `</svg>`,
  ].join("\n");
}

/** All rounds on one sheet, without numbers, for an overview. */
export function renderSheetSvg(input: DiagramInput, columns = 4): string {
  const { compiled } = input;
  const cell = 260;
  const label = 28;
  const headerHeight = 56;
  const rows = Math.ceil(compiled.rounds.length / columns);
  const width = columns * cell;
  const height = headerHeight + rows * (cell + label);

  const panels = compiled.rounds.map((round, i) => {
    const x = (i % columns) * cell;
    const y = headerHeight + Math.floor(i / columns) * (cell + label);
    return [
      text(x + cell / 2, y + 20, `Round ${round.round}: ${round.beads.length} beads`, 14, INK, "600", "middle"),
      `<svg x="${x + 10}" y="${y + label}" width="${cell - 20}" height="${cell - 20}" viewBox="${viewBox(input.layout)}">`,
      drawBeads(input, round, { numbers: false, upcoming: false }),
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

function drawBeads(input: DiagramInput, round: CompiledRound, options: Required<DiagramOptions>): string {
  const { compiled, layout } = input;
  const index = compiled.rounds.indexOf(round);
  const visible = visibleRounds(compiled, round);
  // The round this one is worked into (its up beads). None for start rounds.
  const between = compiled.beads[round.beads[0]!]!.between;
  const upRound = between ? compiled.beads[between[0]]!.round : undefined;

  const byId = new Map(layout.beads.map((b) => [b.id, b]));
  const out: string[] = [];

  // Upcoming rounds as faint ghosts, then faded earlier rounds, so the current round is drawn on top.
  if (options.upcoming) {
    for (const placed of layout.beads) {
      if (!visible.has(placed.round)) out.push(drawBead(placed, input.beads.get(placed.key)!, 0.09));
    }
  }
  for (const placed of layout.beads) {
    if (!visible.has(placed.round) || placed.round === round.round) continue;
    out.push(drawBead(placed, input.beads.get(placed.key)!, placed.round === upRound ? 0.5 : 0.22));
  }

  // The step-up path: a dashed line through the first bead of each round so far.
  const firsts = compiled.rounds
    .slice(0, index + 1)
    .filter((r) => r.edge === round.edge)
    .map((r) => byId.get(r.beads[0]!)!);
  if (firsts.length > 1) {
    const d = firsts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${STEP_UP}" stroke-width="0.12" stroke-dasharray="0.4 0.3" opacity="0.7" pointer-events="none"/>`);
  }

  for (const id of round.beads) {
    const placed = byId.get(id)!;
    const bead = input.beads.get(placed.key)!;
    out.push(drawBead(placed, bead, 1));
    if (options.numbers) {
      const order = compiled.beads[id]!.order;
      const fontSize = Math.min(placed.radial, placed.tangential) * (order >= 10 ? 0.5 : 0.62);
      out.push(
        `<text x="${fmt(placed.x)}" y="${fmt(placed.y)}" font-size="${fmt(fontSize)}" ${FONT} pointer-events="none" text-anchor="middle" dominant-baseline="central" fill="${labelColor(bead.display.rgb)}">${order}</text>`,
      );
    }
  }

  // Mark the step-up bead (the first bead of the round).
  const first = byId.get(round.beads[0]!)!;
  const ring = Math.max(first.radial, first.tangential) * 0.62;
  out.push(
    `<circle cx="${fmt(first.x)}" cy="${fmt(first.y)}" r="${fmt(ring)}" fill="none" stroke="${STEP_UP}" stroke-width="0.18" pointer-events="none"/>`,
  );
  return out.join("\n");
}

function drawBead(placed: PlacedBead, bead: ResolvedBead, opacity: number): string {
  // Local frame: x points out from the center (across the hole), y along the ring (along the hole).
  const w = placed.radial * 0.94;
  const h = placed.tangential * 0.94;
  const [rx, ry] = corner(bead.shape, w, h);
  const rotation = (-placed.theta * 180) / Math.PI;
  const { rgb, opacity: glass = 1, finish = [] } = bead.display;
  const highlight = finish.includes("matte")
    ? ""
    : `<ellipse cx="${fmt(-w * 0.18)}" cy="${fmt(-h * 0.2)}" rx="${fmt(w * 0.14)}" ry="${fmt(h * 0.2)}" fill="#ffffff" opacity="${finish.includes("metallic") || finish.includes("silver-lined") ? 0.75 : 0.4}"/>`;
  return [
    `<g data-bead="${placed.id}" transform="translate(${fmt(placed.x)} ${fmt(placed.y)}) rotate(${fmt(rotation)})" opacity="${opacity}">`,
    `<rect x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${rgb}" fill-opacity="${Math.max(glass, 0.35)}" stroke="${darken(rgb)}" stroke-width="0.08"/>`,
    highlight,
    `</g>`,
  ].join("");
}

/** Corner rounding of the bead outline seen from above, by shape. */
function corner(shape: Shape, w: number, h: number): [number, number] {
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

function legendRows(input: DiagramInput, round: CompiledRound): LegendRow[] {
  const { compiled } = input;
  const index = compiled.rounds.indexOf(round);
  const soFar = new Set(compiled.rounds.slice(0, index + 1).map((r) => r.round));
  return [...input.beads.values()].map((bead) => ({
    key: bead.key,
    bead,
    inRound: round.beads.filter((id) => compiled.beads[id]!.key === bead.key).length,
    total: compiled.beads.filter((b) => b.key === bead.key && soFar.has(b.round)).length,
  }));
}

function drawLegendRow(row: LegendRow, x: number, y: number): string {
  const { rgb, opacity = 1 } = row.bead.display;
  return [
    `<rect x="${x}" y="${y - 13}" width="22" height="16" rx="4" fill="${rgb}" fill-opacity="${Math.max(opacity, 0.35)}" stroke="${darken(rgb)}"/>`,
    text(x + 32, y, `${row.key}`, 14, INK, "600"),
    text(x + 54, y, `${row.bead.label}, ${row.bead.outerDiameter} × ${row.bead.length} mm`, 13, INK),
    text(x + 672, y, `${row.inRound} this round · ${row.total} so far`, 13, MUTED, "400", "end"),
  ].join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function startText(compiled: CompiledPattern): string {
  const { start } = compiled.pattern;
  return start.kind === "center"
    ? `Start: ring of ${start.beads.length} beads`
    : `Start: tube of ${start.beads.length} beads, strung in one go (rounds 1 and 2)`;
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
  const r = extent * 1.08;
  return `${fmt(-r)} ${fmt(-r)} ${fmt(2 * r)} ${fmt(2 * r)}`;
}

function visibleRounds(compiled: CompiledPattern, round: CompiledRound): Set<number> {
  const index = compiled.rounds.indexOf(round);
  return new Set(compiled.rounds.slice(0, index + 1).map((r) => r.round));
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

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

function rgbParts(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function darken(hex: string): string {
  const [r, g, b] = rgbParts(hex).map((c) => Math.round(c * 0.55));
  return `rgb(${r},${g},${b})`;
}

function labelColor(hex: string): string {
  const [r, g, b] = rgbParts(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}
