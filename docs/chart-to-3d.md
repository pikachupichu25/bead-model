# From Bead Chart to 3D Object

How a written peyote pattern (`*.peyote.yaml`) becomes the 3D model in the web app, and the geometry and physics behind each step.

[shape-model.md](shape-model.md) is the reference for the constants and the calibration status. This page explains *why* the model works the way it does.

## The pipeline

```
pattern.peyote.yaml
   │  load.ts, notation.ts
   ▼
compiled pattern ── every bead: its round, its gap, which two up beads it sits between
   │  compile.ts, thread.ts
   ├──────────────► 2D layout (layout.ts): an angle θ for every bead
   ▼
bead sizes from the catalog (length L, outer diameter D, per bead)
   │
   ├─► 1. Growth per round        profile.ts   (counting: one number per round)
   ├─► 2. Contact links           contacts.ts  (which beads touch, and how far apart)
   ▼
3. Starting guess → 4. Relax (position-based dynamics) → 5. Measure and label
                         shape.ts
   ▼
positions + hole directions ──► viewer3d.ts draws each bead at its real size
```

The model has two halves:

- A **counting model** (step 1) that predicts the shape from bead counts and sizes alone. It is fast and easy to explain, and it drives the growth chart.
- A **mechanical model** (steps 2 to 5) that places every single bead by treating the piece as beads held together by thread and contact. This gives the 3D view.

The counting model also seeds the mechanical one, so the solver starts close to the answer.

---

## 1. The geometry: why bead counts decide the shape

### The key idea: circumference vs. radius

Peyote fabric is built in rows (rounds). Each round lies on a closed loop around the previous one, a fixed distance further across the fabric. So the fabric is described by one function:

> **C(s)**: the length of the loop at distance *s* from the center, measured *along the fabric*.

The shape of a surface built this way depends almost entirely on how fast C grows with s:

| How C grows | Surface | Example |
|---|---|---|
| dC/ds = 2π | Flat plane (a disk) | Flat circle |
| 0 < dC/ds < 2π | Cone or bowl (positive curvature) | Cup, bezel base |
| dC/ds = 0 | Cylinder | Tubular peyote |
| dC/ds < 0 | Closes back in | Bezel lip around a rivoli |
| dC/ds > 2π | Too much fabric for the plane: it ruffles (negative curvature) | Ruffled edges, hyperbolic crochet |

This is a form of Gauss's *Theorema Egregium*: whether a surface is flat, curved like a sphere, or curved like a saddle is decided by lengths measured inside the surface, not by how it is bent in space. A beader controls those lengths directly: the number and size of beads in each round *is* the circumference. The thread cannot stretch much and beads cannot shrink, so the fabric has to take whatever 3D form fits those lengths.

### Measuring circumference in beads

Going once round a worked round, the thread passes through every new bead *and* every up bead of the round below (the beads it is stitched into). So the row length of round *n* is

```
C(n) = Σ L_eff(new beads) + Σ L_eff(up beads)

L_eff = L × squeeze + slack        (per tension setting: loose / normal / tight)
```

Each round sits about half a bead diameter further across the fabric, because in peyote a bead rests in the gap of the round below, offset by half a bead:

```
Δs(n) = (D̄(round n) + D̄(round below)) / 4
```

### Growth: one number per round

Comparing with a flat circle gives the **growth** of a round:

```
            C(n) − C(n−2)
growth = ──────────────────────
          2π × (Δs(n) + Δs(n−1))
```

- growth = 1: exactly what a flat disk needs
- growth = 0: a straight tube wall
- growth < 0: the edge curls inward
- growth > 1: more than the plane can hold

Growth is measured over **two** rounds because peyote works in pairs: a round of increases (two beads in a gap) followed by a round that splits them. Over one round, a flat circle swings between 0 and about 1.8. Over two, it settles near 1.

### From growth to a profile

Growth is the slope of the piece's cross-section. Take one step Δs along the fabric. If the circumference grows by g·2π·Δs, the radius (distance from the axis) grows by g·Δs. The rest of the step has to go up, by Pythagoras:

```
Δr = g · Δs
Δz = Δs · √(1 − g²)          (valid for −1 ≤ g ≤ 1)
```

So g = 1 is flat (all outward), g = 0 is vertical (all upward), and g = −1 turns straight back in. For g > 1 there is no real Δz: the round has more length than any surface of revolution can hold, and the only way out is to buckle into waves. That is what a ruffle is.

### Corners change the flat value

2π is the flat value for a *circle*. A polygon with sharp corners gains extra perimeter at every corner. For an equilateral triangle, the perimeter grows by 6√3 ≈ 10.4 per unit of offset instead of 2π ≈ 6.28, so a triangle stays flat up to growth ≈ 1.65 (a square ≈ 1.27, a hexagon ≈ 1.10). This is why geometric peyote puts its increases at fixed corners.

### Worked example: the rivoli bezel

[patterns/02-rivoli-bezel-cup.peyote.yaml](../patterns/02-rivoli-bezel-cup.peyote.yaml) has 16 beads in every round. Bead count alone suggests a straight tube. But rounds 4 to 7 switch from 11/0 cylinders (L = 1.3 mm) to 15/0 rounds (L = 1.0 mm) at tight tension:

| | Row length |
|---|---|
| Round 2 (32 × 11/0, normal: 1.3 + 0.08) | 32 × 1.38 = 44.2 mm |
| Round 4 (16 × 15/0 tight: 1.0 × 0.9, plus 16 × 11/0 up beads: 1.38) | 14.4 + 22.1 = 36.5 mm |

The distance across rounds 3 and 4 is 0.80 + 0.78 = 1.58 mm, so

```
growth = (36.5 − 44.2) / (2π × 1.58) ≈ −0.78
```

The edge curls in. Rounds 5 to 7 (all 15/0) reach −1.6. This matches how the bezel actually grips the stone: **bead size matters as much as bead count.**

---

## 2. The mechanics: placing every bead

Growth gives one number per round. To place individual beads, the program builds a **constraint network**: every pair of beads that touch in the real piece is joined by a link with a rest length (the distance between their centers when they just touch).

### Links

| Link | Physical meaning | Rest length |
|---|---|---|
| **thread**, same round | Beads lie end to end on the thread | (L₁ + L₂)/2 + slack |
| **thread**, next round | A bead and the up bead it is stitched through sit side by side, half a row apart | √( ((L₁ + L₂)/2 + slack)² + ((D₁ + D₂)/4)² ) |
| **column** | A bead alone in its gap rests on the bead two rounds directly below it | (D₁ + D₂)/2 |
| **gap** | A bead alone in its gap holds its two up beads apart by its own length | L_up/2 + L_bead + L_up/2 + 2·slack |
| **bend** | Keeps a column of three beads straight unless pulled | D_top/2 + D_mid + D_bottom/2 (weak) |

Thread links come straight from the thread path (`thread.ts`), the same path the diagrams draw. Column and gap links are what make peyote a firm fabric rather than a loose chain: a bead can't sink into its gap past the bead below it, and can't let its neighbours close up on it.

**Stiffness** says how hard a link resists being wrong (thread 1.0, column 0.9, gap 0.5, bend 0.06). Links to beads that **share a gap** (the pair in an increase) are 5× softer (0.2): in real work, increase beads tilt and splay and thread shows between them, so they give way first. Without this, a triangle's corners can't absorb their strain and the whole piece folds.

### The energy being minimized

Taken together, the links describe an elastic energy:

```
E(x) = Σ_links  k_ab · ( |x_a − x_b| − rest_ab )²
```

plus a hard rule that no two beads overlap:

```
|x_a − x_b| ≥ r_a + r_b        r = 0.95 × min(D, L) / 2
```

The shape is a low-energy configuration of E. If the row lengths are compatible with a flat plane, the minimum is flat. If they are not (growth ≠ 1), no flat arrangement can satisfy every link, and the beads move out of the plane until they can. This is the counting argument from section 1, now solved bead by bead.

### Solving: position-based dynamics

