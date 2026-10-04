// Expands a Pattern into every bead, round by round, and applies the
// validation rules in docs/pattern-format.md.

import { expandStitches, formatStitch, type Stitch, stitchBeads } from "./notation.js";
import { type Edge, type Pattern, PatternError, type Tension } from "./load.js";

export interface Bead {
  /** Index into CompiledPattern.beads, in the order the beads are added. */
  id: number;
  round: number;
  key: string;
  /**
   * The two up beads this bead sits between (ids). Undefined for start beads.
   * When a round has only one gap, both are the same bead.
   */
  between?: [number, number];
  /** 0-based gap index in its round (gap i follows up bead i). Undefined for start beads. */
  gap?: number;
  /** Position within its gap (0-based) and how many beads share that gap. */
  slot: number;
  slotsInGap: number;
  /** 1-based pickup order within its step (for a tube start, the stringing order). */
  order: number;
  /** Index into CompiledPattern.steps. */
  step: number;
}

export interface CompiledRound {
  round: number;
  edge: Edge;
  tension: Tension;
  note?: string;
  /** The instruction as written (shared by every round of a range). */
  text: string;
  /** One stitch per gap, after expanding groups and fills. Empty for start rounds. */
  stitches: Stitch[];
  /** Number of gaps worked (the up beads of the round before). */
  gaps: number;
  /**
   * The up beads this round is worked into, in gap order: gap i is after
   * upBeads[i]. upBeads[0] is the bead the thread starts from. Empty for start rounds.
   */
  upBeads: number[];
  /** Bead ids added in this round, in pickup order. The first one is the step-up bead. */
  beads: number[];
}

/**
 * What a beader does in one pass of the needle. Usually one round, but a tube
 * start strings rounds 1 and 2 together, so they are one step.
 */
export interface CompiledStep {
  rounds: CompiledRound[];
  /** Bead ids in pickup order. The first one is the step-up bead. */
  beads: number[];
}

export interface CompiledPattern {
  pattern: Pattern;
  rounds: CompiledRound[];
  steps: CompiledStep[];
  beads: Bead[];
  warnings: string[];
}

