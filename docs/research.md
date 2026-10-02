# Research: How Circular and 3D Peyote Patterns Are Written

Step 1 of [plan.md](plan.md). This file covers how beaders describe circular and 3D peyote patterns today, and what that means for our pattern format (step 2).

## 1. Peyote basics

- **Stitch:** pick up one bead, skip one bead in the previous row, and pass through the next bead. Beads end up offset by half a bead, like bricks. The beads from the previous row stick up ("up beads"), and new beads go into the gaps between them.
- **Even count / odd count:** the number of beads in a row can be even or odd. Odd count needs a special turn (flat) or a different way to finish each round (tubular).
- **Three forms:**
  - **Flat:** worked back and forth in rows.
  - **Tubular:** worked in rounds that keep the same bead count, so the result is a tube.
  - **Circular:** worked in rounds from a small center ring, adding beads so the piece grows outward.
- **Row vs round:** flat work has rows. Circular and tubular work has rounds. Since peyote is offset, each "level" of beadwork is two rows or rounds.

## 2. The step-up

Every round in tubular and circular peyote ends with a **step-up**: after adding the last bead, the needle passes through the first bead added in that round. This moves the thread up to the new round. The step-up makes a visible diagonal line through the piece, and patterns often show where it falls.

If a round ends with a pair of beads, or with 3 beads in one stitch, the step-up passes through the whole group as one unit.

## 3. How circular peyote grows

### Starting ring
Patterns start with a small ring of beads at the center. Common sizes:
- 3 beads (triangle-type starts)
- 4, 5 or 6 beads
- A larger even count (for example 14 or 32) when the piece is a ring or a bezel around a stone

### Increases
An **increase** puts **2 beads (sometimes 3) into one stitch** instead of 1. On the next round, the beads of a pair are usually **split**: each one gets its own stitch, with a new bead between them.

So a typical cycle at one increase point is:

| Round | What goes into the gap |
|---|---|
| n | 2 beads (a pair) |
| n+1 | 1 bead between the two beads of the pair (split) |
| n+2 | 1 bead per gap, or a new pair if more growth is needed |

### Decreases
A **decrease** skips a gap: the needle passes through two up beads without adding a bead between them. Diagrams often mark this with an "X".

### Example round sequences seen in tutorials
These are paraphrased from tutorials, not taken from any one published pattern:

- **3-bead start (flat circle):** ring of 3, then 6 beads (2 per gap), then 1 per gap, then 2 per gap, and so on. The rule given was to add 2 instead of 1 when the gaps get too wide, and to spread the increases evenly around the round.
- **14-bead start:** 7 beads (1 per gap), then 14 (2 per gap), then 7 (1 per gap, into the pairs), then 7 groups of 3, then pairs again. Depending on the round count, the result is round or a 7-pointed star.
- **Bezel (cup):** 32-bead ring, then rounds of 1 per gap with **no increases**, and a round of smaller (size 15) beads pulled tight. This makes the work curl up into a cup around the stone.

## 4. How bead counts set the 3D shape

Tutorials say this informally. The rule of thumb:

| Increase rate compared to "flat" | Resulting shape |
|---|---|
| None (same count every round) | Tube or cylinder (tubular peyote) |
| Fewer increases than flat | Cup, bowl or cone |
| Increases spread evenly, at the right rate | Flat disk |
| More increases than flat | Ruffles or waves |
| Smaller beads, or thread pulled tight | Curls inward (bezels) |

Tutorials also warn: too many increases make the piece buckle and ruffle, and too few stop it from lying flat. One tip was to "always go with fewer beads", since they fall into place better.

**Our inference (to check in step 4):** this works like the circumference of a circle. For every full bead the radius grows, a flat circle needs about 2π ≈ 6 more beads around. In peyote each round sits only about half a bead further out, so that is roughly **+3 beads per round, or +6 per two rounds**. The flat triangle in [references/03-flat-triangle.md](references/03-flat-triangle.md) adds exactly +3 per round, which fits. Bead shape (Delica vs round seed bead), thread tension, and the half-bead offset will move this number. We need to measure it, not assume it.

## 5. Geometric peyote: placing the increases

Where the increases go changes the shape as much as how many there are.

- **Increases spread evenly and moving from round to round:** a round disk.
- **Increases always in the same spots (corners):** a polygon. Jean Power describes this as "regulating" where the increases go, so the work stops being round and forms corners.
  - 3 corners: triangle
  - 4 corners: square
  - 6 corners: hexagon
