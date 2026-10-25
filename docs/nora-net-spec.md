# Nora Net Designer: Spec

**Status: draft for review.** Meets the requirements in [nora-net-requirements.md](nora-net-requirements.md) (referenced as N1, N2, …). The bead structure is described in [nora-net-design.md](nora-net-design.md).

## Where it lives

A fourth page in the web app, linked from the top bar as **Nora**, next to **Flat**.

| File | What it holds |
|---|---|
| `web/nora.html`, `web/nora.ts` | The page: canvas, tools, symmetry, palette, panels |
| `web/nora-canvas.ts` | Drawing the net on a `<canvas>` |
| `src/nora/net.ts` | The lattice: slot and group coordinates, which slots a group has, where each bead sits, hit testing |
| `src/nora/design.ts` | The design model and all edits: paint, erase, fill, blocks, symmetry, checks, bead counts |
| `src/nora/format.ts` | `.nora.yaml` to and from the design |
| `src/nora/chart.ts` | Printable SVG chart and the bead list by group |

Reused from the flat designer, unchanged:

- `src/flat/beads.ts`: `resolveBeadSize`, `catalogColors`, `allBeadSizes`, and `resolveFlatBeads`, which now takes any design with `bead` and `beads`, so both designers call it.
- `src/flat/view.ts`: `View`, `toScreen`, `toMm`, `zoomAt`, `clampZoom`. The Nora view has no turn (the net looks the same turned a quarter), so `turned` is always off.
- `src/flat/chart.ts`: `gramsToBuy` and `SPARE`.
- `src/flat/color.ts` is not needed: there is no picture import.

`vite.config.ts` gets `nora: page("nora.html")`. Everything in `src/nora/` is plain TypeScript with no DOM, tested with Vitest in `test/nora-*.test.ts`.

## 1. The lattice (N2)

### Groups

A group is addressed by **(i, j)**, any integers: i is the column, j the row (down).

- **(i + j) even**: a group of 8.
- **(i + j) odd**: a group of 4.

### Slots

A slot is addressed on a grid twice as fine, **(x, y)**. Group (i, j) is at (2i, 2j). (x, y) is a **slot** when x and y are not both even; when both are even it is a group's middle, which is a hole. The key for a slot in maps and sets is the string `"x,y"`.

| Slot | Kind | Its two groups |
|---|---|---|
| x odd, y even | side, between left and right | (⌊x/2⌋, y/2) and (⌈x/2⌉, y/2) |
| x even, y odd | side, between up and down | (x/2, ⌊y/2⌋) and (x/2, ⌈y/2⌉) |
| x odd, y odd | diagonal, between two 8s | with i = ⌊x/2⌋, j = ⌊y/2⌋: (i, j) and (i+1, j+1) if i + j is even, else (i+1, j) and (i, j+1) |

`slotGroups(slot)` returns the two groups. A side slot always joins a 4 and an 8; a diagonal slot joins two 8s.

### A group's slots, in ring order

Clockwise from the top. `groupSlots(group)` returns them in this order, which is also the order the bead list uses (§8.2).

- **Group of 4** at (i, j): (2i, 2j−1), (2i+1, 2j), (2i, 2j+1), (2i−1, 2j).
- **Group of 8** at (i, j): (2i, 2j−1), (2i+1, 2j−1), (2i+1, 2j), (2i+1, 2j+1), (2i, 2j+1), (2i−1, 2j+1), (2i−1, 2j), (2i−1, 2j−1).

### Neighbors in a ring

Two slots are **ring neighbors** when they are next to each other in some group's ring order. Each side slot has 4 ring neighbors (two in each of its groups); a diagonal slot has 4 too. Fill (§4) spreads along ring neighbors, because those beads touch in the real net.

## 2. Geometry (N3)

The net is drawn as a regular octagon-and-square tiling with one bead on the middle of each edge.

### Sizes

From the piece's bead (`resolveBeadSize`): **d** = outer diameter, **w** = length along the hole.

- **Edge length e = √2 · d.** In a group of 4 the bead centers are e / √2 apart, so this makes them just touch, as they do when the thread is pulled tight. A group of 8 then has small gaps between its beads, as in the reference earrings.
- **Group spacing L = (1 + √2) · d** ≈ 2.41 d, the distance between the middles of neighboring groups. For a round 8/0 (d = 3.0 mm) that is 7.2 mm.

Width and height of a piece in mm come from its painted beads' positions plus one bead diameter.

### Where a bead sits

