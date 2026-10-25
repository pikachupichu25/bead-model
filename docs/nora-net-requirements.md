# Nora Net Designer: Requirements

**Status: draft for review.** The bead structure these refer to is described in [nora-net-design.md](nora-net-design.md), and the design that meets them is in [nora-net-spec.md](nora-net-spec.md).

A design tool, next to the circular [editor](../README.md#usage) and the [flat peyote designer](flat-peyote-requirements.md), for **Nora beading**: the open bead net from southern Thailand made of rings of 4 and 8 beads. The designer starts from a blank net, colors beads and whole rings, and gets a pattern and a bead list to stitch from.

## Who it is for

A beader designing a Nora piece such as earrings, a collar or a panel. They think in rings and colors, usually design symmetric pieces, and want to know how many beads of each color to buy.

## Words used here

| Word | Meaning |
|---|---|
| **Net** | The lattice of rings that makes up a Nora piece |
| **Group of 4** | A small ring of 4 beads around a small hole |
| **Group of 8** | A larger ring of 8 beads around a larger hole |
| **Slot** | One bead position in the net. Every slot belongs to two groups |
| **Shared bead** | The bead in a slot; it counts toward both of its groups |
| **Complete group** | A group with all its slots filled, so it closes into a ring |
| **Mirror axis** | The line the symmetry tool mirrors across |

## Requirements

IDs are referenced from the spec. **Must** is needed for the first version, **Should** is wanted for it, **Could** can come later.

### Canvas

| ID | Priority | Requirement |
|---|---|---|
| N1 | Must | A new design opens on a **blank net**: every slot drawn as a faint outline, so the groups of 4 and 8 are visible before any bead is placed. |
| N2 | Must | The net is the octagon-and-square layout from the design doc: groups of 4 and 8 alternate like a checkerboard, every slot is shared by two groups, and there is one bead per slot. No other layout or group size is offered. |
| N3 | Must | Beads are drawn where they sit in the real net, at the size of the chosen bead, with each bead turned along its edge (horizontal, vertical or 45°). |
| N4 | Must | The canvas has no edges: the designer can pan in any direction and paint anywhere. |
| N5 | Must | Pan (drag with the hand tool, space + drag, or two fingers) and zoom (wheel, pinch, buttons, "fit to beads") work smoothly up to at least 200 × 200 groups. |
| N6 | Must | The tool always shows the size of the piece: width × height in groups and in cm, and the number of beads. |
| N7 | Should | Hovering a slot highlights the two groups it belongs to. |

### Painting

| ID | Priority | Requirement |
|---|---|---|
| N8 | Must | Paint one bead by clicking a slot, or many by dragging. This is the default way to paint. |
| N9 | — | *Dropped:* painting a whole group at once. Designs are painted bead by bead only (N8). |
| N10 | Must | Erase beads (eraser tool, or right-click). An erased slot means no bead there. |
| N11 | Must | Pick a bead's color from the canvas (eyedropper, or alt-click). |
| N12 | Should | Fill: recolor every connected bead of the same color in one click. |
| N13 | Should | Select an area to move, copy, paste or delete. A pasted block snaps so groups of 8 land on groups of 8. |
| N14 | Must | Undo and redo every change. A mirrored stroke is one step. |

### Symmetry

| ID | Priority | Requirement |
|---|---|---|
| N15 | Must | A **symmetry** control with four modes: off, left–right, up–down, and both. Left–right is on for a new design. |
| N16 | Must | With symmetry on, every painting and erasing tool also acts on the mirror image (two places for one axis, four for both). |
| N17 | Must | A mirror axis always runs through the middle of a column or row of groups, so groups of 8 mirror onto groups of 8 and groups of 4 onto groups of 4. Diagonal beads mirror to the other diagonal direction. |
| N18 | Must | The axis is drawn on the canvas and can be dragged to another column or row of groups. |
| N19 | Should | **Make symmetric**: copy one half of the design onto the other (left onto right, right onto left, top onto bottom, bottom onto top), as one undo step. |
| N20 | Should | **Check symmetry**: highlight beads whose mirror partner has a different color or is empty. |

### Stitchability

| ID | Priority | Requirement |
|---|---|---|
| N21 | Must | Groups that are partly filled are flagged ("3 rings are not closed"), with **Show**, and per group **Complete** (fill the missing slots with a chosen bead) and **Clear** (remove its beads that no complete group needs). |
| N22 | Should | Parts of the design that share no bead with the rest are flagged ("2 loose parts"), since they would fall off. |
| N23 | Must | These checks warn but never block painting or saving. |

### Beads and palette

| ID | Priority | Requirement |
|---|---|---|
| N24 | Must | One design uses **one bead size** (for example round 8/0), picked when the design is created and changeable later. |
| N25 | Must | The palette offers the catalog colors that exist for that bead, plus generic colors the designer makes (name and color), and can be limited to [My beads](my-beads-storage.md). |
| N26 | Must | Bead list, **to buy**: every color used with its count, each bead counted once even though it belongs to two groups, and the amount to buy in grams where the catalog knows beads per gram. |
| N27 | Should | Bead list, **by group**: each complete group with the colors of its 4 or 8 beads in ring order. |
| N28 | Should | Replace one color with another everywhere in the design. |

### Files and output

| ID | Priority | Requirement |
|---|---|---|
| N29 | Must | The design is kept in the browser between visits. |
| N30 | Must | Save and open a design as a readable text file (`.nora.yaml`) that keeps the bead size, the colors, every filled slot, and the symmetry mode and axis. |
| N31 | Must | Download a printable chart (SVG) with the net, the beads drawn in color, group outlines, and the bead list. |
| N32 | Could | Export a PNG image of the design. |
| N33 | Could | A ring-by-ring stitching guide: the order to stitch the groups in, and for each group which beads are new and which are already in place. |

## Out of scope for now

- **Fringe and single strands** (straight lines of beads hanging from or running through the net).
- Ear wires, loops and other findings.
- Importing a picture. The net is too coarse for photos.
- Mixed bead sizes in one piece.
- A 3D view.

## Dependencies and risks

- **Geometry is new.** The flat designer's grid code is for peyote and doesn't fit the net. The net needs its own coordinates, drawing and hit testing (which slot or group is under the pointer). Shared slots make "click a group" and "click a bead" easy to confuse, so the tools must make clear which one is active.
- **Round bead colors.** Nora work is mostly round seed beads (8/0 or 6/0). The catalog's round bead colors need checking before the palette is useful.
- **Drawing speed.** 200 × 200 groups is about 120 000 slots. Drawing should reuse the flat designer's canvas approach, not SVG elements.

## Done when

1. A new design opens on a blank net with groups of 4 and 8 visible.
2. With left–right symmetry on, painting the flower from the reference earrings (a group of 8 in green, four groups of 4 in red around it) to the left of the axis also paints its mirror image to the right, and undo removes it in one step.
3. A design with a half-filled group shows the "not closed" warning, and **Complete** fixes it.
4. The bead list counts each shared bead once.
5. The design survives a reload, saves to a file, opens again unchanged, and downloads as a printable chart.
