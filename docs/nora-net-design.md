# Nora Net Designer: Design

**Status: draft for review.** Describes the bead structure the designer works on. The requirements are in [nora-net-requirements.md](nora-net-requirements.md).

A design tool, next to the [flat peyote designer](flat-peyote-spec.md), for **Nora beading** (เครื่องลูกปัดโนรา): the open bead netting from southern Thailand used on the costumes of Nora dancers, and today also on earrings, collars and wall pieces. Instead of the close-packed rows of peyote, the beads form a net of small rings with holes in the middle. Patterns come from coloring whole rings, so a design reads as flowers, diamonds and lines of color on an open lattice.

## What the beads do

Looking at the reference earrings (white top, red-and-green flower, blue side panels):

- **Group of 4.** Four beads in a small diamond, one above, one below, one left and one right of a small hole. The red "petals" around the flower and the white and blue diamonds are all groups of 4.
- **Group of 8.** Eight beads in a larger ring around a larger hole, about twice the size of a group of 4. The green ring in the middle of the flower is a group of 8.
- **Groups share beads.** Every bead in the net belongs to exactly two groups. The bottom bead of the top red petal is also the top bead of the green ring, so the petal shows three red beads and borrows one green one. This sharing is what holds the net together.
- **How they fit.** Each group of 8 touches four groups of 4 (above, below, left, right) and four other groups of 8 (on the diagonals). Each group of 4 touches four groups of 8. In the flower, the green ring has red petals on its four sides; the black beads on its diagonals belong to the neighboring rings.
- **Parts of the net are left out.** Not every position has a bead. Open areas, the outline of the piece, and single strands running down (the blue legs) come from leaving positions empty or adding strands outside the net.

There are no special Thai names for the two groups or the net, so the tool just says **group of 4**, **group of 8** and **net**.

## The lattice

The net is the **octagon-and-square tiling** (4.8.8), with one bead on each edge. This is the only layout Nora work uses, and every group is a full 4 or a full 8 with one bead per edge, so the canvas has no other layouts, angles or group sizes.

- Each **square** is a group of 4: its 4 edges hold 4 beads.
- Each **octagon** is a group of 8: its 8 edges hold 8 beads.
- An edge is shared by two shapes, so its bead is shared by two groups.

The squares sit upright (sides horizontal and vertical), so their beads look like a diamond ◇, as in the photo. The octagons sit on the diagonals of the squares.

### Groups

Groups sit on a square grid, addressed by **(i, j)**: i is the column, j is the row, any integers.

- **(i + j) even** → group of 8 (octagon).
- **(i + j) odd** → group of 4 (square).

So the groups alternate like a checkerboard. Left, right, up and down neighbors are always a 4 and an 8. Diagonal neighbors of an 8 are 8s.

### Bead positions

Each bead position is addressed on a grid twice as fine, **(x, y)**, where the group (i, j) is at (2i, 2j). A position has a bead slot when **x and y are not both even** (both even is the middle of a group, which is a hole):

| x, y | Slot | Shared by |
|---|---|---|
| x odd, y even | Side bead, between left and right neighbors | (i, j) and (i+1, j), one 4 and one 8 |
| x even, y odd | Side bead, between up and down neighbors | (i, j) and (i, j+1), one 4 and one 8 |
| x odd, y odd | Diagonal bead, between two 8s | the two 8s among the four groups around it |

A small patch (O = group of 8, S = group of 4, o = side bead, / and \ = diagonal bead and the way its hole runs):

```
O  o  S  o  O  o  S  o  O
o  /  o  \  o  /  o  \  o
S  o  O  o  S  o  O  o  S
o  \  o  /  o  \  o  /  o
O  o  S  o  O  o  S  o  O
```

Read the square S in the top row: its four beads are the o's left, right and below it (and one above, off the patch). Read the O in the middle row: four o's on its sides, and four diagonal beads at its corners.

### Where the beads are drawn

