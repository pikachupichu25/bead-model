# Flat Peyote Designer: Spec

**Status: draft for review.** Meets the requirements in [flat-peyote-requirements.md](flat-peyote-requirements.md) (referenced as R1, R2, …).

## Where it lives

A third page in the web app, next to the step viewer and the circular editor, linked from the top bar as **Flat**.

| File | What it holds |
|---|---|
| `web/flat.html`, `web/flat.ts` | The page: canvas, tools, palette, panels |
| `web/flat-import.ts` | The import dialog |
| `src/flat/grid.ts` | Cell coordinates, the design model, bounds, trim, resize, fill |
| `src/flat/beads.ts` | The piece's bead size and its bead entries, resolved against the catalog |
| `src/flat/color.ts` | sRGB ↔ CIELAB, CIEDE2000 |
| `src/flat/import.ts` | Picture → bead grid (sampling, matching, color limit, dithering) |
| `src/flat/import.worker.ts` | Runs `import.ts` off the main thread |
| `src/flat/format.ts` | `.flat-peyote.yaml` to and from the design |
| `src/flat/chart.ts` | Printable SVG chart, word chart, bead list |

Everything in `src/flat/` is plain TypeScript with no DOM, so it is tested with Vitest like the rest of `src/`. It reuses `src/catalog/` for bead sizes and colors.

## 1. Grid geometry

### Cells

In flat peyote each column is offset by half a bead from its neighbors. A cell is addressed by **(c, h)**:

- **c**: the column, any integer.
- **h**: the stitched row, counted in **half beads**, any integer.
- A cell exists only where **c + h is even**. So column 0 has cells at h = …, −2, 0, 2, …, and column 1 at h = …, −1, 1, 3, ….

Neighboring columns are offset by one half bead, and one stitched row is exactly one value of h. This makes the word chart (§9.3) a straight read of h, and keeps the offset tied to absolute coordinates, so trimming and moving can't flip which columns sit high (R9).

The key for a cell in maps and sets is the string `"c,h"`.

### Bead size and position

The bead size comes from the design's single bead (R17), resolved from the catalog with `nominal()`:

- **w** = `length` (along the hole, which runs across the column)
- **d** = `outer_diameter`

The center of cell (c, h) is at **x = c · w, y = h · d / 2** (mm, y down). Each bead is drawn as its `shape` in a `w × d` box, as the circular diagram does. A Delica (1.30 × 1.60) is drawn taller than wide (R2).

### Neighbors

Each cell touches six others:

```
(c, h−2)                    above
(c−1, h−1)  (c+1, h−1)      upper left, upper right
(c−1, h+1)  (c+1, h+1)      lower left, lower right
(c, h+2)                    below
```

Used by fill (R14), cleanup and dithering.

### Turned view (R10)

Turning the view swaps x and y when drawing and in the downloads. The design and the file don't change.

## 2. The design model

```ts
interface FlatDesign {
  title: string;
  /** The one bead size for the piece: "<brand> <line> <size>", e.g. "miyuki delica DB". */
  bead: string;
  /** Bead keys used in the grid → `beads:` entry (product code, or a mapping with a display color). */
  beads: Map<string, unknown>;
  /** Painted cells: "c,h" → bead key. Empty cells are absent. */
  cells: Map<string, string>;
  /** undefined = unlimited canvas. */
  bounds?: Bounds;
}

interface Bounds { c0: number; c1: number; h0: number; h1: number } // inclusive
```

A cell (c, h) is **inside** bounds when `c0 ≤ c ≤ c1` and `h0 ≤ h ≤ h1`. That gives a real peyote rectangle: `c1 − c0 + 1` columns and `h1 − h0 + 1` stitched rows, with the zigzag top and bottom edge a stitched piece has.

Bead keys are one character, `A–Z a–z 0–9` (62 at most), so a grid row in the file is one character per bead. `.` and `-` are reserved (§8).

All edits are pure functions `FlatDesign → FlatDesign`, like `src/editor/draft.ts`, so undo is a stack of designs (§7).

