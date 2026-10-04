# Reference 4: Christmas Mug Trinket Box (top, first rounds)

- **Shape:** round peyote disk (the lid/top of a 3D trinket box). Only the first 3 rounds are covered here.
- **Why it's useful:** a commercial pattern with its own compact chart notation, and an **uneven** start: one gap gets a pair and the others get singles, so the increase is not symmetric.
- **Status:** unverified
- **Source:** *Christmas Mug Trinket Box*, Lynsey James, [Thread A Bead](https://www.threadabead.com) (2025). Paid pattern, page 4 of 39. A screenshot of that page is kept locally and not committed, since the pattern is licensed.

These are our own notes on the structure. The instructions and diagrams belong to the designer; see the purchased pattern for the full text.

## How Thread A Bead charts a row

Each row is a small table. The top line is the **bead group** to pick up, the bottom line is **how many times** to pick it up. Groups are worked left to right, one group per pick-up, going anti-clockwise around the work.

| Row | Groups (top) | Times (bottom) | Meaning |
|---|---|---|---|
| 1 | `A` | 3 | "Make a loop": string 3 A and close them into a ring |
| 2 | `AA` · `A` | 1 · 2 | Pick up AA once, then A twice |
| 3 | `AA` · `A` | 1 · 3 | Pick up AA once, then A three times |

- `AA` = two beads picked up together and put in one gap (a pair).
- The thread is about 30 cm (one arm length) to start, adding 2 more arm lengths as needed.

## Rules stated in the source (paraphrased)

- **Step-up:** at the end of every round, pass through the first bead of the round just made, ready for the next round.
- **Pairs become singles:** when a round starts with an `AA`, the step-up goes through only the **first A** of that pair. On the next round, each bead of a pair counts as its own up bead, regardless of how it was picked up.
- **Tension:** keep the first few rounds fairly tight so the small piece doesn't wiggle.
- The diagrams show the row 2 beads sitting between the row 1 beads, i.e. normal peyote offset.

## In our format

```yaml
title: Christmas Mug Trinket Box, top (rounds 1-3 only)
source: https://www.threadabead.com  # paid pattern, Lynsey James 2025
status: unverified
beads:
  A: { size: unknown, shape: unknown, color: "unknown" }
start: center 3A                     # source row 1, "make a loop"
rounds:
  2: 2A, 1A, 1A                      # source row 2: AA x1, A x2
  3: { stitches: "2A, 1A, 1A, 1A", tension: tight }  # source row 3: AA x1, A x3
```

Counting rule check:

| Round | Gaps | Stitches | Beads added |
|---|---|---|---|
| 1 | – | ring of 3 | 3 |
| 2 | 3 | `2A, 1A, 1A` | 4 |
| 3 | 4 | `2A, 1A, 1A, 1A` | 5 |

Both rounds match: the stitch count of each round equals the beads added in the round before. The round numbers match ours directly (the source's row 1 is the center ring).

## Open questions

1. **Which gap gets the pair?** We assume the chart is in pickup order, so the `AA` goes into gap 1 (right after the step-up). In round 3, gap 1 is the gap *inside* the round 2 pair, which would put the new pair right on top of the old one (a herringbone-like corner). Check against the round 3 diagram.
2. **Bead types:** the bead list is on an earlier page we don't have. Fill in size, shape and color.
3. **Growth:** +1 bead per round is slow for a flat disk. Later pages may add more pairs, or the slow growth may be intended (the top may dome). Need more pages to tell.