Group (i, j) has its middle at (i · L, j · L) mm, y down.

- **Side slot**: on the line between its two groups, **L / √2 from the middle of its 8** (and L − L / √2 from the middle of its 4).
- **Diagonal slot**: halfway between its two 8s, at (x · L / 2, y · L / 2).

### Which way a bead points

The hole runs along the edge:

| Slot | Angle |
|---|---|
| x even, y odd (above or below a 4) | 0° (lies across) |
| x odd, y even (left or right of a 4) | 90° (stands up) |
| diagonal, 8s at (i, j) and (i+1, j+1) | −45° (`/`) |
| diagonal, 8s at (i+1, j) and (i, j+1) | 45° (`\`) |

`slotCenter(slot, d)` and `slotAngle(slot)` give these. Each bead is drawn as its catalog `shape` in a `w × d` box turned by its angle.

### Hit testing

`slotAt(x, y, d)`: the slot whose center is nearest the point, among the slots around the nearest group middle; none if the nearest is more than d away (the point is in a hole).

## 3. The design model

```ts
interface NoraDesign {
  title: string;
  /** The one bead size for the piece, e.g. "miyuki round 8". */
  bead: string;
  /** Bead keys used in the slots → `beads:` entry, as in the flat designer. */
  beads: Map<string, unknown>;
  /** Filled slots: "x,y" → bead key. Empty slots are absent. */
  slots: Map<string, string>;
  symmetry: Symmetry;
}

interface Symmetry {
  mode: "off" | "left-right" | "up-down" | "both";
  /** The vertical axis runs through group column `column`, the horizontal one through group row `row`. */
  column: number;
  row: number;
}
```

A new design is `miyuki round 8` with symmetry `left-right` at column 0, row 0 (N15).

The canvas has no edges (N4): `slots` is sparse and any slot can be filled. There is no trim, since a Nora piece's outline is the beads themselves.

Bead keys are one character, `A–Z a–z 0–9`, as in the flat designer (`isFlatKey`, `nextFlatKey` are reused). `.` and `+` are reserved for the file (§7).

All edits are pure functions `NoraDesign → NoraDesign`, so undo is a stack of designs (§6).

## 4. Tools (N8–N14)

| Tool | Key | Action |
|---|---|---|
| Paint | B | Click or drag paints the selected bead |
| Erase | E | Click or drag removes beads. Right-click erases with any tool |
| Pick | I | Click selects the bead under the pointer. Alt-click picks with any tool |
| Fill | G | Recolors every bead connected to the clicked one through ring neighbors (§1) that has the same bead |
| Select | M | Drag a rectangle, then move, copy, cut, paste or delete |
| Hand | H | Drag pans. Space + drag, middle-drag and two-finger drag pan with any tool |

**Bead by bead.** Paint and Erase work on one bead at a time; there is no tool that paints a whole group at once. A design is built up bead by bead, as it is stitched.

- The pointer finds a slot (`slotAt`).
- A fast drag is joined into a line, so no slot is skipped: points along the drag every d / 2 mm are hit tested (`slotsAlong`).
- While hovering, the bead under the pointer (and its mirror images) is outlined, and its two groups are outlined faintly (N7).

**Fill** spreads only over filled slots. Clicking an empty slot does nothing, so a fill can never run off across the endless canvas.

**Blocks.** A selection holds the filled slots inside its rectangle. A block moves by whole group steps (di, dj) with **di + dj even**, so 8s stay on 8s (N13); dragging snaps to the nearest such step. Moving it in slots is (2·di, 2·dj). Copy, cut and paste work as in the flat designer, with the `beads:` entries carried along, so a block pastes into another design too. Dropping is one undo step.

Each stroke, fill, paste or block drop is one undo step (N14).

## 5. Symmetry (N15–N20)

### Mirroring a slot

With the vertical axis on group column a, and the horizontal axis on group row b:

- **Left–right**: (x, y) → (4a − x, y).
- **Up–down**: (x, y) → (x, 4b − y).
- **Both**: the two above and (4a − x, 4b − y).

Group (i, j) mirrors to (2a − i, j) and (i, 2b − j). Both keep i + j's parity, so 8s land on 8s (N17). A diagonal slot mirrors to a diagonal slot of the other direction (`/` ↔ `\`), which follows from the formula. Slots on the axis (x = 2a, or y = 2b) mirror onto themselves.

`mirrorSlots(slots, symmetry)` returns each slot with its mirror images, without repeats. Every paint and erase goes through it, so one stroke paints in two or four places and is one undo step (N16). Fill fills from the clicked bead, then repeats from each mirror image. Select and paste are not mirrored: a block is placed where it is dropped.

### The axis on the canvas (N18)

Each axis is a thin dashed line through the middles of its column or row of groups, with a triangle marker in the ruler (top for the vertical axis, left for the horizontal one). Dragging the marker moves the axis to the nearest group column or row, as one undo step. The axis is part of the design and is saved in the file.

### Make symmetric (N19)

A menu under the Symmetry control: **Left onto right**, **Right onto left**, **Top onto bottom**, **Bottom onto top**. For left onto right with the axis at column a: every slot with x > 2a is cleared, then each filled slot with x < 2a is copied to (4a − x, y). Slots on the axis stay. One undo step.

### Check symmetry (N20)

For each axis that is on, a slot is **off** when it and its mirror image don't hold the same bead (one empty and one filled counts). **Check symmetry** outlines the off slots in red and says how many ("6 beads don't match their mirror"). The outline stays until the next edit.

## 6. Stitchability (N21–N23)

`groupState(design, group)`: **empty** (no filled slots), **complete** (all filled) or **open** (some filled).

An open group is not a problem by itself: in a lone flower, the 8s on its diagonals each have three beads from the petals and the ring, and that is how the flower is stitched. What matters is whether every bead is held by a closed ring.

- **Loose beads** (N21). A bead is **loose** when neither of its groups is complete (`looseSlots`). The **open rings** to point out are the open groups with a loose bead in them (`openGroups`). While there are loose beads, the status bar ends with a small count, *"· 4 loose beads"*, and a **Remove loose beads** link (one undo step). Clicking the count marks them on the canvas: the open rings in orange and the loose beads in red; clicking again hides the marks. It is a count, not a banner, because painting bead by bead leaves beads loose until each ring closes. Painting the missing beads of a marked ring closes it.
- **Loose parts** (N22). The complete groups are joined into parts through shared slots. If there is more than one part, the count also says *"2 loose parts"*, and the marks outline every part but the biggest in blue.

`completeGroup` and `clearGroup` (clear a ring's beads, except those a complete neighbor needs) are in the model and tested, for a per-ring menu later.

Both checks only warn (N23). They run on the whole design after each edit.

## 7. Saving and undo (N14, N29, N30)

- **Undo**: a stack of up to 200 designs, as in the flat designer. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, plus buttons.
- **Browser copy**: the design's YAML (§7.1) under `bead-model:nora-draft` in `localStorage`, half a second after each change.
- **View** (pan and zoom) is a per-browser setting under `bead-model:nora-view`, not in the file.

### 7.1 File format

```yaml
kind: nora-net
title: Flower
bead: miyuki round 8      # one size for the whole piece: "<brand> <line> <size>"
beads:
  G: { color: lime green, display: { rgb: "#8cc63f" } }   # as in the flat designer's `beads:` block
  R: { color: red, display: { rgb: "#e0241b" } }
symmetry: { mode: left-right, column: 0, row: 0 }
origin: [-3, -3]          # slot (x, y) of the first character of the first line
slots: |
  ...R...
  .+R+R+.
  .RGGGR.
  R+G+G+R
  .RGGGR.
  .+R+R+.
  ...R...
```

This is the flower from the reference earrings: a group of 8 in green at (0, 0), with groups of 4 in red on its four sides. Each petal shows three red beads and shares its fourth, a green one, with the ring.

- `slots` is the slot grid, one line per y and one character per x, starting at `origin`. It is not to scale: the real net is drawn with the geometry of §2.
- `+` marks a group's middle (x and y both even). The loader checks that every `+` is at such a place and every such place is `+`, so a shifted line is caught with its line number.
- `.` is an empty slot. Any other character is a bead key from `beads`.
- The writer uses the smallest box around the filled slots. Trailing `.` may be left off. Comments are allowed but not kept on save.
- `bead` and `beads` are resolved and checked as in the flat designer; an entry that isn't the piece's bead size is reported with its key.

## 8. Output

### 8.1 Bead list, to buy (N26)

Each bead key with its swatch, name and product code, the count, and grams to buy (`gramsToBuy`, with `SPARE`). The count is the number of filled slots, so a shared bead counts once. Shown in the side panel, updated live.

### 8.2 Bead list, by group (N27)

A **By ring** section in the side panel: each complete group, top to bottom then left to right, as its address, size and its beads in ring order (§1), with runs joined (also across the start of the ring): *"Ring 0, 0 (8): 8G"*, *"Ring 0, −1 (4): 3R, 1G"*. The first 500 are listed.

### 8.3 Printable chart (N31)

`chart.ts` writes an SVG in mm: the title, the bead size, bead count, size in cm and how many rings aren't closed; the net drawn to the geometry of §2 at a scale where a bead is 5 mm across, with faint outlines of the closed rings behind the beads and the symmetry axes; and the bead list to buy. Like the flat chart for now, it is one sheet as big as the piece needs.

### 8.4 Later (N32, N33)

PNG export draws the canvas offscreen at a chosen scale. The ring-by-ring stitching guide orders the complete groups so each new ring shares at least one bead with the rings before it (a walk outward from the top group), and lists each ring's new beads. Both are Could.

## 9. Drawing the canvas (N3, N5)

One `<canvas>` with the 2D API, as in the flat designer.

- **Visible slots only**: the view's rectangle in mm, turned into a group range (i0…i1, j0…j1) with one group of margin, and every slot of those groups looked up in `slots`.
- **Empty slots** are faint outlines of the bead shape at the slot's angle (N1). Group outlines (octagons and squares) are drawn fainter still, so the 4s and 8s read on an empty canvas.
- **Level of detail**: under ~6 px per bead, filled squares, and the group and empty slot outlines are left out; above that, the bead shape with an outline.
- **Rulers**: group column numbers along the top and row numbers down the left, step from `rulerStep`.
- **Redraw** on a `requestAnimationFrame` after any change; high-DPI as in the flat designer.

**Fit to beads** frames the filled slots. A new design starts with group (0, 0) in the middle at about 20 px per bead. Wheel and trackpad work as in the flat designer. The view (pan and zoom) is kept as is: Nora coordinates don't move when a file is reopened, since the file stores `origin`.

## 10. Testing

Unit tests in `test/nora-*.test.ts`:

- **net**: every slot has exactly two groups and is in both of their ring lists; a group of 4 has 4 slots and one of 8 has 8; each 4 touches four 8s; each 8 touches four 4s and four 8s; neighboring beads in a group of 4 are exactly d apart (§2); hit testing returns the slot or group whose center was given, and nothing in a hole.
- **design**: painting a ring fills its slots and recolors the shared ones; erasing; fill stops at a different bead and never spreads into empty slots; blocks only move by steps with di + dj even.
- **symmetry**: mirroring keeps 8s on 8s for any axis; `/` mirrors to `\`; a slot on the axis mirrors to itself; mirroring twice gives back the slot; make symmetric gives a design with nothing off.
- **checks**: open rings found; Clear keeps beads a complete neighbor needs; two separated flowers are two parts.
- **format**: the flower above and every example in `patterns/nora/` load and save back the same; a misplaced `+` and an unknown key give errors with line numbers.
- **chart**: bead list counts each shared bead once (the flower: 8 green, 12 red); by-ring lines for the flower.

Manual check in the browser: the "Done when" list in the requirements.

## 11. Build order

1. Lattice, geometry and tests (§1, §2).
2. Design model, file format and tests (§3, §7.1).
3. Canvas drawing, pan and zoom, Paint and Erase, Pick, undo, browser copy (§4, §7, §9).
4. Symmetry: mirrored painting and the axis (§5), then make symmetric and check symmetry.
5. Open rings and loose parts (§6), bead list to buy (§8.1).
6. Chart download (§8.3), bead list by ring (§8.2).
7. The Should items left: Fill, Select, replace one color everywhere (N28).

Also: check the catalog's round 8/0 and 6/0 colors, which Nora work uses most (see Dependencies in the requirements).

**Status:** steps 1–6 and Fill are done, with tests in `test/nora-net.test.ts` and `test/nora-design.test.ts` and an example in `patterns/nora/`. Still to do: Select with move, copy and paste (§4 Blocks, N13), replace one color everywhere (N28), a per-ring Complete / Clear menu (§6), PNG export and the stitching guide (N32, N33, Could), and more round 8/0 and 6/0 colors in the catalog (Miyuki round 8/0 has three).

## Decisions to make in review

1. **Bead spacing.** e = √2 · d makes a group of 4 tight and leaves gaps in a group of 8. Should the spacing be set by the group of 8 instead, or be adjustable?
2. **No trim.** The flat designer trims to a rectangle; a Nora piece has no rectangle, so there is none here. Is that right?
3. **Shared code.** Pull the palette and bead panel out of `web/flat.ts` into a shared module now, or copy them as the flat designer copied from the editor?
