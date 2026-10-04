// The editor's working copy of a pattern, kept close to the YAML file so the
// two convert both ways without loss (apart from comments). The pattern is
// checked by writing it out and running it through parsePattern and
// compilePattern, so the editor and the viewer always agree.
//
// Rounds are stored in order with a count instead of round numbers, so the
// rounds always follow on from the start with no gaps.

import { parse as parseYaml, stringify } from "yaml";
import type { CompiledPattern } from "../pattern/compile.js";
import type { Edge, StepUp, Tension } from "../pattern/load.js";
import { formatStitch, type Stitch, stitchBeads } from "../pattern/notation.js";

export interface Draft {
  title: string;
  source: string;
  status: string;
  stepUp: StepUp;
  beads: DraftBead[];
  /** As written in the file, e.g. `center 3A` or `tube (1A, 1B) x16`. */
  start: string;
  rounds: DraftRound[];
}

export interface DraftBead {
  key: string;
  /** The `beads:` entry as in the YAML: a product code string, or a mapping. */
  spec: unknown;
}

export interface DraftRound {
  /** How many rounds this instruction covers. */
  count: number;
  stitches: string;
  edge: Edge;
  tension: Tension;
  note: string;
}

/** The smallest start ring of each kind. A tube also needs an even count. */
export const MIN_START_BEADS = { center: 2, tube: 4 } as const;

/**
 * A new pattern: one bead type and the start ring, with no rounds yet.
 * `count` is the number of beads strung for the start.
 */
export function emptyDraft(kind: "center" | "tube" = "center", count = kind === "center" ? 3 : 16, title = "Untitled pattern"): Draft {
  return {
    title,
    source: "original",
    status: "unverified",
    stepUp: "group",
    beads: [{ key: "A", spec: { size: "11/0", shape: "cylinder", color: "main", display: { rgb: "#4e79a7" } } }],
    start: `${kind} (1A) x${count}`,
    rounds: [],
  };
}

/** Why a start ring of this size can't be used, or undefined when it can. */
export function startCountProblem(kind: "center" | "tube", count: number): string | undefined {
  if (!Number.isInteger(count)) return "Enter a whole number of beads.";
  if (count < MIN_START_BEADS[kind]) return `A ${kind === "center" ? "ring" : "tube"} start needs at least ${MIN_START_BEADS[kind]} beads.`;
  if (count > 400) return "That's more than 400 beads. Use a smaller start.";
  if (kind === "tube" && count % 2 !== 0) return "A tube start needs an even number of beads: half go to round 1, half to round 2.";
  return undefined;
}

export function newRound(stitches: string): DraftRound {
  return { count: 1, stitches, edge: "front", tension: "normal", note: "" };
}

/** `center` or `tube`, read from the start text. */
export function startKind(start: string): "center" | "tube" {
  return /^\s*tube\b/.test(start) ? "tube" : "center";
}

/** The start text without its kind, e.g. `(1A, 1B) x16`. */
export function startBeadsText(start: string): string {
  return /^\s*(?:center|tube)\s*(?:\d+\s*:\s*)?(.*)$/.exec(start)?.[1] ?? start;
}

/** First and last round number of each draft round, in order. */
export function roundRanges(draft: Draft): { from: number; to: number }[] {
  let next = startKind(draft.start) === "tube" ? 3 : 2;
  return draft.rounds.map((r) => {
    const count = Math.max(1, Math.floor(r.count) || 1);
    const range = { from: next, to: next + count - 1 };
    next += count;
    return range;
  });
}

// ---- YAML ----