## 3. Unlimited and trimmed canvas

### Unlimited (R1, R4)

A new design has no `bounds`. Painting is allowed at any cell. The page shows:

- A dashed outline around the **painted area**: the bounds that trim would give (below).
- In the status bar: `34 × 52 beads · 1 203 beads · 4.4 × 4.2 cm`. Width is columns, height is stitched rows; cm is `columns · w` by `(rows + 1) · d / 2`.

`cells` is sparse, so memory grows with painted beads, not with the area panned over.

### Trim (R5, R6, R9)

**Trim canvas** (disabled when nothing is painted) sets

```
bounds = { c0: min c, c1: max c, h0: min h, h1: max h }   over painted cells
```

and nothing else. No cell moves, and the parity rule keeps every column on the same side (R9). Outside the bounds the canvas is drawn grey and can't be painted.

Empty cells inside the bounds are then counted. If there are any, a banner says *"12 empty spots: a flat piece needs a bead in each"* with **Show** (highlights them) and **Fill with…** (fills them all with one bead, one undo step). The banner stays until the count is zero.

### Resize (R7)

On a trimmed canvas each edge has a handle. Dragging moves that edge in whole columns (left, right) or whole stitched rows (top, bottom). Width and height can also be typed, growing or shrinking from the bottom-right. If the new bounds would drop painted cells, the tool asks first and says how many beads go. Cells outside the bounds are deleted from `cells` when the resize is confirmed, so the file never keeps hidden beads.

### Back to unlimited (R8)

**Make unlimited** clears `bounds`. All beads stay.

## 4. Drawing the canvas (R3)

The circular editor draws SVG elements. That is too slow for 100 000 beads, so the flat canvas is one `<canvas>` drawn with the 2D API:

- **View**: a pan offset and a zoom (pixels per mm), kept in the page state, not the design.
- **Only visible cells are drawn**: loop over the columns and rows in the view, look each up in `cells`.
- **Level of detail**: when a bead is under ~6 px tall, draw plain filled rectangles; above that, draw the bead shape with its outline and a highlight; above ~24 px, also the hole.
- **Grid**: faint outlines of empty cells, so the offset is visible on an empty canvas. Every 10th column and row is a little darker, with numbers on rulers along the top and left.
- **Redraw** on a `requestAnimationFrame` after any change. Painting a stroke redraws only the touched cells.
- **High-DPI**: the canvas backing size is multiplied by `devicePixelRatio`.

**Fit to beads** sets the view to the painted area (or the bounds) with a margin. On an empty unlimited canvas, the view starts centered on cell (0, 0) at a zoom where a bead is about 20 px tall.

**Wheel.** A mouse wheel (whole steps of 50 px or more, or line steps) zooms around the pointer. A trackpad scroll (small steps) pans, and a trackpad pinch (which the browser sends as ctrl + wheel) zooms. Ctrl or ⌘ + wheel always zooms. Beads stay between 2 and 120 px tall.

The pan, zoom and screen math is in `src/flat/view.ts` (tested); the drawing is in `web/flat-canvas.ts`. Measured in Chrome: a 300 × 300 piece (45 000 beads) draws in about 14 ms zoomed all the way out and about 5 ms at normal zoom.

Hit testing turns a pointer position into a cell: `c = round(x / w)`, then `h` is the nearest value with the right parity to `2y / d`.

## 5. Tools (R11–R16)

| Tool | Key | Action |
|---|---|---|
| Paint | B | Click or drag paints the selected bead. A fast drag is joined into a line of cells so no cells are skipped |
| Erase | E | Click or drag removes beads. Right-click erases with any tool |
| Pick | I | Click selects that cell's bead. Alt-click picks with any tool |
| Fill | G | Fills the connected cells with the same bead (or the same empty) through the six neighbors |
| Select | M | Drag a rectangle, then move (drag), copy, cut, paste, delete, mirror left-right or top-bottom |
| Hand | H | Drag pans. Space + drag, middle-drag and two-finger drag pan with any tool |

