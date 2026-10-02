# bead-model

A workspace for modeling beadwork: generating, visualizing, and experimenting with bead patterns and their 3D structures.

## Current focus: Circular Peyote (3D)

The first goal is a 3D model of **circular peyote stitch**, where beads are added in rounds that spiral out from a center. The model should:

- Place each bead in 3D space (position and orientation) round by round
- Handle increases, so the piece can lie flat, cup, or ruffle
- Render the result so a pattern can be checked before it is stitched

## Plan

See [docs/plan.md](docs/plan.md).

1. Research how 3D peyote bead patterns are written
2. Design how our system uses written patterns
3. Create a step-by-step pattern with bead images
4. Create the expected 3D shape from the pattern

## Structure

- `docs/`: plans, research notes, and specs
