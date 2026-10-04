# Pattern Format (Proposal)

Step 2 of [plan.md](plan.md). **Status: draft for review.**

This proposes how our system writes down a circular or 3D peyote pattern. The 2D bead diagrams (step 3) and the 3D shape (step 4) will both be computed from this.

## Goals

1. **Readable by beaders.** It should look like a written pattern ("2 A, 1 B, repeat 3 times"), not like code.
2. **Exact.** Every bead and every gap is accounted for, so a program can rebuild the piece bead by bead.
3. **Checkable.** Mistakes in a pattern, such as a round with the wrong number of stitches, should be caught automatically.
4. **Small.** Store only what the beader decides: bead types, the start, and what goes in each gap. Compute everything else.

## The core idea: one stitch per gap

In peyote, each round is worked into the **gaps** between the **up beads** of the round before it (the beads sticking out). A round is therefore a list of **stitches, one per gap**. A stitch says how many beads go into that gap:

| Stitch | Meaning |
|---|---|
| `1A` | 1 bead of type A (normal peyote) |
| `2A` | 2 beads of type A in one gap (increase) |
| `3A` | 3 beads in one gap |
| `1A+1B` | 2 beads, A then B, in pickup order |
| `0` | No bead: pass straight through to the next up bead (decrease, or treat a pair as one unit) |

### The counting rule

> **Every bead added in a round becomes an up bead for the next round. So the number of gaps in round r + 1 is the number of beads added in round r.**

This one rule explains all the increase behavior in [research.md](research.md):

- A **pair** (`2A`) gives 2 up beads, so 2 gaps on the next round: one *between* the two beads of the pair, and one after it.
- **Splitting a pair** means putting `1A` into the gap between the pair's beads.
- **Treating a pair as one unit** means putting `0` into that gap.
- A **herringbone corner** (the pair kept as a pair, as at triangle corners) means putting `2A` into that gap, so a new pair sits on top of the old one.

So "split", "keep as pair" and "decrease" don't need special keywords. They are all just what goes into a particular gap.

It also gives us a free consistency check: if a round lists more or fewer stitches than the previous round added beads, the pattern is wrong (or we have read it wrong).

### Gap order

- Up beads are numbered in the order they were added, starting from the first bead of the previous round (where the step-up goes).
- **Gap i** is the gap after up bead i, between up bead i and up bead i + 1, wrapping around at the end.
- A round's stitches are listed in gap order, starting at gap 1.

So the **step-up is implied**: every round starts by stepping up through the first bead (or first group) of the previous round. It does not need to be written.

## Starting the piece

There are two kinds of start:

| Start | Meaning | Rounds it counts as | Gaps for the next round |
|---|---|---|---|
| `center N` | Small closed ring of N beads lying side by side (e.g. 3 or 5), as at the center of a disk | Round 1 | N |
| `tube N` | Even-count ring of N beads that settles into two offset rounds, as in tubular peyote and bezels | Rounds 1 and 2 | N / 2 |

For `tube`, the strung beads alternate between round 1 (odd positions) and round 2 (even positions). The colors are written in stringing order, for example `tube 32: (1A, 1B) x16`, which makes round 1 all A and round 2 all B.

A `tube` start has two edges. Rounds work outward from round 2 (the **front** edge) by default. `edge: back` works from round 1 instead, which is how the back of a bezel is made.

> **Round numbers.** We always number rounds from the start: the center ring is round 1, or the tube ring is rounds 1 and 2. Published patterns use different conventions, so each reference file says how its numbers map to ours.

## Writing rounds

Each round is a list of stitches, separated by commas. To keep it short:

| Notation | Meaning |
|---|---|
| `(2A, 1B) x3` | Repeat the group 3 times |
| `1B*` | **Fill:** repeat this stitch as many times as needed to fill the remaining gaps in its group |
| `rounds 3-10:` | Use the same instruction for a range of rounds (needs `*` when the gap count changes) |

At most one `*` stitch is allowed per group, and the fill count must come out to a whole, non-negative number in every round of the range.

The `*` fill is what lets a growing shape such as the triangle be written as one rule instead of one line per round.

## Per-round options

| Option | Values | Purpose |
|---|---|---|
| `edge` | `front` (default), `back` | Which edge of a `tube` start to work from |
| `tension` | `normal` (default), `tight`, `loose` | Recorded for the 3D model. Tight thread pulls the work inward |
| `note` | free text | For people only. The program ignores it |

## Bead types

Each pattern defines a short key for each bead type:

```yaml
beads:
  A: { size: 11/0, shape: cylinder, color: "DB-010 black" }
  B: { size: 15/0, shape: round, color: "silver-lined crystal" }
```

- `size`: 15/0, 11/0, 8/0 and so on
- `shape`: `round` (seed bead) or `cylinder` (Delica, Aiko, Treasure)
- `color`: free text. A manufacturer code is best, if known

The physical size of each bead type (width, length along the hole) is kept in a separate bead catalog, not in each pattern. See [bead-catalog.md](bead-catalog.md), which proposes a shorter way to name a bead (`A: miyuki DB-0010`) and keeps these three fields as the fallback. Bead size changes the 3D shape (see the bezel), so it has to be measured, not guessed.

## File format

A pattern is a **YAML file** (`*.peyote.yaml`), and each round is written as a short text line in the notation above.

- YAML handles the metadata (title, source, bead types) with no custom parsing, and it's easy to read and edit by hand.
- The round lines stay close to how beaders already write word charts.

```yaml
title: <name>
source: <URL or "original">
status: unverified | verified
beads:
  A: { size: 11/0, shape: round, color: "..." }
start: center 3A          # or: tube 32: (1A, 1B) x16
rounds:
  2: (2A) x3
  3-10: (2A, 1B*) x3
  11: { stitches: "(1A) x30", tension: tight, note: "..." }
```