**Fill on an unlimited canvas** (R14): the fill can't spread past the painted area's bounds. Filling empty space outside the painted area does nothing and says why.

**Moving a block keeps the offset.** A block (selection or import, §6.7) can only move by (dc, dh) with dc + dh even. Dragging snaps to the nearest such step, so moving one column sideways also moves the block half a bead up or down. The status bar says so while dragging.

Each stroke, fill, paste or block drop is one undo step (R16).

## 6. Import from an image (R21–R32)

### 6.1 Opening

**Import image** opens a file picker. A picture can also be dropped on the canvas or pasted (R21). It is decoded with `createImageBitmap` (PNG, JPEG, WebP, GIF first frame). Pictures larger than 4096 px on a side are scaled down to that first.

### 6.2 The dialog

Left: the picture, with a crop box (R30). Right: the bead result, drawn like the canvas. Under them:

| Setting | Default |
|---|---|
| Width in beads | 60 (max 300) |
| Height in beads | follows the picture (§6.3), or unlinked to set both |
| Colors from | the bead's catalog colors / only the design's colors / both (R24). A piece has one bead size, so its catalog colors already come from one brand and line |
| At most N colors | 12, range 2–62 (R25) |
| Merge colors with fewer than N beads | 0 = off (R29) |
| Dithering | off (R28) |
| Brightness, contrast, saturation | 0 (R30) |
| Transparent below | 50 % alpha (R27) |

Below: the colors used, each with its swatch, name, count and a ✕ to forbid it (the import reruns without it), and the average color error (ΔE). **Place** closes the dialog and starts placing (§6.7).

### 6.3 Size (R22)

The stitched piece is `W · w` mm wide and `(H + 1) · d / 2` mm tall. For it to have the picture's proportions:

```
H = round(2 · W · w · (imgH / imgW) / d) − 1      (stitched rows)
```

For a square picture 60 beads wide in Delicas, that is `2 · 60 · 1.30 / 1.60 − 1 ≈ 97` stitched rows.

### 6.4 Sampling

Each cell covers a `w × d` rectangle of the picture (in picture pixels, after crop and scaling), centered at its §1 position. The **average** color of that rectangle is used, not the pixel at its center, so thin lines and fine texture average out instead of flickering.

1. Draw the cropped picture to an offscreen canvas at `S` pixels per bead (S = 8, or less if that would exceed 4096 px), with brightness, contrast and saturation applied.
2. For each cell, average its rectangle's pixels in **linear light** (undo the sRGB curve first), weighting by alpha. Averaging raw sRGB values makes mixes too dark.
3. Mean alpha below the threshold → the cell is empty (R27). Otherwise its color is the alpha-weighted average.

### 6.5 Matching the closest color (R23)

All colors are compared in **CIELAB** (D65) with **CIEDE2000** (ΔE00), which tracks how different two colors look far better than RGB distance does, especially in blues and in darks.

- Palette colors come from each catalog color's `display.rgb`. Finish and opacity are ignored (out of scope).
- `color.ts` has `srgbToLab(rgb)` and `deltaE2000(lab1, lab2)`, tested against the published Sharma et al. test pairs.
- For speed, cell colors are rounded to whole Lab units and each distinct color is matched once.

### 6.6 Limiting the number of colors (R25)

Picking the N most-used colors after matching loses small but important details (an eye, a highlight). Instead, colors are removed one at a time, each time the one whose loss hurts least:

1. Start with every allowed palette color. Match each cell to its nearest; the colors in use are the set S.
2. While S has more than N colors: for each color in S, its **cost** is the sum over its cells of `ΔE(cell, next nearest in S)² − ΔE(cell, nearest)²`. Remove the color with the lowest cost and rematch its cells.
3. The work is done on the distinct cell colors with their counts, not on every cell, so it stays fast. Costs are kept up to date as colors go: only the cells whose nearest or second nearest color was dropped are recounted.

Squared error is used so that a few badly wrong beads count more than many slightly wrong ones.

**Merging rare colors** (R29) runs next: while some color is used by fewer than the set number of beads, its cells move to their nearest other color in S.