- **Corner treatment:** corners take **2 beads per round** (like herringbone stitch: the pair is never split and a new pair goes on top). The sides use plain 1-bead peyote. Each side gets 1 bead longer every round.
- **Stop increasing:** the work stops getting wider and turns upward into a wall. This is how vessels and boxes are made.
- **3D geometric forms** such as the warped square, the 3D star, Cellini spirals and beaded balls come from changing the number of corners, the bead sizes, or the increase rate, and from joining shaped pieces. Software such as Peyote Creator generates triangle, warped square and 3D star patterns.

### Triangle example (paraphrased)
- Round 1: 3-bead ring
- Round 2: 2 beads in each gap (3 corner pairs)
- Round 3 and later: 2 beads at each corner, 1 bead in each gap along the sides, then step up through the first pair

## 6. How patterns are presented

Patterns use three formats, often together:

1. **Round-by-round diagrams** (the main format for circular and 3D work). Each round is drawn as a separate picture: beads are rounded rectangles, the new round is highlighted, and a thread path shows where the needle goes. Photos are added at difficult steps.
2. **Word charts** (common for flat and tubular peyote). Each row is a list of bead counts and colors, for example "3 A, 1 B, 3 C" or Delica codes such as "3 DB010, 1 DB200". Rows 1 and 2 are strung together in one pass at the start.
3. **Graph charts:** a grid with offset columns (peyote graph paper) where each cell is a colored bead. These work well for flat and tubular color patterns, but not for circular work, since the bead count changes every round.

Patterns also usually list:
- Bead types and sizes, such as 11/0 seed beads, 15/0 seed beads, Delicas (cylinder beads) and 8/0 beads, each with a color code or letter (A, B, C...)
- How many beads of each color are needed
- Where the step-up falls, and the thread path

## 7. What this means for our format (input for step 2)

A pattern for our system needs to encode:

- **Bead types:** a letter or key mapped to size, shape (round or cylinder) and color.
- **Starting ring:** bead count, and the colors of those beads.
- **Rounds, each a list of gap instructions:** for each gap, how many beads go in (0 for a decrease, 1, 2 for an increase, or 3) and their colors.
- **Short forms for repeats**, such as "(2A, 1B) × 6", like word charts and the "pair, single, repeat around" wording in written patterns.
- **The step-up:** this can usually be inferred (always the first bead or group of the round), but it should be possible to store it for diagrams.
- **Optional tension or bead-size hints**, since tutorials use smaller beads or tight thread to force curving.

The pattern only needs to record **counts per gap per round**. The 2D diagram (step 3) and the 3D shape (step 4) can both be computed from that.

## Open questions

- In circular patterns, does a pair always split on the next round, or is it sometimes kept as a pair (corners)? We should support both and tag the gap type.
- Do 3D designs (stars, balls) mostly come from one continuous piece, or from joined pieces (two halves zipped together)? The format may later need a "join" step.
- We need real patterns to test against. Next we should pick 2 or 3 freely available patterns (a flat circle, a bezel cup, a triangle) and write each one in our draft format.

## Sources

- [How to Read Circular Peyote Stitch Patterns: A Sleepy Creative](https://asleepycreative.com/how-to-read-circular-peyote-stitch-patterns/)
- [Circular Peyote Stitch (Peyote in the Round): Jill Wiseman Designs](https://learn.jillwisemandesigns.com/2026/07/31/circular-peyote-stitch-peyote-in-the-round/)
- [Circular Flat Peyote Stitch Instruction: BeadJewelryMaking](https://www.beadjewelrymaking.com/Arts_and_Craft_Idea/circular_flat_peyote_stitch_instruction.html)
- [Peyote Stitch Master Class: Circular Peyote: Inspirational Beading](http://inspirationalbeading.blogspot.com/2016/04/peyote-stitch-master-class-circular.html)
- [Triangle Shape with Peyote Stitch: Clearly Helena](https://www.clearlyhelena.com/2014/10/triangle-shape-with-peyote-stitch-how-to.html)
- [Peyote Powers: Beadmobile](https://beadmobile.wordpress.com/2011/05/15/peyote-powers/)
- [How to Do Circular Flat Peyote Stitch the Right Way: Interweave](https://www.interweave.com/article/beading/how-to-do-circular-flat-peyote-stitch/) (could not be fetched, HTTP 403)
- [Creative Shapes with Peyote Stitch: The Alluring Bead Boutique](https://www.thealluringbeadboutique.com/creative-peyote-shapes/) (could not be fetched, HTTP 500)
- [Peyote Pattern Maker (word chart format): makebead.com](https://makebead.com/peyote-pattern-maker)
- [Peyote Creator: 3D star, warped square and triangle software](https://bead-n-stitch.com/peyotecreator/)
- [Peyote stitch: Wikipedia](https://en.wikipedia.org/wiki/Peyote_stitch)
