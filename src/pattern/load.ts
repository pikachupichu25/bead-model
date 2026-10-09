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
  /**
   * After this round, pass through its beads again, bead to bead, and pull
   * them into a ring: the opening closes like the start ring. Last round only.
   */
  close?: boolean;
}

export interface Pattern {
  title: string;
  source?: string;
  status?: string;
  /** Raw bead definitions by key. Resolved against the catalog later. */
  beads: Record<string, unknown>;
  start: Start;
  stepUp: StepUp;
  /** Diameter of the thread, mm, if the pattern gives it. */
  threadDiameter?: number;
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
        rounds.push(...parseRounds(key, value));
      } catch (e) {
        issues.push(`round ${key}: ${message(e)}`);
      }
    }
  }
  rounds.sort((a, b) => a.from - b.from);

  const stepUp = doc.step_up ?? "group";
  if (stepUp !== "group" && stepUp !== "first") issues.push("`step_up` must be group or first");

  const threadDiameter = doc.thread_diameter;
  if (threadDiameter !== undefined && !(typeof threadDiameter === "number" && threadDiameter > 0 && threadDiameter < 1)) {
    issues.push("`thread_diameter` must be the thread's diameter in mm, e.g. 0.15");
  }

  if (issues.length > 0) throw new PatternError(issues);
  return {
    title,
    source: typeof doc.source === "string" ? doc.source : undefined,
    status: typeof doc.status === "string" ? doc.status : undefined,
    beads,
    start,
    stepUp: stepUp as StepUp,
    threadDiameter: threadDiameter as number | undefined,
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

/**
 * One entry under `rounds:`. A list value is a cycle: `6-17: [A, B]` makes
 * rounds 6, 8, ... use A and rounds 7, 9, ... use B. It is expanded into one
 * spec per round, so the compiler never sees it.
 */
function parseRounds(key: string, value: unknown): RoundSpec[] {
  const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(key);
  if (!range) throw new NotationError('the key must be a round number or a range such as "3-10"');
  const from = Number(range[1]);
  const to = range[2] === undefined ? from : Number(range[2]);
  if (to < from) throw new NotationError("the range ends before it starts");
  if (!Array.isArray(value)) return [parseRound(from, to, value)];

  if (value.length === 0) throw new NotationError("the list of rounds to repeat is empty");
  if ((to - from + 1) % value.length !== 0) {
    throw new NotationError(
      `the range covers ${to - from + 1} rounds, which is not a whole number of repeats of ${value.length} rounds`,
    );
  }
  const specs: RoundSpec[] = [];
  for (let r = from; r <= to; r++) {
    try {
      specs.push(parseRound(r, r, value[(r - from) % value.length]));
    } catch (e) {
      throw new NotationError(`round ${r}: ${message(e)}`);
    }
  }
  return specs;
}

function parseRound(from: number, to: number, value: unknown): RoundSpec {
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
  const close = options.close ?? false;
  if (typeof close !== "boolean") throw new NotationError("`close` must be true or false");
  return {
    from,
    to,
    stitches: parseStitchList(options.stitches),
    text: options.stitches,
    edge,
    tension,
    note: typeof options.note === "string" ? options.note : undefined,
    ...(close && { close }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