**Dithering** (R28), if on, replaces the plain match in the final pass. Cells are visited in order of h, then c. Each cell takes its nearest color in S, and the difference (in Lab) is passed on to the unvisited neighbors: 3/8 to lower left (c−1, h+1), 3/8 to lower right (c+1, h+1), 2/8 to below (c, h+2). Starting weights; tune them on test pictures.

### 6.7 Placing (R31)

After **Place**, the result is a floating block over the canvas, drawn semi-transparent, centered in the view. It moves by dragging or arrow keys (keeping the offset, §5). **Enter** or **Drop** paints it in; **Esc** cancels.

- Empty cells in the block leave the canvas under them as it was.
- Colors not yet in the design are added to `beads` with the next free keys. If that would pass 62 keys, Drop is blocked with a message to lower the color limit.
- On a trimmed canvas, cells of the block outside the bounds are dropped, with a warning saying how many.
- Drop is one undo step.

### 6.8 Speed (R32)

The pipeline runs in a Web Worker so the dialog stays responsive. Settings are debounced, and a result that a newer request has overtaken is dropped (a run already going isn't stopped). The picture is sampled once per size and crop, and the cell colors are reused when only the palette, the color limit, merging or dithering change.

Measured in Node on a worst case, a picture of pure noise 300 beads wide (73 000 beads, nearly every bead a different color): sampling takes 0.2 s, and matching takes 0.08 s with 20 palette colors and 0.7 s with 300. Real pictures have far fewer distinct colors.

## 7. Saving and undo (R16, R33)

- **Undo**: a stack of up to 200 designs. A design is small (a map of painted cells), and unchanged parts are shared between versions, so this is cheap. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, plus buttons.
- **Browser copy**: the design is saved to `localStorage` as its YAML (§8) under `bead-model:flat-draft`, half a second after each change. If it doesn't fit, a notice says to download the design instead. (Falling back to IndexedDB is still to do.)
- The view (pan, zoom, turn) is saved separately as a per-browser setting, not in the file. The pan is kept relative to the top-left of the piece, because reopening a file places the piece at new coordinates.

## 8. File format (R34)

```yaml
kind: flat-peyote
title: Sunset band
bead: miyuki delica DB    # one size for the whole piece: "<brand> <line> <size>", or e.g. "generic cylinder 11/0"
beads:
  A: miyuki DB-0010       # as in a circular pattern's `beads:` block
  B: miyuki DB-0201
  C: { color: coral, display: { rgb: "#f2795b" } }   # a color of my own, in the piece's bead size
canvas: trimmed           # or `unlimited`
first_column: high        # the leftmost column holds the top row's bead (`low`: it doesn't)
rows: |
  AAAAAAAA
  ABBCCBBA
  AB.CC.BA
  ABBCCBBA
  A-A-A-A-
```

- `bead` names a size in the catalog. `beads` entries are resolved with the existing `resolveBeads()`; a catalog entry has to belong to the `bead` size, and one that doesn't is reported with its key. A mapping with only `color` and `display` is a color of my own, in the piece's bead size.
- `rows` is a picture of the grid as the chart shows it: one line per **drawn row**, one character per column. Each column is drawn half a bead higher or lower, as `first_column` says.
- `.` is an empty cell. `-` is a cell outside the canvas, which happens only in the bottom line of a trimmed canvas, where every other column has one fewer bead.
- **Mapping.** Line i, character j is the cell `(j, 2i + ((j + p) mod 2))`, with p = 0 for `first_column: high` and 1 for `low`. On loading, the grid is placed at a column with the right parity, so the offset is kept.
- For `canvas: trimmed`, the bounds are exactly the area of `rows` without the `-` cells. For `unlimited`, `rows` is the painted area and `.` and `-` both mean empty.
- Trailing `.` in a line may be left off. Comments are allowed but not kept on save, as in the circular editor.

## 9. Output

### 9.1 Bead list (R19)

Each bead key with its swatch, name and product code, the count, and grams to buy (`count / beads_per_gram`, rounded up to 0.5 g, plus 10 % spare) when the catalog has `beads_per_gram`. Shown in a side panel, updated live, and included in the chart download.

### 9.2 Printable chart (R35)

`chart.ts` writes an SVG in mm: the title, the beads drawn to scale (5 mm tall, respecting the turned view), every 5th column number along the top, every 5th stitched row number down the side, empty spots dashed in red, the bead list with amounts, and the word chart (or why there is none yet). It reuses the bead corner shapes and outline colors from `src/diagram/svg.ts`.

Not done yet: splitting a large design onto A4 pages with a small overlap and page numbers. For now it is one sheet at least 180 mm wide, as wide as the piece needs, and printing a large piece scales it down.

### 9.3 Word chart (R36, R37)

Only on a trimmed canvas with no empty cells. With the rows numbered from the top (row 1 is h = h0):

- **Rows 1 and 2** are picked up together as one string: going left to right, each column's bead from row 1 or row 2, whichever it has.
- **Each later row** goes back the other way, and lists its beads (every other column) in pickup order.
- Runs of the same bead are joined: `Row 5 (←): 3A, 1B, 4A`.

**Even or odd count** (R37) is the number of columns. It is shown in the status bar once trimmed. In odd count both edge columns have the same offset, so every other row has a bead in both edge columns. Each of those rows (from row 3) starts in the edge column the thread comes out of, which is where the odd-count turn is needed. The word chart marks them and adds a note, such as *rows 3, 5, 7, … start at the right edge*.

The word chart shows in the side panel under **Row by row**, and downloads as a `.txt` with a header naming the piece and its beads.

### 9.4 PNG (R38)

The canvas drawn at a chosen scale to an offscreen canvas and downloaded. Later.

## 10. Testing

Unit tests in `test/flat-*.test.ts`:

- **grid**: parity rule, neighbors, trim gives exact bounds and keeps every cell where it was, resize drops only outside cells, block moves keep parity, fill stays inside the painted area on an unlimited canvas.
- **color**: sRGB → Lab against known values; CIEDE2000 against the Sharma test pairs.
- **import**: a solid picture gives one color; a two-color picture gives exactly those two beads; transparency gives empty cells; a color limit of N never uses more than N; a small red dot on a large blue field survives a limit of 2 (the greedy removal keeps it, the most-used approach wouldn't); height follows §6.3.
- **format**: every example file (`patterns/flat/*.flat-peyote.yaml`, kept out of `patterns/` so the circular pages don't list them) loads and saves back the same; odd and even widths; `first_column` high and low; a bad bead code or an unknown key in `rows` gives a clear error.
- **chart**: word chart for a small known pattern, even and odd count.

Manual check in the browser: the "Done when" list in the requirements.

## 11. Build order

1. Grid model, file format and tests (§1–3, §8).
2. Canvas drawing, pan and zoom, paint, erase, pick, undo, browser copy (§4, §5, §7).
3. Trim, empty-cell banner, bead list (§3, §9.1).
4. Import: sampling, matching, color limit, placing (§6, without dithering and adjustments).
5. Chart download, word chart, even/odd (§9).
6. The Should items: select tools, resize, make unlimited, turn the view, dithering, cleanup, crop and adjustments.

In parallel: add the common Delica colors to the catalog, without which import results look rough (see Dependencies in the requirements).

## Decisions

Settled in review (2026-10-18):

1. **Starting orientation: columns vertical.** Stitched rows run left to right and each column is offset half a bead, as most flat peyote charts are drawn. The view can still be turned (R10).
2. **Bead keys stay one character (62 at most).** `rows` keeps reading like a picture. The import's color limit is capped at 62 (§6.2), and Drop is blocked past 62 keys (§6.7).
3. **Trim always cuts tight.** No margin option. Room for an edging row is added afterwards by resizing (§3).
4. **Copy the palette and bead panel for now.** `web/flat.ts` gets its own copy of the parts it needs from `web/editor.ts`, which stays untouched. Pull the shared parts out once both pages are stable.
