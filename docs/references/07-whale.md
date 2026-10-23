# Reference 7: Beaded Whale

- **Shape:** closed ball with a flatter bottom, about 16–20 mm, worked around a core bead, plus two small fins, a tail and two eyes sewn on
- **Why it's useful:** a near copy of [reference 6](06-beaded-ball.md) with a **color change** at the decreases, and our first piece with **separate parts attached** to the body (not modelled yet).
- **Status:** unverified

## Source

- **Source:** [My First Beaded Animal: Cute & Easy Whale Tutorial, A Sleepy Creative](https://asleepycreative.com/beaded-animal-easy-whale-tutorial/)
- **Beads:** 11/0 round seed beads (the author used Toho) in two colors, purple and off white; two 3 mm black beads for the eyes; a 16–20 mm core bead (homemade from clay works)
- **Thread:** max 0.2 mm (the author used KO 330 dtex, and now FireLine Crystal 6 or 8 lb). Body 140 cm, each fin 30 cm, tail 40 cm
- **Stitch:** circular peyote. Every row ends by passing through the first bead added in that row.
- **Round numbers:** the source's rows match ours. Row 1 is the 4-bead ring.

## Body

Pattern file: [07-whale.peyote.yaml](../../patterns/07-whale.peyote.yaml). A = purple, B = off white.

| Rows | Beads per row | Source's stitches | Ours |
|---|---|---|---|
| 1 | 4 | Ring of 4, tied (or leave a tail) | `center (1A) x4` |
| 2 | 4 | 1-1-1-1 | `(1A) x4` |
| 3 | 8 | 2-2-2-2 | `(2A) x4` |
| 4–5 | 8 | One bead per gap | `(1A) x8` |
| 6 | 12 | 1-2 ×4, stacked on row 3's increases | `(1A, 2A) x4` |
| 7–8 | 12 | One bead per gap | `(1A) x12` |
| 9 | 16 | 2-1-1 ×4 | `(2A, 1A, 1A) x4` |
| 10–18 | 16 | One bead per gap, 9 rows. Add rows here for a bigger core | `(1A) x16` |
| 19 | 12 | Skip, 1-1-1, ×4. **First off-white row** | `(0, 1B, 1B, 1B) x4` |
| 20–21 | 12 | One bead per gap | `(1B) x12` |
| 22 | 8 | 4 skips | `(0, 1B, 1B) x4` |
| 23 | 8 | One bead per gap | `(1B) x8` |
| 24 | 4 | 4 skips | `(0, 1B) x4` |
| 25 | 4 | One bead per gap, leaving a small opening | `(1B) x4` |

Totals: 228 purple and 60 off white for the body (288 beads).

Compared with the ball (reference 6): one more 16-bead row (rows 10–18, not 10–17) and one fewer 8-bead row (only row 23). Both are 25 rows. The extra wide row and the short top give the whale its flatter bottom.

## Eyes

Two 3 mm black beads, one on each side, sewn into the small holes where the two colors meet (just below the purple, at the step of the color line). The thread goes through the surrounding body beads and through the eye, several times to secure it. Passing through the bead below the eye turns it down for a "sleepy" look; the bead above turns it up.

## Fins (×2)

Each fin is 6 purple beads on a 30 cm thread, worked at the middle of the thread so both ends are free.

| Row | Beads | Stitches | Ours |
|---|---|---|---|
| 1 | 3 | Pick up 3, through the first again: a triangle | `center (1A) x3` |
| 2 | 3 | One bead per gap: a bigger triangle | `(1A) x3` |

**Attaching:** beside each eye, on the purple just above the color line, find a diamond of 4 body beads. Pass the two thread ends separately and symmetrically through the beads either side of it (source photo), then weave each end through the surrounding beads in different directions and pull tight.

## Tail

9 purple beads on a 40 cm thread. The source text says 6, but its diagrams show 9 (3 + 4 + 2).

| Row | Beads | Stitches (from the diagram) |
|---|---|---|
| 1 | 3 | Pick up 3, through the first again: a triangle, centered on the thread |
| 2 | 4 | Turn the triangle so 2 beads are at the bottom. 2 beads on each upper side, none along the bottom |
| 3 | 2 | 1 bead at each outer tip, symmetrically |

The result is a V-shaped tail with the two thread ends coming out of the bottom point.

**Attaching:** at the back of the body (opposite the face), on a diamond of 4 beads, as for the fins. The author weaves through at least 10 beads and cuts the thread in the white part.

## To check

- **Color change.** The row-19 photo shows its 12 new beads off white and everything before purple, so the color line is a full round. In the finished photos the line looks stepped, which is just the peyote zigzag.
- **Decrease positions.** Row 19's photo shows the 4 skips evenly spaced, 3 beads apart. The source says it couldn't stack them on the increases (odd row) and that rows 22 and 24 aren't stacked either; where they start relative to our gap 1 is our guess.
- **Tail as a pattern.** It isn't a closed round: row 2 adds nothing along the bottom and row 3 only at the tips, with the thread exiting at the bottom. It might be `center (1A) x3`, `(2A, 2A, 0)`, then `(1A, 0, 0, 1A)`, but the gap order is a guess, so it isn't in a pattern file.
- **Core bead.** The pattern is marked `filled: true`. Without it the thread-tension model caved the whale in: a rippled, flattened bottom and a folded belly. With it the body settles about 19 mm across and 16 mm tall, within the source's 16–20 mm (see [the physics model](../physics-model-proposal.md#filled-pieces)).
- **Attached parts, eyes and the opening** at row 25 are not modelled. Our format has one piece per file and no way to join pieces yet.
- The author notes the fins and tail wiggle with this method; their paid version reinforces them.