The solver uses **position-based dynamics** (PBD, Müller et al., 2007), the method games and cloth simulators use. Instead of computing forces and integrating velocities, it fixes the positions directly:

```
repeat 600 times:
    for each link (a, b):
        d   = x_b − x_a
        err = (|d| − rest) / |d|
        x_a += d · err · k/2
        x_b −= d · err · k/2          # each bead moves half the way
    every 3rd pass:
        push apart any overlapping beads (spatial grid, so it stays fast)
```

Each update moves the two beads along the line between them, toward the rest length, by a fraction set by the stiffness. Sweeping over all links again and again (Gauss–Seidel style) settles the network toward a minimum of E. There is no time, mass or gravity: the result is the shape the piece *holds*, not how it moves.

### Starting guess and symmetry breaking

A relaxation solver finds a nearby minimum, so where it starts matters:

1. Each round starts as a ring at the angles θ from the 2D diagram (so beads begin in the right order around the piece).
2. Its radius and height come from walking the profile out from the start ring with Δr = g·Δs, Δz = Δs·√(1 − g²) (growth clamped to [−1, 1]). Front rounds of a tube go up, back rounds go down.
3. A tiny seeded random offset in height (5% of a bead diameter) is added.

The noise matters. A row with too many beads, laid out perfectly flat, is in **unstable equilibrium**: the in-plane push is balanced, and the solver has no reason to move it out of the plane. A small nudge lets it buckle, just as a real ruffle does. The random generator is seeded from the bead count, so the same pattern always gives the same shape.

### Orienting and measuring

After relaxing, the piece is turned so its axis points up, with the start ring's center at the origin. Each round's normal comes from **Newell's method** (the normal of a closed, possibly non-planar polygon, taken in stringing order). Its length is twice the area the round encloses, so adding up every round's normal gives an axis where the big outer rounds count most. Taking the start ring alone is not enough: a small ring (4 beads, say) can sit tilted to the rest of the piece, and a straight tube measured against it looks like a leaning, wavy cone. Then, for each round:

- **radius**: mean distance of its beads from the axis
- **height**: mean height along the axis
- **waviness**: standard deviation of the heights
- **angle**: atan2(rise, Δradius) from two rounds down

and a verdict:

| Condition | Verdict |
|---|---|
| waviness > 0.3·D and > 0.1·radius | wavy (ruffle or saddle) |
| angle < 25° | flat |
| angle < 65° | cup |
| angle < 115° | wall |
| otherwise | curls in |

**Strain** (the largest stretch or squash of any thread link) is also reported. High strain means the pattern asks for something beads and thread can't do.

### Hole direction

Each bead's hole points from the bead before it on the thread to the bead after it. Round and cylinder beads are symmetric around their hole, so a center point and a hole direction are enough to draw them. The viewer turns each bead's profile on a lathe at its catalog size (`viewer3d.ts`).

---

## 3. Summary of the models used

| Concept | Where | Field |
|---|---|---|
| Circumference growth decides curvature | `profile.ts` | Differential geometry (intrinsic curvature, surfaces of revolution) |
| Polygon perimeter growth at corners | docs only | Plane geometry (offset curves) |
| Beads as points joined by distance constraints | `contacts.ts` | Mass-spring / constraint networks |
| Thread tension as slack and squeeze | `contacts.ts` | Empirical constants |
| Energy minimization by repeated projection | `shape.ts` | Position-based dynamics (Gauss–Seidel) |
| Buckling of over-long rows | `shape.ts` | Elastic instability, symmetry breaking by noise |
| Axis of the piece | `shape.ts` | Newell's method, summed over the rounds |

## 4. What the model leaves out

- **Beads are spheres for collisions**, using their smaller dimension, so a long bead can sink a little into its neighbour.
- **No gravity**: a piece doesn't sag or rest on a table.
- **Bending stiffness is a guess.** It decides *which way* a piece buckles, not *whether* it does.
- **Constants are uncalibrated.** Bead sizes, slack, squeeze and corner softness are first guesses until they are fitted to photos of real pieces (see [shape-model.md §4](shape-model.md#4-what-to-calibrate-next)).
