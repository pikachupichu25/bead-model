// Plain-language descriptions of compiled rounds, for instruction lists.

import type { CompiledPattern, CompiledRound } from "./compile.js";
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

/** The instruction for a round as one or two plain sentences. */
export function describeRound(compiled: CompiledPattern, round: CompiledRound): string {
  const { start } = compiled.pattern;
  if (round.stitches.length === 0) {
    const sameKey = start.beads.every((key) => key === start.beads[0]);
    const pickup = sameKey
      ? `${start.beads.length} ${start.beads[0]}`
      : summarizeStitches(start.beads.map((key) => ({ picks: [{ count: 1, key }] })));
    if (start.kind === "center") {
      return `Pick up ${pickup} and tie them into a ring.`;
    }
    return round.round === 1
      ? `Pick up ${sameKey ? pickup : `${start.beads.length} beads, ${pickup},`} and tie them into a ring. Every other bead (1st, 3rd, 5th…) settles into round 1.`
      : `Formed by the start ring: the 2nd, 4th, 6th… beads settle half a bead higher, making round 2.`;
  }
  const from = round.edge === "back" ? "On the back edge, work" : "Work";
  return `${from} ${round.gaps} gaps: ${summarizeStitches(round.stitches)}. Then step up through bead 1.`;
}