export function draftToYaml(draft: Draft): string {
  const lines: string[] = [`title: ${scalar(draft.title || "Untitled")}`];
  if (draft.source) lines.push(`source: ${scalar(draft.source)}`);
  if (draft.status) lines.push(`status: ${scalar(draft.status)}`);
  lines.push("beads:");
  for (const bead of draft.beads) lines.push(`  ${bead.key}: ${flow(bead.spec)}`);
  if (draft.beads.length === 0) lines[lines.length - 1] = "beads: {}";
  lines.push(`start: ${scalar(draft.start)}`);
  if (draft.stepUp !== "group") lines.push(`step_up: ${draft.stepUp}`);
  lines.push("rounds:");
  const ranges = roundRanges(draft);
  draft.rounds.forEach((round, i) => {
    const { from, to } = ranges[i]!;
    const key = from === to ? `${from}` : `${from}-${to}`;
    const plain = round.edge === "front" && round.tension === "normal" && !round.note;
    const value = plain
      ? scalar(round.stitches)
      : flow({
          stitches: round.stitches,
          ...(round.tension !== "normal" && { tension: round.tension }),
          ...(round.edge !== "front" && { edge: round.edge }),
          ...(round.note && { note: round.note }),
        });
    lines.push(`  ${key}: ${value}`);
  });
  if (draft.rounds.length === 0) lines[lines.length - 1] = "rounds: {}";
  return lines.join("\n") + "\n";
}

export class DraftError extends Error {}

/**
 * Reads a pattern file into a draft. Only the YAML structure is checked here;
 * stitch and counting mistakes are reported by the compiler, like in the viewer.
 */
export function draftFromYaml(text: string): Draft {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new DraftError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
  }
  if (!isRecord(doc)) throw new DraftError("the file must be a YAML mapping");

  const rounds = Object.entries(isRecord(doc.rounds) ? doc.rounds : {}).map(([key, value]) => {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(key);
    if (!range) throw new DraftError(`round "${key}": the key must be a round number or a range such as "3-10"`);
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    const options = isRecord(value) ? value : { stitches: value };
    return {
      from,
      round: {
        count: Math.max(1, to - from + 1),
        stitches: options.stitches === undefined ? "" : String(options.stitches),
        edge: options.edge === "back" ? "back" : "front",
        tension: options.tension === "tight" || options.tension === "loose" ? options.tension : "normal",
        note: typeof options.note === "string" ? options.note : "",
      } satisfies DraftRound,
    };
  });

  return {
    title: typeof doc.title === "string" ? doc.title : "Untitled",
    source: typeof doc.source === "string" ? doc.source : "",
    status: typeof doc.status === "string" ? doc.status : "",
    stepUp: doc.step_up === "first" ? "first" : "group",
    beads: Object.entries(isRecord(doc.beads) ? doc.beads : {}).map(([key, spec]) => ({ key, spec })),
    start: typeof doc.start === "string" ? doc.start : "",
    rounds: rounds.sort((a, b) => a.from - b.from).map((r) => r.round),
  };
}

// ---- Painting beads ----

/**
 * Changes one bead's type. The bead's round gets its own instruction, written
 * out in full, so a range such as `3-10` is split around it. Bead counts don't
 * change, so the pattern stays valid.
 */
export function paintBead(draft: Draft, compiled: CompiledPattern, beadId: number, key: string): Draft {
  const bead = compiled.beads[beadId];
  if (!bead) return draft;
  if (bead.gap === undefined) {
    const keys = startKeys(compiled);
    keys[bead.order - 1] = key;
    return { ...draft, start: startText(draft.start, keys) };
  }
  return rewriteRound(draft, compiled, bead.round, (stitches) =>
    stitches.map((stitch, gap) => {
      if (gap !== bead.gap) return stitch;
      const keys = stitchBeads(stitch);
      keys[bead.slot] = key;
      return { picks: runs(keys) };
    }),
  );
}

/** Changes every bead of a round to one type (both rounds of a tube start). */
export function paintRound(draft: Draft, compiled: CompiledPattern, round: number, key: string): Draft {
  const compiledRound = compiled.rounds.find((r) => r.round === round);
  if (!compiledRound) return draft;
  if (compiledRound.stitches.length === 0) {
    return { ...draft, start: startText(draft.start, startKeys(compiled).map(() => key)) };
  }
  return rewriteRound(draft, compiled, round, (stitches) =>
    stitches.map((stitch) => {
      const count = stitchBeads(stitch).length;
      return { picks: count === 0 ? [] : [{ count, key }] };
    }),
  );
}

