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
   1. Research commercial beads (Miyuki, Toho, Preciosa) and design the bead catalog
   2. Render the round-by-round diagram
4. Create the expected 3D shape from the pattern

## Usage

Needs Node 22 or later.

```bash
npm install
npm run render -- patterns/03-flat-triangle.peyote.yaml
```

This writes one SVG per round, plus a `sheet.svg` with every round, to `out/<pattern>/`, and prints the bead counts and any warnings. Each round image numbers the new beads in pickup order, circles the step-up bead, and fades the earlier rounds.

```bash
npm test
```

## Structure

- `docs/`: plans, research notes, and specs
- `patterns/`: patterns in our format (`*.peyote.yaml`), see [docs/pattern-format.md](docs/pattern-format.md)
- `catalog/beads/`: commercial bead sizes and colors, see [docs/bead-catalog.md](docs/bead-catalog.md)
- `src/pattern/`: reads and checks patterns, and works out every bead
- `src/catalog/`: loads the catalog and resolves a pattern's beads
- `src/diagram/`: lays the beads out and draws the round-by-round SVGs
- `test/`: tests (Vitest)
