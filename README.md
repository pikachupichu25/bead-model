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

This opens the web app at http://localhost:5173. Pick a pattern (or open your own `.peyote.yaml`) and step through it. Each step is one round, except a tube start, where rounds 1 and 2 are strung together as one step. The instructions are on the left; the diagram on the right shows the current step numbered in pickup order, with the other rounds faded. Arrow keys move between steps, and clicking a bead jumps to its step. **3D shape** switches the right side to an interactive 3D model of the piece as built up to the current step: drag to turn it, scroll to zoom. Below it, a chart compares each round's growth with what a flat circle needs, and says what the round does in 3D (flat, cup, wall, curls in, or wavy). "Color by shape" paints the beads by that verdict. See [docs/shape-model.md](docs/shape-model.md) for how the shape is worked out. `npm run build` writes a static site to `dist/`.

**Editor** (http://localhost:5173/editor.html, or the Editor link in the top bar) is for designing patterns. **New** asks whether the piece starts as a ring or a tube and how many beads the start has, and makes a pattern with just that start ring. Fill in the beads (from the catalog, or a generic size and shape with your own color), the start ring and the rounds, and the chart on the right updates as you type. Each round shows how many gaps it has and how many beads it adds, and mistakes are marked in red, with the chart still showing every round before them. Pick a bead in the palette and click or drag across the chart to paint beads (shift-click, or **Paint round**, paints a whole round). Painting a bead inside a range such as `3-10` splits off that round, so the other rounds keep their rule. The **YAML** tab edits the pattern file directly. Your draft is kept in the browser between visits, and undo covers every change. **Download chart** saves a printable SVG with the piece, the bead list with amounts, and every step written out. **Step through it** opens the draft in the step viewer, and **Edit in editor** in the viewer goes the other way.

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
- `src/shape/`: works out the 3D shape (growth per round, bead contacts, the solver)
- `src/editor/`: the editor's working copy of a pattern (to and from YAML, painting beads)
- `web/`: the web app (Vite): the step viewer (`index.html`) and the editor (`editor.html`)
- `test/`: tests (Vitest)
