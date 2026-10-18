# Flat Peyote Designer: Requirements

**Status: draft for review.** The design that meets these is in [flat-peyote-spec.md](flat-peyote-spec.md).

A second design tool, next to the circular [editor](../README.md#usage), for **flat peyote**: a rectangular (or any outline) piece where each column of beads sits half a bead higher or lower than its neighbors. The designer paints beads on a grid, starting from a canvas with no edges, and can bring in a picture and turn it into a bead pattern.

## Who it is for

A beader designing a flat piece such as a bracelet band, a bookmark, a panel or a picture. They think in beads and colors, not pixels, and they want to know how many beads of each color to buy.

## Words used here

| Word | Meaning |
|---|---|
| **Cell** | One bead position on the grid |
| **Column** | Beads stacked on top of each other. Neighboring columns are offset by half a bead |
| **Row** | One pass of stitching across the piece. It zigzags through the columns |
| **Unlimited canvas** | The grid has no edges. Beads can be painted anywhere |
| **Trim** | Cut the canvas down to the beads that are painted, so it gets edges |
| **Palette** | The bead colors available for painting and for image import |

## Requirements

IDs are referenced from the spec. **Must** is needed for the first version, **Should** is wanted for it, **Could** can come later.

### Canvas

| ID | Priority | Requirement |
|---|---|---|
| R1 | Must | A new design opens on an **unlimited canvas**: empty, with no edges, that the designer can pan in any direction and paint anywhere. |
| R2 | Must | Beads are drawn in the flat peyote layout: every other column is offset by half a bead, and beads are drawn to the shape and size of the chosen bead (e.g. a Delica is drawn taller than it is wide). |
| R3 | Must | Pan (drag with the hand tool, space + drag, or two fingers) and zoom (wheel, pinch, buttons, "fit to beads") work smoothly up to at least 500 × 500 beads. |
| R4 | Must | While the canvas is unlimited, the tool always shows the current size of the piece (width × height in beads and in cm), and outlines the area the painted beads cover. |
| R5 | Must | **Trim**: one action deletes the blank canvas around the painted beads. The canvas then has edges at the outermost painted beads, and cells outside it can't be painted. |
| R6 | Must | After trimming, empty cells inside the edges are flagged ("12 empty spots: a flat piece needs a bead in each"), with one action to fill them all with a chosen bead. |
| R7 | Should | A trimmed canvas can be resized: drag an edge, or type a width and height. Making it smaller asks before deleting beads. |
| R8 | Should | A trimmed canvas can be made unlimited again, keeping all its beads. |
| R9 | Must | Trimming and resizing never move a bead relative to the others, and never change which columns sit high and which sit low. |
| R10 | Should | The view can be turned 90° (columns vertical or rows vertical), since charts are printed both ways. It changes only the view and the downloads, not the design. |

### Painting

| ID | Priority | Requirement |
|---|---|---|
| R11 | Must | Paint one bead by clicking, or many by dragging. |
| R12 | Must | Erase beads (eraser tool, or right-click). |
| R13 | Must | Pick a bead's color from the canvas (eyedropper, or alt-click). |
| R14 | Should | Fill a connected area of the same color (bucket). On an unlimited canvas, a fill on empty space stays inside the painted area, so it can't fill forever. |
| R15 | Should | Select a rectangle to move, copy, paste, delete, or mirror it. |
| R16 | Must | Undo and redo every change, including trim and import. |

### Beads and palette

| ID | Priority | Requirement |
|---|---|---|
| R17 | Must | One design uses **one bead size and shape** (for example Delica 11/0), picked when the design is created and changeable later. Mixed sizes don't lie flat, so they are not allowed. |
| R18 | Must | The palette offers the catalog colors that exist for that bead, plus generic colors the designer makes (name and color). |
| R19 | Must | A bead list shows every color used, with its count and the amount to buy (grams, from the catalog's beads per gram where known). |
| R20 | Should | Replace one color with another everywhere in the design. |

### Import from an image

| ID | Priority | Requirement |
|---|---|---|
| R21 | Must | Import a picture (PNG, JPEG, WebP, GIF first frame) from a file, by drag and drop, or by paste. |
| R22 | Must | The designer sets the size of the result in beads (width, with height following the picture's shape, or both). The height accounts for the bead's shape, so the stitched piece has the picture's proportions, not the pixel grid's. |
| R23 | Must | Each bead takes the **closest available bead color** to the part of the picture it covers, measured the way people see color difference, not by raw RGB distance. |
| R24 | Must | The designer chooses which colors the import may use: the whole palette, colors from one brand or line, or only the colors already in the design. |
| R25 | Must | The designer can limit the number of colors (for example "at most 8"). The tool then picks the best set of that many colors for the picture, not just the most common ones. |
| R26 | Must | A live preview shows the picture and the bead result side by side, with the colors used and their counts, and updates as the settings change. |
| R27 | Must | Transparent parts of the picture become empty cells, so a cut-out shape stays a cut-out shape on the canvas. |
| R28 | Should | Optional dithering (mixing two bead colors to suggest a color in between), off by default. |
| R29 | Should | Clean up stray single beads: colors used by fewer than N beads are merged into their closest neighbor color. |
| R30 | Should | Crop the picture, and adjust brightness, contrast and saturation, before converting. |
| R31 | Must | The result is placed on the canvas as a block the designer can move before dropping it. Dropping it is one undo step. Empty (transparent) cells in the block don't erase beads under it. |
| R32 | Must | An import of up to 300 × 300 beads previews in under a second on a typical laptop. |

### Files and output

| ID | Priority | Requirement |
|---|---|---|
| R33 | Must | The design is kept in the browser between visits, like the circular editor's draft. |
| R34 | Must | Save and open a design as a readable text file (`.flat-peyote.yaml`) that keeps the bead list, the grid, whether the canvas is unlimited or trimmed, and which columns sit high. |
| R35 | Must | Download a printable chart (SVG) with the beads, a numbered grid, and the bead list with counts. |
| R36 | Should | Download a row-by-row word chart ("Row 3: 2A, 1B, 4A…"), the way flat peyote patterns are usually written. Only possible on a trimmed canvas with no empty cells. |
| R37 | Should | Show whether the piece is even-count or odd-count peyote (from the number of columns), since odd-count needs a different turn at one edge. |
| R38 | Could | Export a PNG image of the design. |

## Out of scope for now

- Two-drop and three-drop peyote, and shaped edges made with increases and decreases. The canvas allows any outline, but the word chart only covers the plain case.
- Mixed bead sizes in one piece.
- Matching bead finishes (metallic, pearl, transparent) when importing a picture. Only the display color is used.
- Joining a flat piece into a tube (zipping). That belongs to the circular/3D side.
- A 3D view of the flat piece.

## Dependencies and risks

- **Few catalog colors.** The catalog has about 20 colors today, so imported pictures will look rough until more are added. Importing well needs at least the common Delica colors (a few hundred). Adding them is a separate task.
- **Display colors are approximate.** Catalog colors are picked by eye ([bead-catalog.md](bead-catalog.md)), so "closest color" is only as good as those values.
- **Size.** An unlimited canvas and a 300 × 300 import mean up to ~100 000 beads on screen. Drawing them as SVG elements, as the circular editor does, will be too slow; the canvas needs a faster drawing method.

## Done when

1. A new design opens unlimited; the designer paints in several places far apart, trims, and the canvas shrinks to exactly the painted area with empty spots flagged.
2. A photo imported at 60 beads wide with "at most 10 colors" gives a recognizable pattern using 10 or fewer catalog colors, with a bead list.
3. A logo with a transparent background imports as a cut-out shape with no beads in the transparent area.
4. The design survives a reload, saves to a file, opens again unchanged, and downloads as a printable chart.
