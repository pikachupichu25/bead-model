# Critique of the 3D Shape Model, and a Simpler One

A review of the first version of step 4 ([shape-model.md](shape-model.md), code in `src/shape/`), written before simplifying it. Numbers are from the code as of commit `41c5f3c`.

## 1. The solver doesn't settle, so its answers depend on how long it runs

The relaxation in `shape.ts` always stops after 600 passes. Running it longer or shorter changes the answer:

| Pattern | 150 passes | 600 (default) | 2400 | 10000 |
|---|---|---|---|---|
| Flat circle, round 3 | **wall** 66° | **cup** 57° | cup 52° | cup 49° |
| Triangle, worst thread stretch | 0.31 | 0.090 | 0.079 | **0.136** |
| Triangle, round 10 waviness | 4.4 mm | 3.0 mm | 4.1 mm | 4.0 mm |

- The test "every thread link within 10%" passes at 600 passes only by luck. At 10000 passes it fails.
- The stiffness numbers (`SHARED_GAP_STIFFNESS = 0.2`, `bend: 0.06`) only mean something for a fixed number of passes. Fitting them to photos would mostly fit how the solver behaves, not how the beads behave.

## 2. The solver is less accurate than the simple formula it starts from

- **Triangle.** The counts give growth 1.46, below the 1.65 a triangle can take and stay flat, so the simple formula says flat or a very shallow cone. That matches the source. The solver calls every round **wavy** and makes a 4 mm saddle.
- **Bezel.** The solver gets "curls in" right, but "front goes up, back goes down" comes from the starting guess (`edgeSign`). No link knows about up and down, so the solver carries that result along rather than predicting it.
- **Bending.** The only resistance to bending is the `bend` link, a weak distance between a bead and the bead two below it. It doesn't care which way the fabric bends, so the direction of any buckle comes from the seeded noise. The triangle's "two corners up, one flat" is probably that noise, not physics.

## 3. The two ways of labelling a round disagree

In a smooth shape of revolution, growth is the cosine of the fabric's angle (g = cos φ). The cut-offs for the growth labels and the angle labels don't line up:

| Boundary | Growth cut-off (`profile.ts`) | Angle cut-off (`shape.ts`) | Angle cut-off as growth |
|---|---|---|---|
| flat / cup | 0.85 (32°) | 25° | 0.91 |
| cup / wall | 0.2 (78°) | 65° | 0.42 |
| wall / curls in | −0.15 (99°) | 115° | −0.42 |

So the same round can be a "cup" on the growth chart and a "wall" in the 3D view.

## 4. Too many hand-set constants for what the model explains

About 15:

- 4 link stiffnesses, plus the shared-gap stiffness
- slack and squeeze for each of 3 tensions (6 values)
- the 0.95 overlap reach, the 0.05 noise, the 600 passes
- `RUFFLE` and the 0.1 × radius rule
- the 4 angle thresholds

There are 4 reference pieces and no photos yet, so there is no way to pin these down.

## 5. The profile maths makes work for itself

- **Radius** is built up round by round from the slope, and the slope is clipped to [−1, 1]. When growth is above 1 the extra row length is simply lost, and that extra length is exactly what sets how big the ruffles are.
- **Smoothing over two rounds** doesn't remove the pair-then-split rhythm. The flat circle still reads 0.00, 0.96, 0.96, 0.96, **1.92**.
- **Special cases:** tube starts, `parent`/`grand` lookups, and `step` computed differently for start rounds.

## 6. Minor issues

- `contacts.ts` refers to a `relax.ts` file that doesn't exist, and says "Three kinds of link" before listing four.
- `separate()` builds a grid with string keys and a new link object for every overlap, on every third pass.
- Each step is solved from scratch with its own noise, so stepping through a pattern can make the piece jump around.

## A simpler model

A peyote pattern fixes the fabric's measurements (how long each row is, how far apart rows are), not its shape. For circular and k-fold patterns a profile curve solves that exactly, with no 3D solve, and ruffles have a closed-form size.

**Per round n**, from bead counts, effective bead length L (with slack) and diameter D:

- Row length: Cₙ = Σ L over the beads of round n and the up beads it is worked into (one zigzag row).
- Distance across from the round it is worked into: Δsₙ = (Dₙ + Dₙ₋₁) / 4.

**Radius straight from the row length, not built up from slopes:**

- Circle: rₙ = Cₙ / 2π.
- Shape with k corners: rₙ = Cₙ / P(k), where P(k) = 2k·tan(π/k) and r is the inradius. P(3) = 10.39, P(4) = 8, P(6) = 6.93, and P → 2π as k grows. This one formula replaces the separate 1.65 / 1.27 / 1.10 cases. k is the number of increase points.

**Height by Pythagoras:** Δr = rₙ − rₙ₋₁, and Δzₙ = ±√(Δsₙ² − Δr²), with the sign from front/back.

**If Δr > Δs** (more row than fits flat):

- Set rₙ = rₙ₋₁ + Δs, and the extra length is E = Cₙ / (P·rₙ) − 1.
- A wavy edge z = A·sin(mθ) is about P·r·(1 + m²A²/4r²) long, so the ruffles are A = (2rₙ/m)·√E high.
- m is the number of waves; start with the number of increase points.

**Labels from one number:** growth g = Δr / Δs and the fabric's angle φ = arccos(g). Label from that alone (flat / cup / wall / curls in), or "ruffles, size A". The chart and the 3D view can't disagree.

**Placing beads for the viewer:** each bead at (rₙ cos θ, rₙ sin θ, zₙ + A·sin(mθ)), θ from the 2D layout, hole along the thread as now. Deterministic, no passes.

**What gets fitted to photos:** only effective L and D per bead type and tension, about 2 numbers instead of about 15. A ruler photo of a tube gives L (row length ÷ bead count); a photo of a flat strip gives D.

### What this gives up

It assumes the piece is symmetric and evenly tensioned: the same at every increase point. For the four reference patterns that is fine. If the project later needs patterns that aren't symmetric, keep a solver but rebuild it properly: the beads as a triangle mesh (each new bead with its two up beads and the bead below already form triangles), stretch plus a real bending term, minimised until it settles, started from the profile above.

## Plan

1. Make the angle labels follow g = cos φ, with one set of cut-offs.
2. Replace the profile code with r = C/P(k), Pythagoras, and the ruffle formula.
3. Drive the 3D view from the profile, and drop the solver or keep it as an experimental option.
4. Narrow the calibration in [shape-model.md §4](shape-model.md#4-what-to-calibrate-next) to effective L and D.
