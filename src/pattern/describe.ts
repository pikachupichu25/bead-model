// Plain-language descriptions of compiled rounds, for instruction lists.

import type { CompiledPattern, CompiledStep } from "./compile.js";
import { formatStitch, type Stitch } from "./notation.js";

/**
 * Writes a round's stitches compactly by finding the shortest repeat:
 * `2A, 1B, 1B, 2A, 1B, 1B` → `(2A, 1B, 1B) ×2`, and `1C, 1C, 1C` → `1C ×3`.
 */
export function summarizeStitches(stitches: Stitch[]): string {
  const parts = stitches.map(formatStitch);
  const n = parts.length;
  for (let period = 1; period < n; period++) {
    if (n % period !== 0) continue;
    if (parts.every((p, i) => p === parts[i % period])) {
      const unit = parts.slice(0, period);
      return period === 1 ? `${unit[0]} ×${n}` : `(${unit.join(", ")}) ×${n / period}`;
    }
  }
  return parts.join(", ");
}

/** "Round 3", or "Rounds 1–2" for a step that makes two rounds at once. */
export function stepLabel(step: CompiledStep): string {
  const first = step.rounds[0]!.round;
  const last = step.rounds[step.rounds.length - 1]!.round;
  return first === last ? `Round ${first}` : `Rounds ${first}–${last}`;
}

/** The round numbers a step covers, for compact badges: "3" or "1–2". */
export function stepNumber(step: CompiledStep): string {
  return stepLabel(step).replace(/^Rounds? /, "");
}

/** The instruction for a step as one or two plain sentences. */
export function describeStep(compiled: CompiledPattern, step: CompiledStep): string {
  const { start } = compiled.pattern;
  const round = step.rounds[0]!;
  if (round.stitches.length === 0) {
    const sameKey = start.beads.every((key) => key === start.beads[0]);
    const pickup = sameKey
      ? `${start.beads.length} ${start.beads[0]}`
      : summarizeStitches(start.beads.map((key) => ({ picks: [{ count: 1, key }] })));
    if (start.kind === "center") {
      return `Pick up ${pickup} and tie them into a ring.`;
    }
    return `Pick up ${sameKey ? pickup : `${start.beads.length} beads, ${pickup},`} and tie them into a ring. The beads settle into two rounds: the 1st, 3rd, 5th… make round 1, and the 2nd, 4th, 6th… sit half a bead higher as round 2.`;
  }
  const from = round.edge === "back" ? "On the back edge, work" : "Work";
  return `${from} ${round.gaps} gaps: ${summarizeStitches(round.stitches)}. Then step up through ${stepUpBeads(compiled, step)}.`;
}

/** The beads the step-up goes through: "bead 1", "beads 1 and 2", "beads 1 to 3". */
function stepUpBeads(compiled: CompiledPattern, step: CompiledStep): string {
  const round = step.rounds[0]!;
  const first = round.stitches.find((s) => s.picks.length > 0)!;
  const count = compiled.pattern.stepUp === "group" ? first.picks.reduce((n, p) => n + p.count, 0) : 1;
  return count === 1 ? "bead 1" : count === 2 ? "beads 1 and 2" : `beads 1 to ${count}`;
}
