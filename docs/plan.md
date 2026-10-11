# Plan: Circular Peyote 3D Model

## 1. Research how 3D peyote bead patterns are written

Find out how beaders write circular and 3D peyote patterns today.

- Collect example patterns (books, blogs, tutorials, pattern shops)
- Note the notation used: round numbers, bead counts, increases ("2 beads in one stitch"), step-ups, colors, bead sizes
- Note how the patterns show a shape that is flat, cupped, or ruffled
- Write the findings up in `docs/research.md`

## 2. Design how our system uses written patterns

Choose a pattern format that is both readable by people and parseable by code.

- Define the data model: bead, stitch, round, increase, color
- Choose a text format (for example a small DSL, or YAML/JSON) that maps closely to how patterns are written
- Write the format spec in `docs/pattern-format.md`, with worked examples taken from step 1

## 3. Create a step-by-step pattern with bead images

Render a pattern one round at a time as a 2D diagram of beads.

### 3.1 Research commercial beads and design the bead catalog

The diagram has to draw each bead to scale and in its real color, so first we need to know what real beads look like.

- Research the shapes and sizes of beads from popular brands (Miyuki, Toho, Preciosa): outer diameter, length along the hole, hole size, beads per gram, and how product and color codes are written
- Write the findings up in `docs/bead-research.md`
- Design the data structure for a catalog of commercial beads (brand, product line, size, color), and how a pattern's `beads:` block points to it
- Write the catalog spec in `docs/bead-catalog.md`, with worked examples from the research

### 3.2 Render the round-by-round diagram

- Draw each bead as an image or shape, colored according to the pattern
- Show which beads are new in each round and where the step-up is
- Output one image per round (or a combined sheet) so the pattern can be followed while stitching

## 4. Create the expected 3D shape from the pattern

Compute and display the 3D form the pattern produces. Done as a second, simplified version, see [shape-model.md](shape-model.md) and the [critique](shape-model-critique.md) of the first. Calibrating against photos of real pieces is still to do.

- Place each bead in 3D (position and orientation) from the round and increase data
- Show how the bead count per round makes the piece flat, cupped, or ruffled
- Render an interactive 3D view and compare it against photos of real stitched pieces