export function compilePattern(pattern: Pattern): CompiledPattern {
  const errors: string[] = [];
  const warnings: string[] = [];
  const beads: Bead[] = [];
  const rounds: CompiledRound[] = [];

  const defined = new Set(Object.keys(pattern.beads));
  const checkKeys = (keys: string[], where: string) => {
    for (const key of new Set(keys)) {
      if (!defined.has(key)) errors.push(`${where}: bead "${key}" is not defined in \`beads\``);
    }
  };

  const addBead = (round: number, key: string, order: number, extra: Partial<Bead> = {}): number => {
    const id = beads.length;
    beads.push({ id, round, key, slot: 0, slotsInGap: 1, order, step: -1, ...extra });
    return id;
  };

  // The start ring. `front` and `back` are the up beads each edge works from.
  const { start } = pattern;
  checkKeys(start.beads, "start");
  let front: number[];
  let back: number[] | undefined;
  if (start.kind === "center") {
    const ids = start.beads.map((key, i) => addBead(1, key, i + 1));
    rounds.push(startRound(1, ids));
    front = ids;
  } else {
    if (start.beads.length % 2 !== 0) {
      errors.push(`start: tube needs an even number of beads, got ${start.beads.length}`);
    }
    // Odd positions settle into round 1, even positions into round 2. Both are
    // strung in one go, so beads are numbered in stringing order.
    const r1: number[] = [];
    const r2: number[] = [];
    start.beads.forEach((key, i) => {
      if (i % 2 === 0) r1.push(addBead(1, key, i + 1));
      else r2.push(addBead(2, key, i + 1));
    });
    rounds.push(startRound(1, r1), startRound(2, r2));
    front = r2;
    back = r1;
  }

  // Rounds must follow on from the start with no gaps or overlaps.
  let next = rounds.length + 1;
  // After an error in a round, later rounds would only report knock-on errors, so stop.
  specs: for (const spec of pattern.rounds) {
    if (spec.from !== next) {
      errors.push(
        spec.from < next
          ? `round ${spec.from}: listed twice (or it overlaps the start ring)`
          : `round ${next}: missing (the next listed round is ${spec.from})`,
      );
      if (spec.from < next) continue;
    }
    checkKeys(spec.stitches.length ? itemKeys(spec.stitches) : [], `round ${spec.from}`);

    for (let r = spec.from; r <= spec.to; r++) {
      if (spec.edge === "back" && back === undefined) {
        errors.push(`round ${r}: edge: back needs a tube start`);
        break specs;
      }
      const upBeads = spec.edge === "back" ? back! : front;
      let stitches: Stitch[];
      try {
        stitches = expandStitches(spec.stitches, upBeads.length);
      } catch (e) {
        errors.push(`round ${r}: ${e instanceof Error ? e.message : String(e)}`);
        break specs;
      }
      if (stitches.length !== upBeads.length) {
        errors.push(
          `round ${r}: lists ${stitches.length} stitches, but the round before added ${upBeads.length} beads, so there are ${upBeads.length} gaps`,
        );
        break specs;
      }

      const added: number[] = [];
      stitches.forEach((stitch, gap) => {
        const keys = stitchBeads(stitch);
        const left = upBeads[gap]!;
        const right = upBeads[(gap + 1) % upBeads.length]!;
        keys.forEach((key, slot) => {
          added.push(
            addBead(r, key, added.length + 1, { between: [left, right], gap, slot, slotsInGap: keys.length }),
          );
        });
      });

      if (added.length === 0) {
        errors.push(`round ${r}: every stitch is 0, so nothing is added`);
        break specs;
      }
      const zeros = stitches.filter((s) => s.picks.length === 0).length;
      if (zeros > stitches.length / 2) {
        warnings.push(`round ${r}: ${zeros} of ${stitches.length} stitches are 0. Check this is meant to pull in`);
      }

      rounds.push({
        round: r,
        edge: spec.edge,
        tension: spec.tension,
        note: spec.note,
        text: spec.text,
        stitches,
        gaps: upBeads.length,
        upBeads,
        beads: added,
      });
      // The next round on this edge starts from the bead the step-up comes out of.
      const next = startFrom(added, stitches, pattern.stepUp);
      if (spec.edge === "back") back = next;
      else front = next;
    }
    next = spec.to + 1;
  }

  if (errors.length > 0) throw new PatternError(errors);

  // A tube start's two rounds are one step; every other round is its own step.
  const steps: CompiledStep[] =
    start.kind === "tube"
      ? [
          { rounds: rounds.slice(0, 2), beads: [...rounds[0]!.beads, ...rounds[1]!.beads].sort((a, b) => a - b) },
          ...rounds.slice(2).map((r) => ({ rounds: [r], beads: r.beads })),
        ]
      : rounds.map((r) => ({ rounds: [r], beads: r.beads }));
  steps.forEach((step, i) => step.beads.forEach((id) => (beads[id]!.step = i)));

  return { pattern, rounds, steps, beads, warnings };

  function startRound(round: number, ids: number[]): CompiledRound {
    return {
      round,
      edge: "front",
      tension: "normal",
      text: `${start.kind} ${start.beads.length}`,
      stitches: [],
      gaps: 0,
      upBeads: [],
      beads: ids,
    };
  }
}

/**
 * A round's beads reordered to start at the bead the step-up comes out of, so
 * they are the up beads of the next round in gap order. The step-up goes
 * through the round's first stitch: all of it ("group"), or its first bead.
 */
export function startFrom(added: number[], stitches: Stitch[], stepUp: "group" | "first"): number[] {
  const firstGroup = stitches.find((s) => s.picks.length > 0)!;
  const exit = stepUp === "group" ? stitchBeads(firstGroup).length - 1 : 0;
  return [...added.slice(exit), ...added.slice(0, exit)];
}

function itemKeys(items: Pattern["rounds"][number]["stitches"]): string[] {
  return items.flatMap((item) =>
    item.kind === "group" ? itemKeys(item.items) : item.stitch.picks.map((p) => p.key),
  );
}

/** Short summary of a compiled round's stitches, e.g. `2A, 1B, 1B, 2A, ...`. */
export function describeStitches(round: CompiledRound, max = 10): string {
  const parts = round.stitches.map(formatStitch);
  return parts.length <= max ? parts.join(", ") : `${parts.slice(0, max).join(", ")}, … (${parts.length} gaps)`;
}
