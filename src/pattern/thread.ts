// The path the thread takes in one step, as the beads it passes through in
// order. A bead can appear twice (the thread passes through it again).

import type { CompiledPattern } from "./compile.js";

/**
 * Bead ids the thread passes through during a step, in order.
 *
 * - Start ring: through every bead in stringing order, then through the
 *   first bead again to close the ring.
 * - Worked round: starts in the step-up bead of the round before (up bead 1).
 *   For each gap, through the beads picked up for it, then through the next
 *   up bead. After the last gap that is up bead 1 again, and the round ends by
 *   stepping up through the round's first stitch: all of its beads, or only
 *   the first with `step_up: first` (and any up beads before it, when the
 *   first gaps are `0`).
 */
export function threadPasses(compiled: CompiledPattern, stepIndex: number): number[] {
  const step = compiled.steps[stepIndex];
  if (!step) throw new Error(`step ${stepIndex} does not exist`);

  const first = compiled.beads[step.beads[0]!]!;
  if (!first.between) return [...step.beads, step.beads[0]!];

  const round = step.rounds[0]!;
  const { upBeads } = round;
  const byGap = new Map<number, number[]>();
  for (const id of step.beads) {
    const gap = compiled.beads[id]!.gap!;
    byGap.set(gap, [...(byGap.get(gap) ?? []), id]);
  }

  const passes = [upBeads[0]!];
  for (let gap = 0; gap < upBeads.length; gap++) {
    passes.push(...(byGap.get(gap) ?? []), upBeads[(gap + 1) % upBeads.length]!);
  }
  // The step-up: through the round's first stitch, all of it or only its
  // first bead (the pattern's step_up). If the first gaps had no bead (`0`),
  // their up beads come first, as the thread passes them as one unit.
  let firstGap = 0;
  for (; !byGap.has(firstGap); firstGap++) passes.push(upBeads[firstGap + 1]!);
  const firstStitch = byGap.get(firstGap)!;
  passes.push(...(compiled.pattern.stepUp === "group" ? firstStitch : firstStitch.slice(0, 1)));
  return passes;
}
