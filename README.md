# Bead Bench

A workspace for modeling beadwork: generating, visualizing, and experimenting with bead patterns and their 3D structures. (The repository and the Cloudflare Worker are still called `bead-model`.)

**Demo:** https://bead-model.bead-model.workers.dev (on Cloudflare; the old https://bead-model.vercel.app points there once the move is deployed)

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

This opens the web app at http://localhost:5173 on **Home**: a feed of designs, with your pinned designs first, then your newest, then the examples that come with the app. The search box finds designs by title or technique, and catalog beads by code, name or size (click a bead to add it to My beads, or take it off). Each card opens the design in its designer (an example opens as a copy, which becomes yours once you change it), and a circular peyote design can be stepped through. ☆ pins a design to the top. The **+** tiles start a new design in each technique.

**My profile** (http://localhost:5173/profile.html) shows your designs, in every technique, and your beads. Everything you make in a designer is kept in **My designs** in the browser as you work (a new design or an example once you change it, a file as soon as you open it), so **New** no longer replaces your last design. Designs can be opened, pinned or deleted here, and the beads tab links to My beads to change them. Your name is only shown on this page. How it is saved: [docs/my-designs.md](docs/my-designs.md).

The step viewer (http://localhost:5173/steps.html, or **Step through** on a card) shows a circular peyote pattern step by step. Pick a pattern (or open your own `.peyote.yaml`) and step through it. Each step is one round, except a tube start, where rounds 1 and 2 are strung together as one step. The instructions are on the left; the diagram on the right shows the current step numbered in pickup order, with the other rounds faded. Arrow keys move between steps, and clicking a bead jumps to its step. **3D shape** switches the right side to an interactive 3D model of the piece as built up to the current step: drag to turn it, scroll to zoom. Below it, a chart compares each round's growth with what a flat piece needs, and says what shape that makes (flat, cup, wall, curls in, or ruffles). "Color by shape" paints the beads by that verdict. **Model** picks how the shape is worked out: the thread-tension model (solid beads pulled together by the thread, [docs/physics-model-proposal.md](docs/physics-model-proposal.md)) or the profile model (one ring per round from the bead counts, [docs/shape-model.md](docs/shape-model.md)). `npm run build` writes a static site to `dist/`.

**Editor** (http://localhost:5173/editor.html, or **Circular** in the top bar) is for designing patterns. **New** asks whether the piece starts as a ring or a tube and how many beads the start has, and makes a pattern with just that start ring. Fill in the beads (from the catalog, or a generic size and shape with your own color), the start ring and the rounds, and the chart on the right updates as you type. Each round shows how many gaps it has and how many beads it adds, and mistakes are marked in red, with the chart still showing every round before them. Pick a bead in the palette and click or drag across the chart to paint beads (shift-click, or **Paint round**, paints a whole round). Painting a bead inside a range such as `3-10` splits off that round, so the other rounds keep their rule. **3D shape** switches the chart to the expected 3D shape, with the growth chart below it, and it updates as you edit. Click a bead in 3D to paint it, or drag to turn the piece. The **YAML** tab edits the pattern file directly. Your pattern is kept in My designs between visits, and undo covers every change to it. The **Space between rounds** and **Space between beads** sliders under the chart spread the beads out (they change the chart and the downloads, not the pattern). **Download chart** saves a printable SVG with the piece, the bead list with amounts, and every step written out. **Step through it** opens the draft in the step viewer, and **Edit in editor** in the viewer goes the other way.

**My beads** (http://localhost:5173/beads.html) is the list of beads you have. Pick a bead size and click every color you own (click again to take it off), or add a color of your own that isn't in the catalog. Each bead can have an amount and a note. The list is kept in the browser, so it's still there when you come back in the same browser. **Export as text…** shows the list as readable text, one block per bead size, to copy or download as `.txt`. **Back up (.json)** and **Restore…** move the list to another browser (restoring adds the beads you don't have yet). Tick **Only my beads** in the Editor or the Flat designer to pick only from your beads: the bead pickers, a new flat design's sizes and the image import's colors then offer only what you have, and beads in the piece that you don't have are marked "not mine". The Editor offers your catalog beads; colors of your own are used in the Flat designer. How the list is saved (and plans for accounts later): [docs/my-beads-storage.md](docs/my-beads-storage.md).

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
- `src/shape/`: works out the 3D shape: the profile model (row length, growth and height per round) and the thread-tension model (`tension.ts`)
- `src/editor/`: the editor's working copy of a pattern (to and from YAML, painting beads)
- `src/collection/`: My beads, the list of beads someone has (saved list, backup, readable text), and My designs, every design someone has made (saved list, pins, the Home feed's order and search)
- `src/gallery/`: the small pictures of designs on Home and the profile
- `web/`: the web app (Vite): Home (`index.html`), My profile (`profile.html`), the step viewer (`steps.html`), the editor (`editor.html`), the flat designer (`flat.html`), the Nora designer (`nora.html`) and My beads (`beads.html`)
- `test/`: tests (Vitest)
