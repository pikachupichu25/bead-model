# The 3D Shape Model

Step 4 of [plan.md](plan.md). **Status: second version, simplified after [a critique of the first](shape-model-critique.md). Bead sizes and tension are first guesses until we fit them to photos of real pieces.**

This explains the **profile model**, one of the two ways the program works out the 3D shape a pattern makes. The other, the thread-tension model, settles solid beads on a tensioned thread step by step: see [physics-model-proposal.md](physics-model-proposal.md). The 3D view's **Model** menu switches between them.

The profile model works out the 3D shape a pattern makes from its counts. It uses the compiled pattern (every bead and the gaps it sits in) and the bead sizes from the [catalog](bead-catalog.md). Code: `src/shape/profile.ts` (the maths) and `src/shape/shape.ts` (placing the beads).

The idea: a pattern fixes the fabric's measurements (how long each row is, and how far apart the rows are), not its shape. For a piece that is the same at every increase point, those measurements fix a profile: how far out and how far up each round sits. Everything follows from that, with no solver.

## 1. Row length and spacing

Going once round a worked round, the thread passes every new bead and every up bead once. So the **row** the round lies in is

> C = Σ length of the new beads + Σ length of the up beads, each plus the slack between beads

and each round sits half a bead diameter further across the fabric: Δs = (D of this round + D of the round it is worked into) / 4.

**Tension** changes the length a bead takes up (`TENSION` in `profile.ts`):

| Tension | Slack between beads | Bead length counts as |
|---|---|---|
| loose | 0.25 mm | 100% |
| normal | 0.08 mm | 100% |
| tight | 0 | 90% (beads tilt and nest) |

## 2. The profile

**Corners.** If every worked round has the same number k ≥ 3 of gaps with more than one bead, the increases stay in place and the piece keeps k corners (the triangle). Otherwise the increases move round and the piece stays round. A flat piece's perimeter is P × its inradius, where

> P(k) = 2k·tan(π/k): P(3) = 6√3 ≈ 10.4, P(4) = 8, P(6) ≈ 6.9, and P = 2π for a circle.

**Radius**, straight from the row: r = C / P (the inradius for a piece with corners).

**Growth** compares the radius with the round two below (the rows of peyote interlock in pairs of rounds, a round of pairs then a round that splits or skips them):

> g = Δr / distance across those two rounds

Growth is the cosine of the fabric's angle, and one set of cut-offs labels every round, on the chart and in 3D:

| Growth | Angle | Shape |
|---|---|---|
| below −0.15 | over 99° | Row is shorter than the one before: the edge **curls in** |
| −0.15 to 0.2 | 78° to 99° | Same length: a straight **wall** (tubular peyote) |
| 0.2 to 0.85 | 32° to 78° | Grows, but less than a flat piece: a **cup** or cone |
| 0.85 to 1.15 | under 32° | **Flat** |
| above 1.15 | | More row than fits flat: **ruffles** |

**Height**, by Pythagoras from the round below: Δz = ±Δs·√(1 − g²). Front rounds of a tube go up, back rounds go down. Growth below −1 is held at −1: the fabric has folded flat inward.

**Ruffles.** When g > 1 the ring only goes out by the distance (g held at 1), and the row is longer than the ring by E = C / (P·r) − 1. A wavy edge z = A·cos(mθ) adds about m²A²/4r² to the length, so the ruffles are

> A = (2r / m)·√E

high, with m waves, one per increase point. This is the small-wave approximation; for a row 24% too long it is about 2.5% short.

Bead size counts as much as bead count. The bezel has 16 beads in every round, but its 15/0 rounds have a shorter row than the 11/0 rounds under them, so growth goes to −1.6 and the edges curl in.

## 3. Placing the beads

Each bead goes on its round's ring at its angle θ in the 2D diagram:

- distance out: r, or for a piece with corners r / cos(angle from the middle of the nearest side)
- height: the round's height, plus A·cos(m(θ − θ₀)) if it ruffles, with the peaks at the increases

Corners and ruffle peaks line up with each round's first increase. Each bead's hole points from the bead before it on the thread to the bead after it. Round and cylinder beads are symmetric round the hole, so that is all the renderer needs.

The same pattern always gives the same shape, and a round's place doesn't depend on the rounds after it, so stepping through a pattern only adds beads.

## 4. Comparing with the reference pieces

We don't have photos of our own pieces yet. These are the shapes the sources describe, against what the model gives using generic bead sizes (all `estimate` in the catalog):

| Reference | Source says | Model gives | Agrees? |
|---|---|---|---|
| [2. Rivoli bezel](references/02-rivoli-bezel-cup.md) | Short tube; both edges curl inward to hold the stone | Round 3 a wall; rounds 4–7 curl in, front up and back down. Band 14 mm across, lips 11 mm | Yes |
| [1. Flat circle](references/01-flat-circle.md) | Flat disk | Rounds 4–6 flat (a 16° cone), on a center that stands up as a short wall; round 7 ruffles 0.9 mm | Partly |
| [3. Triangle](references/03-flat-triangle.md) | Flat triangle | Three corners and straight sides, flat (growth 0.88): a shallow cone, 4 mm high on a 30 mm piece | Mostly |
| [4. Trinket box top](references/04-christmas-mug-trinket-box.md) | Unknown (only 3 rounds; "the top may dome") | Flat, then a cup | Can't tell |

**Why the flat circle's center stands up.** Its 14-bead start is followed by a round of 7 (one per gap), which adds no row length at all, so the model stands it up as a wall. The source treats the foundation as lying flat. Real foundations are often loose, so the start ring probably stretches.

**Why the flat circle's round 7 ruffles.** Its rows are 14, 14, 14, 21, 21, 28, 35 beads long. Rounds 3–6 add 7 beads of row every two rounds, which is flat; round 7 adds 14. The source's round 5 has 14 beads, but where they go is our guess (`(2A, 0, 0) x7`), so this may be the guess, not the source.

**Why the triangle is a shallow cone.** With nominal 11/0 sizes (2.0 × 1.45 mm), the sides need about 10.4 mm more row per round to stay flat and get 9.2 mm. Growth 0.88 is in the flat band, but the shortfall adds up to a 4 mm rise over 10 rounds. Small triangles lie flat in photos, so either real beads are relatively longer than our nominal sizes, or the corner pairs splay to make up the difference. Measuring real beads will tell which.

## 5. What to calibrate next

Only two numbers per bead type and tension move the shapes:

1. **Effective length L** along the row (bead length × squeeze + slack). A ruler photo of a stitched tube gives it: row length ÷ beads in the row.
2. **Effective diameter D** across the rows. A photo of a flat strip gives it: width ÷ number of rounds × 2.

Then for each reference piece, a photo from the side and from above next to a ruler, with the pattern file it was stitched from. The model's radius and height per round can be compared directly.

## Limits

- The piece is assumed to be the same at every increase point. Patterns that are not symmetric, or that change bead size within a round, need a real solver: the beads as a triangle mesh (each new bead with its two up beads and the bead below), with stretching and bending energy, minimised until it settles. The first version of the model had a simpler solver; see the [critique](shape-model-critique.md) for why it was removed.
- Beads near the center of a center start sit closer than their size allows: the row-length model is for fabric, not for the first ring.
- No gravity, so a piece doesn't sag or rest on a table.
- A buckled piece could go either way (a curl in could become a curl out); the model takes the direction the pattern's front and back edges give.
- Joining pieces and odd-count tubes are still out of scope (see [pattern-format.md](pattern-format.md)).