function rewriteRound(
  draft: Draft,
  compiled: CompiledPattern,
  round: number,
  change: (stitches: Stitch[]) => Stitch[],
): Draft {
  const compiledRound = compiled.rounds.find((r) => r.round === round);
  const ranges = roundRanges(draft);
  const index = ranges.findIndex((r) => r.from <= round && round <= r.to);
  if (!compiledRound || index < 0) return draft;
  const { from, to } = ranges[index]!;
  const old = draft.rounds[index]!;
  const pieces: DraftRound[] = [];
  if (round > from) pieces.push({ ...old, count: round - from });
  pieces.push({ ...old, count: 1, stitches: writeStitches(change(compiledRound.stitches)), note: round === from ? old.note : "" });
  if (round < to) pieces.push({ ...old, count: to - round, note: "" });
  const rounds = [...draft.rounds];
  rounds.splice(index, 1, ...pieces);
  return { ...draft, rounds };
}

/**
 * Writes stitches in the notation, using the shortest repeat:
 * `2A, 1B, 2A, 1B` → `(2A, 1B) x2`, and thirty `1C` → `(1C) x30`. With no
 * repeat around the whole round, repeated runs inside it are grouped:
 * `1C, 1A, 1B, 1A, 1B` → `1C, (1A, 1B) x2`.
 */
export function writeStitches(stitches: Stitch[]): string {
  const parts = stitches.map(formatStitch);
  const n = parts.length;
  if (n <= 1) return parts.join("");
  for (let period = 1; period <= n / 2; period++) {
    if (n % period === 0 && parts.every((p, i) => p === parts[i % period])) {
      return `(${parts.slice(0, period).join(", ")}) x${n / period}`;
    }
  }
  const out: string[] = [];
  for (let i = 0; i < n; ) {
    // The run starting here that covers the most stitches, preferring short units.
    let best = { period: 1, times: 1 };
    for (let period = 1; period <= 8 && i + 2 * period <= n; period++) {
      let times = 1;
      while (i + (times + 1) * period <= n && parts.slice(i + times * period, i + (times + 1) * period).every((p, j) => p === parts[i + j])) {
        times++;
      }
      if (times > 1 && period * times > best.period * best.times) best = { period, times };
    }
    const unit = parts.slice(i, i + best.period);
    out.push(best.times > 1 ? `(${unit.join(", ")}) x${best.times}` : unit[0]!);
    i += best.period * best.times;
  }
  return out.join(", ");
}

/** Consecutive equal keys as picks: A, A, B → 2A+1B. */
function runs(keys: string[]): Stitch["picks"] {
  const picks: Stitch["picks"] = [];
  for (const key of keys) {
    const last = picks[picks.length - 1];
    if (last?.key === key) last.count++;
    else picks.push({ count: 1, key });
  }
  return picks;
}

function startKeys(compiled: CompiledPattern): string[] {
  return [...compiled.pattern.start.beads];
}

function startText(start: string, keys: string[]): string {
  return `${startKind(start)} ${writeStitches(keys.map((key) => ({ picks: [{ count: 1, key }] })))}`;
}

// ---- Bead keys ----

/** The first unused key: A, B, ... Z, then A2, B2, ... */
export function nextBeadKey(draft: Draft): string {
  const used = new Set(draft.beads.map((b) => b.key));
  for (let n = 1; ; n++) {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const key = n === 1 ? letter : `${letter}${n}`;
      if (!used.has(key)) return key;
    }
  }
}

/** Renames a bead key everywhere it is used: the bead list, the start and every round. */
export function renameBeadKey(draft: Draft, from: string, to: string): Draft {
  if (from === to) return draft;
  const re = new RegExp(`(\\d\\s*)${escapeRegExp(from)}(?![A-Za-z0-9_])`, "g");
  const swap = (text: string) => text.replace(re, `$1${to}`);
  return {
    ...draft,
    beads: draft.beads.map((b) => (b.key === from ? { ...b, key: to } : b)),
    start: swap(draft.start),
    rounds: draft.rounds.map((r) => ({ ...r, stitches: swap(r.stitches) })),
  };
}

export function isValidKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key);
}

// ---- Helpers ----

function scalar(value: string): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

function flow(value: unknown): string {
  return stringify(value, { collectionStyle: "flow", lineWidth: 0 }).trimEnd();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
