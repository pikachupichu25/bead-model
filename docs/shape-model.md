# The 3D Shape Model

Step 4 of [plan.md](plan.md). **Status: first version. Constants are first guesses until we fit them to photos of real pieces.**

This explains how the program works out the 3D shape a pattern makes. It uses the compiled pattern (every bead, the gaps it sits in, the thread path) and the bead sizes from the [catalog](bead-catalog.md). Code: `src/shape/`.

## 1. What the counts predict: growth

Going once round a worked round, the thread passes every new bead and every up bead once. So the **row** the round lies in is about

> row length = Σ length of the new beads + Σ length of the up beads (+ a little thread between each)

and each round sits about half a bead diameter further across the fabric (Δs = D/2, since a bead rests on the bead two rounds below it).

A flat circle's circumference grows by 2π for each unit of radius. So for each round:

> **growth** = (row length − row length two rounds before) / (2π × distance across those two rounds)

Peyote works in pairs of rounds (a round of pairs, then a round that splits or skips them), so growth is measured over two rounds. Over one round, the flat circle swings between 0 and 1.8.

| Growth | Meaning |
|---|---|
| below −0.15 | Row is shorter than the one before: the edge **curls in** |
| −0.15 to 0.2 | Same length: a straight **wall** (tubular peyote) |
| 0.2 to 0.85 | Grows, but less than a circle: a **cup** or cone |
| 0.85 to 1.15 | **Flat** |
| above 1.15 | More than a flat circle can hold: **ruffles**, unless the increases stay at fixed corners |

Growth is the slope of the piece's profile: if a round's row grows by `g × 2π × Δs`, its radius grows by `g × Δs`, and the rest of the step goes up. That only works for −1 ≤ g ≤ 1. Above 1, there is more row than room, and the extra has to go out of the plane.

Corners change the flat value. An equilateral triangle's perimeter grows by 6√3 ≈ 10.4 per unit of offset, not 2π, so a triangle can take growth up to about 1.65 and still lie flat (a square about 1.27, a hexagon about 1.10).

Bead size counts as much as bead count. The bezel has 16 beads in every round, but its 15/0 rounds have a shorter row than the 11/0 rounds under them, so growth goes to −1.6 and the edges curl in.

## 2. Where each bead goes: relaxing the contacts

Growth is one number per round. To place every bead, the program treats the piece as beads held together by what touches what (`contacts.ts`):

| Link | Between | Distance |
|---|---|---|
| thread, same round | Beads the thread passes straight between (a center ring, the beads of a pair, up beads on either side of a `0`) | End to end: (L₁ + L₂)/2 + slack |
| thread, next round | A bead and the up bead it is stitched to | Side by side, half a row apart: √(((L₁ + L₂)/2 + slack)² + ((D₁ + D₂)/4)²) |
| column | A bead alone in its gap, and the bead directly below it two rounds down | (D₁ + D₂)/2 |
| gap | The two up beads either side of a bead alone in its gap | L_up/2 + L_bead + L_up/2 + 2 × slack |
| bend | A bead and the bead two below it in its column | A straight column. Weak: only says "stay straight unless pulled" |

Thread links come straight from the thread path the diagrams draw. Column and gap links are what make peyote fabric firm: a bead can't sink into its gap past the bead below, and it holds its up beads apart by its own length.

Links to a bead that **shares its gap** (a pair or a triple) are 5× softer. Increase beads tilt and splay, and thread shows between them, so they give way first. Without this, the triangle's corners can't absorb their strain and the piece folds in half.

**Tension** changes the lengths (`TENSION` in `contacts.ts`):

| Tension | Slack between beads | Bead length counts as |
|---|---|---|
| loose | 0.25 mm | 100% |
| normal | 0.08 mm | 100% |
| tight | 0 | 90% (beads tilt and nest) |

**Solving** (`shape.ts`):