A round can be written as a short string, or as a mapping when it needs options.

## What is computed, not stored

- Up beads and gap counts for every round
- Total beads per round, and per bead type (the shopping list)
- Where the step-up falls in each round
- The 2D round-by-round diagram (step 3)
- Each bead's 3D position and orientation (step 4)

## Validation rules

The program rejects a pattern, or warns, when:

1. A round's stitch count doesn't equal the beads added in the round before (the counting rule).
2. A `*` fill can't come out to a whole, non-negative number.
3. A bead key is used but not defined in `beads`.
4. `tube N` has an odd N.
5. `edge: back` is used without a `tube` start.
6. A round has every stitch `0` (nothing is added). This is an error.
7. Warning: more than half of a round's stitches are `0`, or the bead count grows by much more than about 3 per round. Either may mean a cup or ruffle that wasn't intended.

## The three reference patterns in this format

Taken from [references/](references/README.md). The counts are still unverified there. The counting rule already explains the counts that looked wrong, which is a good sign for the design.

### 1. Flat circle (Inspirational Beading, 14-bead start)

```yaml
title: Flat circle, 7 increase points
source: http://inspirationalbeading.blogspot.com/2016/04/peyote-stitch-master-class-circular.html
status: unverified
beads:
  A: { size: 11/0, shape: cylinder, color: "any" }
start: tube 14: (1A) x14          # source's "foundation"
rounds:
  3: (1A) x7                      # source round 1: 7 beads
  4: (2A) x7                      # source round 2: 14 beads, a pair in each gap
  5: (0, 1A) x7                   # source round 3: 7 beads, each pair passed as one unit
  6: (3A) x7                      # source round 4: 21 beads
  7: (0, 0, 2A) x7                # source round 5: 14 beads. Our guess at where they go
```

The reference notes flagged source round 3 (7 beads after 7 pairs) as suspicious. Under the counting rule, round 5 has 14 gaps, and 7 beads fits exactly if each pair is passed through as one unit (`0` inside the pair). So the source is probably right, and the `0` stitch is how to record it. Round 7's placement is a guess and needs the source diagram.

### 2. Rivoli bezel cup (Around the Beading Table, 12 mm)

```yaml
title: Peyote bezel for 12 mm rivoli
source: https://www.aroundthebeadingtable.com/Tutorials/PeyoteBezel.html
status: unverified
beads:
  A: { size: 11/0, shape: cylinder, color: "color 1" }
  B: { size: 11/0, shape: cylinder, color: "color 2" }
  C: { size: 15/0, shape: round, color: "any" }
start: tube 32: (1A, 1B) x16      # rounds 1 (A) and 2 (B), a 2-color ridge
rounds:
  3: (1A) x16
  4: { stitches: "(1C) x16", tension: tight }
  5: { stitches: "(1C) x16", tension: tight, note: "insert the rivoli after this round" }
  6: { stitches: "(1C) x16", tension: tight, edge: back }
  7: { stitches: "(1C) x16", tension: tight, edge: back }
```

There are no increases at all. The cup comes only from the change to smaller beads and tight thread. That is why `size`, `shape` and `tension` belong in the format.

### 3. Flat triangle (Clearly Helena)

```yaml
title: Flat peyote triangle
source: https://www.clearlyhelena.com/2014/10/triangle-shape-with-peyote-stitch-how-to.html
status: unverified
beads:
  A: { size: 11/0, shape: round, color: "corners" }
  B: { size: 11/0, shape: round, color: "sides" }
start: center 3A
rounds:
  2: (2A) x3                      # 3 corner pairs
  3-10: (2A, 1B*) x3              # pair on top of each corner pair, singles along the sides
```

How the fill works out:

| Round | Gaps | Per side (3 groups) | Stitches | Beads added |
|---|---|---|---|---|
| 2 | 3 | – | `2A` ×3 | 6 |
| 3 | 6 | 2 | `2A, 1B` ×3 | 9 |
| 4 | 9 | 3 | `2A, 1B, 1B` ×3 | 12 |
| r | 3(r − 1) | r − 1 | `2A` + (r − 2) × `1B`, ×3 | 3r |

This gives +3 beads per round, as predicted in the reference notes. Because the step-up always lands on the first bead of a corner pair, gap 1 of each round is always inside a corner, so `2A` comes first in each group. The Artisan Duck's sharper points ("1 bead at each corner" near the end) would be `(1A, 1B*) x3`.

## Alternatives considered

- **List every bead individually (JSON).** Exact, but long and unreadable, and it can't express "repeat around". It may be useful later as the *compiled* output that steps 3 and 4 read.
- **Grid charts (peyote graph paper).** Good for flat and tubular color patterns, but they can't show the bead count changing each round, which is the whole point of circular work.
- **Keywords for increases** (`inc`, `split`, `keep-pair`). Easier to read at first, but the stitch count per gap already says all of this, and the keywords would be one more thing to keep consistent.

## Questions for review

1. **YAML + text rounds:** is this the right balance, or would you rather have a pure text format (like a word chart), or pure YAML/JSON?
2. **Round numbering:** we number from the start ring (center = round 1, tube = rounds 1 and 2). Should we also accept a pattern's own numbering with an offset?
3. **The `*` fill:** is it clear enough, or should growing patterns just list every round?
4. **Colors per bead vs per gap:** `1A+1B` covers a mixed pair. Is that enough for the color patterns you have in mind?
5. **Out of scope for now:** joining two pieces (beaded balls, zipped 3D stars), odd-count tubular, and changing bead sizes within one round. Agree to leave these for later?
