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
npm run dev
```

This opens the web app at http://localhost:5173. Pick a pattern (or open your own `.peyote.yaml`) and step through it. Each step is one round, except a tube start, where rounds 1 and 2 are strung together as one step. The instructions are on the left; the diagram on the right shows the current step numbered in pickup order, with the other rounds faded. Arrow keys move between steps, and clicking a bead jumps to its step. **3D shape** switches the right side to an interactive 3D model of the piece as built up to the current step: drag to turn it, scroll to zoom. Below it, a chart compares each round's growth with what a flat piece needs, and says what shape that makes (flat, cup, wall, curls in, or ruffles). "Color by shape" paints the beads by that verdict. See [docs/shape-model.md](docs/shape-model.md) for how the shape is worked out. `npm run build` writes a static site to `dist/`.

To write SVG files instead:

```bash
npm run render -- patterns/03-flat-triangle.peyote.yaml
```

This writes one SVG per step (`step-NN.svg`), plus a `sheet.svg` with every step, to `out/<pattern>/`, and prints the bead counts, what each round does in 3D, and any warnings. Each image numbers the new beads in pickup order, circles the step-up bead, and fades the earlier rounds.

```bash
npm test
```

## Structure

- `docs/`: plans, research notes, and specs
- `patterns/`: patterns in our format (`*.peyote.yaml`), see [docs/pattern-format.md](docs/pattern-format.md)
- `catalog/beads/`: commercial bead sizes and colors, see [docs/bead-catalog.md](docs/bead-catalog.md)
- `src/pattern/`: reads and checks patterns, and works out every bead
- `src/catalog/`: loads the catalog and resolves a pattern's beads
- `src/diagram/`: lays the beads out and draws the step-by-step SVGs
- `src/shape/`: works out the 3D shape (row length, growth and height per round, then each bead's place)
- `web/`: the step-by-step web app (Vite)
- `test/`: tests (Vitest)
