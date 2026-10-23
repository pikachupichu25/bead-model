# Reference 6: Beaded Ball

- **Shape:** closed ball, about 16 mm, worked around a core bead
- **Why it's useful:** grows from a small center, holds a straight band, then closes again. It is our first pattern with **decreases** (`0` stitches) that bring a piece back to a point.
- **Status:** unverified

## Source

- **Source:** [How to Make a 3D Beaded Ball for Beginners, A Sleepy Creative](https://asleepycreative.com/how-to-make-a-3d-beaded-ball-for-beginners/)
- **Beads:** 11/0 round seed beads (the author used Toho), around a 16–20 mm core bead
- **Stitch:** circular peyote. Every row ends by passing through the first bead added in that row.
- **Round numbers:** the source's rows match ours. Row 1 is the 4-bead ring.

| Rows | Beads per row | Source's stitches | Ours |
|---|---|---|---|
| 1 | 4 | Ring of 4, tied | `center (1A) x4` |
| 2 | 4 | 1-1-1-1 | `(1A) x4` |
| 3 | 8 | 2-2-2-2 | `(2A) x4` |
| 4–5 | 8 | One bead per gap | `(1A) x8` |
| 6 | 12 | 1-2-1-2-1-2-1-2 | `(1A, 2A) x4` |
| 7–8 | 12 | One bead per gap | `(1A) x12` |
| 9 | 16 | 2-1-1 ×4 | `(2A, 1A, 1A) x4` |
| 10–17 | 16 | One bead per gap. Add or remove rows here to fit the core | `(1A) x16` |
| 18 | 12 | Skip, 1-1-1, ×4 | `(0, 1A, 1A, 1A) x4` |
| 19–20 | 12 | One bead per gap | `(1A) x12` |
| 21 | 8 | Skip, 1-1, ×4 | `(0, 1A, 1A) x4` |
| 22–23 | 8 | One bead per gap | `(1A) x8` |
| 24 | 4 | Skip, 1, ×4 | `(0, 1A) x4` |
| 25 | 4 | One bead per gap, closing the top | `(1A) x4`, `close: true` |

A "skip" passes through two old beads without adding one, which is our `0` stitch.

## To check

- The source **stacks** its increases and decreases, each on top of the last. Where its row patterns start relative to our gap 1 is our guess; the bead counts don't depend on it.
- Row 18's text says "a total of 16 beads". That is the 16 gaps the row passes through: 12 beads are added.
- The source finishes with an optional extra bead or an eye pin through the top opening. Not modelled.
- **Closing (ours).** The source stops after row 25 and leaves a small opening at the top, "similar to the bottom". The bottom is a tied ring, but row 25's beads were joined only through row 24, so the model left the top looser than the bottom. `close: true` takes the thread through row 25's beads again and pulls them into a ring like row 1. With it, the two ends match in the 3D model: rows 1 and 25 are both 1.6 mm from the axis (before: 1.6 and 2.3), and rows 2 and 24 both 2.3 mm.
- **Still not quite symmetric.** Copies of the pattern a quarter-turn apart differ by up to about 1.2 mm, and the top half is about 0.5 mm taller than the bottom half. The step-ups pull each round in a little where they are, and they move round the ball as it grows. The bottom also settles as a flat disk while it is all there is. The real ball is held round by its core bead: the pattern is marked `filled: true`, so the thread-tension model pushes it out from inside from its widest round on (see [the physics model](../physics-model-proposal.md#filled-pieces)).