The coarse grid above is for addressing. On screen, beads are drawn where they sit in the real net, the edge midpoints of a 4.8.8 tiling whose octagons are not regular, stretched up and down by √2 because the net hangs, so a piece is a diamond as in the reference earrings:

- **L** = distance between neighboring groups across (center to center), **H** = √2 · L up and down.
- **Side bead**: on the line from the 8 to the 4, on the 4's edge, one bead diameter d from the center of the 8.
- **Diagonal bead**: exactly halfway between the two 8s.
- **Edge length** e = √2 · d for a bead of diameter d, so before the stretch the beads of a group of 4 just touch. **L = (1 + 1/√2) · d** ≈ 1.71 d, so an 8's corner beads sit 0.85 as far out as its side beads and three beads nearly touch along its top and bottom.
- **Bead direction**: the hole runs along its edge. Side beads above and below a 4 lie horizontally, those left and right of it lie vertically, and diagonal beads lie at about 55°, along the stretched edge.

## The canvas

- **Blank canvas.** A new design shows the empty lattice: every bead slot drawn as a faint outline, so the designer sees the 4s and 8s before placing anything. Like the flat designer, it has no edges until trimmed.
- **Painting a bead** fills one slot with a bead color. This is the main tool: a design is painted bead by bead.
- **Erasing** leaves a slot empty, which means no bead there.
- **Bead size.** One bead size for the whole piece, from the catalog, as in the flat designer. Nora work is usually round seed beads (8/0 or 6/0); the reference earrings look like 8/0 or 6/0 opaque.

### Rules a stitched net must follow

A painted design is only stitchable if the net holds together. The tool checks and flags, but does not block painting:

- **Incomplete group.** A group with some but not all of its beads painted has no closed ring, so it falls apart. Flagged, with "complete" and "clear" actions.
- **Floating part.** Groups that do not share a bead with the rest of the piece. Flagged.

A painted bead with both of its groups incomplete can't be stitched at all. A complete group always can.

## Symmetry tool

Nora pieces are almost always symmetric, so painting can be mirrored as you go. A **Symmetry** control has four modes:

| Mode | What one stroke paints |
|---|---|
| Off | Only where you paint |
| Left–right | Also the mirror image across a vertical axis (the default for a new design) |
| Up–down | Also the mirror image across a horizontal axis |
| Both | All four mirror images |

- **The axis goes through a line of groups.** A vertical axis sits on a group column, at x = 2a in bead coordinates, and mirrors x → 4a − x. A horizontal axis sits on a group row the same way. Mirroring through a group keeps 8s on 8s and 4s on 4s; an axis between two group columns would swap them, so it isn't allowed.
- **Diagonal beads flip direction**: a / bead mirrors to a \ bead, which is what the real net does.
- **The axis is shown** as a line on the canvas and can be dragged to another group column or row. A new design puts it at column 0.
- **Every tool follows symmetry**: painting and erasing. One mirrored stroke is one undo step.
- **Make symmetric** copies one half of an existing design onto the other (left onto right, or right onto left), so a design drawn without symmetry can be fixed afterwards.
- **Check symmetry** highlights beads whose mirror partner has a different color or is empty.

## Bead list

Each bead is shared by two groups, so the bead list shows two things:

- **To buy**: each bead counted once, per color. This is the shopping list.
- **By group**: for each group, the colors of its 4 or 8 beads in ring order, so a beader can check a ring while stitching.

## Stitching

The net is stitched **ring by ring**, much like macrame: each new group closes onto beads already in place. Later versions can use this to print a ring-by-ring guide (which group next, which of its beads are new and which are shared). The first version shows the pattern and the bead list only.

## Out of scope for the first version

- **Fringe.** The straight lines of beads (the blue legs, the hanging fringe with black and white tips) are single strands, not part of the net. They can come later as a separate strand tool anchored to a bead of the net.
- **Ear wire, loops and findings.**
- **Picture import.** The lattice is too coarse for photos. Painting by hand comes first.
- **Ring-by-ring stitching guide** (see Stitching).
