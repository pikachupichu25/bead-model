// Reads a *.peyote.yaml file into a Pattern. Only checks the shape of the
// file here; the counting rule and other checks are in compile.ts.

import { parse as parseYaml } from "yaml";
import { expandFixed, type Item, NotationError, parseStitchList, stitchBeads } from "./notation.js";

export type Edge = "front" | "back";
export type Tension = "normal" | "tight" | "loose";
/**
 * How the step-up at the end of a round goes through the round's first stitch:
 * through all of its beads ("group", e.g. both beads of a pair), or only the
 * first bead ("first"). The next round starts from the bead the thread comes out of.
 */
export type StepUp = "group" | "first";

export interface Start {
  kind: "center" | "tube";
  /** Bead keys in stringing order. */
  beads: string[];
}

export interface RoundSpec {
  /** First and last round this instruction applies to (equal for a single round). */
  from: number;
  to: number;
  stitches: Item[];
  /** The stitch text as written, for display. */
  text: string;
  edge: Edge;
  tension: Tension;
  note?: string;
}

export interface Pattern {
  title: string;
  source?: string;
  status?: string;
  /** Raw bead definitions by key. Resolved against the catalog later. */
  beads: Record<string, unknown>;
  start: Start;
  stepUp: StepUp;
  rounds: RoundSpec[];
}

export class PatternError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("\n"));
  }
}

export function parsePattern(yamlText: string): Pattern {
  const doc: unknown = parseYaml(yamlText);
  if (!isRecord(doc)) throw new PatternError(["the file must be a YAML mapping"]);

  const issues: string[] = [];
  const title = typeof doc.title === "string" ? doc.title : "Untitled";

  const beads = isRecord(doc.beads) ? doc.beads : {};
  if (!isRecord(doc.beads)) issues.push("`beads` must be a mapping of bead keys");

  let start: Start = { kind: "center", beads: [] };
  if (typeof doc.start !== "string") {
    issues.push("`start` is required, e.g. `center 3A` or `tube 32: (1A, 1B) x16`");
  } else {
    try {
      start = parseStart(doc.start);
    } catch (e) {
      issues.push(`start: ${message(e)}`);
    }
  }

  const rounds: RoundSpec[] = [];
  if (!isRecord(doc.rounds)) {
    issues.push("`rounds` must be a mapping from round numbers to stitches");
  } else {
    for (const [key, value] of Object.entries(doc.rounds)) {
      try {
        rounds.push(parseRound(key, value));
      } catch (e) {
        issues.push(`round ${key}: ${message(e)}`);
      }
    }
  }
  rounds.sort((a, b) => a.from - b.from);

  const stepUp = doc.step_up ?? "group";
  if (stepUp !== "group" && stepUp !== "first") issues.push("`step_up` must be group or first");

  if (issues.length > 0) throw new PatternError(issues);
  return {
    title,
    source: typeof doc.source === "string" ? doc.source : undefined,
    status: typeof doc.status === "string" ? doc.status : undefined,
    beads,
    start,
    stepUp: stepUp as StepUp,
    rounds,
  };
}

/** `center 3A`, `center 5: 1A, 1B, 1A, 1B, 1A`, `tube 32: (1A, 1B) x16` */
export function parseStart(text: string): Start {
  const m = /^\s*(center|tube)\s+(?:(\d+)\s*:\s*)?(.+)$/.exec(text);
  if (!m) throw new NotationError(`expected "center ..." or "tube ...", got "${text}"`);
  const kind = m[1] as Start["kind"];
  const beads = parseStitchList(m[3]!).flatMap(expandFixed).flatMap(stitchBeads);
  if (m[2] !== undefined && Number(m[2]) !== beads.length) {
    throw new NotationError(`says ${m[2]} beads but lists ${beads.length}`);
  }
  if (beads.length === 0) throw new NotationError("the start ring needs at least one bead");
  return { kind, beads };
}

function parseRound(key: string, value: unknown): RoundSpec {
  const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(key);
  if (!range) throw new NotationError('the key must be a round number or a range such as "3-10"');
  const from = Number(range[1]);
  const to = range[2] === undefined ? from : Number(range[2]);
  if (to < from) throw new NotationError("the range ends before it starts");

  const options = typeof value === "string" ? { stitches: value } : value;
  if (!isRecord(options) || typeof options.stitches !== "string") {
    throw new NotationError("expected a stitch string, or a mapping with `stitches`");
  }
  const edge = options.edge ?? "front";
  if (edge !== "front" && edge !== "back") throw new NotationError("`edge` must be front or back");
  const tension = options.tension ?? "normal";
  if (tension !== "normal" && tension !== "tight" && tension !== "loose") {
    throw new NotationError("`tension` must be normal, tight or loose");
  }
  return {
    from,
    to,
    stitches: parseStitchList(options.stitches),
    text: options.stitches,
    edge,
    tension,
    note: typeof options.note === "string" ? options.note : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