1. **Starting guess.** Each round is a ring at the angles of the 2D diagram. The radius and height come from walking the profile out from the start ring using each round's growth. Front rounds of a tube go up, back rounds go down. A little seeded noise in height lets rows with too many beads buckle.
2. **Relax.** 600 passes: move each linked pair toward its distance (position-based dynamics), and every third pass push apart any beads that overlap (each bead is a sphere of its smaller dimension).
3. **Measure.** Turn the piece so the start ring lies flat at the origin. For each round, measure its mean radius, mean height, and how much its heights spread (waviness). Then give it a verdict:
   - **wavy**: heights spread by more than 0.3 bead diameters and more than a tenth of the radius (ruffles, or a saddle-like warp)
   - otherwise by the angle of the fabric from two rounds down: under 25° **flat**, under 65° **cup**, under 115° **wall**, else **curls in**

Each bead's hole points from the bead before it on the thread to the bead after it. Round and cylinder beads are symmetric round the hole, so that is all the renderer needs.

The same pattern always gives the same shape. A step shows the piece as built up to that step, solved on its own: the bezel before its back rounds is a different shape from the finished bezel.

## 3. Comparing with the reference pieces

We don't have photos of our own pieces yet. These are the shapes the sources describe, against what the model gives using generic bead sizes (all `estimate` in the catalog):

| Reference | Source says | Model gives | Agrees? |
|---|---|---|---|
| [2. Rivoli bezel](references/02-rivoli-bezel-cup.md) | Short tube; both edges curl inward to hold the stone | Round 3 a wall; rounds 4–7 curl in, front up and back down. Band about 14 mm across, opening about 7 mm | Yes |
| [1. Flat circle](references/01-flat-circle.md) | Flat disk | Rounds 6–7 flat, but rounds 3–5 rise into a shallow dome (about 2.5 mm on a 15 mm piece) | Partly |
| [3. Triangle](references/03-flat-triangle.md) | Flat triangle | Three clear corners and straight sides, but warped like a saddle: two corners about 4 mm up and down, the third flat, on a 28 mm piece | Partly |
| [4. Trinket box top](references/04-christmas-mug-trinket-box.md) | Unknown (only 3 rounds; "the top may dome") | A shallow cup | Can't tell |

**Why the flat circle domes.** Its 14-bead start is followed by a round of 7 (one per gap), which adds no row length at all, so the model stands it up as a wall. The source treats the foundation as lying flat. Real foundations are often loose, so the start ring probably stretches. A looser start ring (or tension per start) would test this.

**Why the triangle warps.** With nominal 11/0 sizes (2.0 × 1.45 mm), the sides need about 10.4 mm more row per round to stay flat and get 9.2 mm. The 2-bead corners make up the difference by splaying, and the rest goes out of the plane. Geometric peyote does warp this way ("warped squares" use it on purpose), but small triangles lie flat in photos. So either real beads are relatively longer than our nominal sizes, or corners splay more than the model allows. Measuring real beads, or a photo of a 10-round triangle, will tell which.

## 4. What to calibrate next

Ranked by how much they move the shapes:

1. **Bead sizes.** Measured length and diameter of the beads actually used, not the generic estimates.
2. **Corner softness** (`SHARED_GAP_STIFFNESS`, now 0.2): sets how flat the triangle can stay.
3. **Slack and tight squeeze** (`TENSION`): set how far the bezel lips close in.
4. **Start ring looseness:** decides whether the flat circle's center domes.

For each, the test is a photo of a real piece, from the side and from above, next to a ruler, with the pattern file it was stitched from. The model's numbers (radius and height per round) can then be compared directly.

## Limits

- Beads are points with distances between them, not solid bodies, so beads can sink into each other by up to the difference between their length and diameter.
- No gravity, so a piece doesn't sag or rest on a table.
- Bending stiffness is a guess. It decides *which way* a piece buckles, not *whether* it buckles.
- Joining pieces, odd-count tubes and mixed bead sizes in one round are still out of scope (see [pattern-format.md](pattern-format.md)).
