# Reference 3: Flat Triangle

- **Shape:** flat equilateral triangle
- **Why it's useful:** the same total increase as a flat circle, but always placed at 3 fixed **corners**. Tests whether the format can describe *where* increases go, not only how many.
- **Status:** unverified

## Source A: basic triangle

- **Source:** [Triangle Shape with Peyote Stitch, How To, Clearly Helena (2014)](https://www.clearlyhelena.com/2014/10/triangle-shape-with-peyote-stitch-how-to.html)

| Round | Corners (×3) | Side gaps | Notes |
|---|---|---|---|
| 1 | – | – | 3-bead ring, stitched through twice |
| 2 | 2 beads | – | A pair between each ring bead: 6 beads |
| 3 | 2 beads | 1 bead | Pairs at the corners, single peyote along the sides |
| 4+ | 2 beads | 1 per gap | Repeat. Each side gets one more gap per round |

- **Corner treatment:** herringbone-style. The pair at each corner is **not split**; a new pair goes on top of it every round.
- **Step-up:** pass through the first pair of the round as one unit.

## Source B: triangle earrings with color changes

- **Source:** [How To Make Peyote Triangle Earrings, The Artisan Duck (2021)](https://theartisanduck.com/2021/02/26/how-to-make-peyote-triangle-earrings/)
- **Beads:** size 11 seed beads
- **Structure:** same as Source A (3-bead start, pairs at corners, singles along the sides), with a color change every few rounds.
- **Corner change near the end:** the last rounds use **1 bead at each corner** instead of a pair, which makes the points sharper.
- **Finishing:** a small loop of beads at one corner for the earring hook.

## Expected bead counts (our calculation, not from the sources)

If each corner gets a pair and each side gains one gap per round, the beads added per round after round 2 are:

- Round r: 3 × 2 (corners) + 3 × (r − 2) (sides) = 3r
- So round 3 adds 9, round 4 adds 12, round 5 adds 15, and so on: **+3 beads per round**.

This fits the flat-circle rule of thumb once the peyote offset is counted: each round sits only about half a bead further out, so +3 beads per round is about +6 per full bead of radius (see [research.md](../research.md)). We should still check it against the source diagrams.

## Useful for the model

- The format needs a gap type: `corner` (pair, kept as a pair) vs `side` (single peyote).
- The color in Source B follows the triangle's geometry (corners vs sides) rather than one list per round. The format should be able to say "corners in color A, sides in color B".
