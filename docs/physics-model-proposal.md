# Proposal: A Thread-Tension Model for the 3D Shape

**Status: first version built** in `src/shape/tension.ts`, alongside the profile model (`src/shape/shape.ts`, [shape-model.md](shape-model.md)). The 3D view's **Model** menu switches between them. The springs model it was first compared with (section 8) has since been replaced by the profile model. Building it changed a few parts of this proposal: see [section 8](#8-what-was-built-and-what-changed). Not built yet: the curvature maps (section 4), friction (2.4) and the "either way" check (3.3).

## Why change the model

What actually happens when you stitch: **the thread is pulled tight, and the beads end up as close together as solid beads can get.** The current model doesn't capture that:

| Current model | What really happens |
|---|---|
| Thread links are springs with a set length. They push beads apart when they get too close | Thread can only **pull**. Beads stop because they **hit each other**, not because a spring reaches its length |
| Rest lengths are guesses: `(L₁+L₂)/2 + slack`, the `√(…)` side-by-side offset, `column`, `gap`, `bend` | Every one of these is a contact between two solid beads. It should come out of the bead shapes, not be written down for each case |
| Beads are spheres of their smaller size | A Delica is nearly a cube and a round is a flattened donut. Whether two beads touch depends on how each one is turned |
| The hole direction is worked out afterwards, from the beads either side | The thread pulls on the **ends** of the hole, which twists the bead. Its direction is part of the answer |
| `SHARED_GAP_STIFFNESS`, `squeeze = 0.9` and the `STIFFNESS` table are fitted by hand | Increase beads splay because the **hole is wider than the thread**. Beads nest under tight tension because their **ends are rounded**. Both can be measured |
| Starting guess: rings at the 2D-diagram angles, on a profile that assumes the piece turns about one axis | Patterns with increases on one side, ovals, animals (`05-moo-deng`) and corners have no such axis |
| Radius, height and verdict are measured around one global axis | A tube that flares on one side, or bends, has no single axis. Shape has to be read locally |

## 1. The physics in one line

> **The piece settles where the tensioned thread is as short as it can be, without any two beads overlapping.**

Why: a thread under tension T stores energy T × (its length). Gravity is tiny next to that: an 11/0 Delica weighs about 5 mg (0.05 mN), while the tension left in finished work is on the order of 0.1 N, about 2000 times more. Nothing else stores much energy. So the shape is a constrained minimum:

```
minimize   E(x, R) = Σ_k T_k · ℓ_k(x, R)   +   E_bend(x, R)
subject to gap_ij(x, R) ≥ 0              for every pair of beads i, j
```

- `x_i, R_i`: the center and orientation of bead i. Six numbers per bead (5 for a bead that is round about its hole).
- `ℓ_k`: the length of free thread k, from the hole where it leaves one bead to the hole where it enters the next.
- `gap_ij`: the distance between the surfaces of beads i and j.

At the minimum, each bead is in **force and torque balance** (the KKT conditions):

```
Σ_k T_k t_k  +  Σ_j λ_ij n_ij  = 0                      forces on bead i
Σ_k (c_k − x_i) × T_k t_k  +  Σ_j (p_ij − x_i) × λ_ij n_ij = 0      torques on bead i
λ_ij ≥ 0,   gap_ij ≥ 0,   λ_ij · gap_ij = 0                  contact pushes, only when touching
```

where `t_k` is the direction of thread k where it pulls on the hole end `c_k`, and `λ_ij` is the contact force at contact point `p_ij` along the normal `n_ij`. This is exactly "beads as close as the thread tension pulls them": the thread pulls, the contacts push back, and nothing else holds the beads in place.

Nothing in it refers to rounds, axes or symmetry. A pattern's shape comes only from which beads the thread passes through, in what order, and how big they are.

## 2. The parts of the model

### 2.1 Beads as solid bodies

Each bead is a **rounded cylinder**: a solid core cylinder (radius `R_c`, half-length `H`) with a sphere of radius `ρ` swept over it. This is convex, so the distance between two beads is quick to compute, and one shape covers the beads we use:

| Bead | Core radius R_c | Core half-length H | Rounding ρ | Notes |
|---|---|---|---|---|
| Round (rocaille) | D/2 − L/2 | 0 (a flat disk) | L/2 | A flattened donut with rounded ends. The ends are rounded, so two rounds tilted toward each other nest closer than L: this **is** the "tight squeeze" |
| Cylinder (Delica) | D/2 − ρ | L/2 − ρ | ≈ 0.1–0.15 mm | Nearly square in profile. Delicas barely nest, which is why they make crisp, even fabric |
| Demi round | as round, shorter L | 0 | L/2 | |

`L`, `D` and `hole` already come from the catalog. `ρ` for cylinders is one new measured number. Hex, cube and triangle beads would later use a convex polygon core with the same trick.

**Distance between two beads:** run GJK (the standard closest-points algorithm for convex shapes) on the two cores, then subtract `ρ_i + ρ_j`. This also gives the contact normal `n_ij` and the contact points. A cheaper first version: approximate each bead by 6–8 spheres around its axis, which fits the sphere grid in `separate()` today.

The thread only ever reaches a bead through its hole, so the hole itself doesn't need to be part of the solid.

### 2.2 Thread: passes, holes and clearance

The thread path already exists (`threadPasses`). Each **pass** goes through a bead in one direction `s = ±1` along its hole axis `a_i`. The thread enters at one face and leaves at the other:

```
hole faces:   f_i^± = x_i ± (L_i/2) · a_i
```

Between two passes the thread runs straight from where it leaves bead i to where it enters bead j. That piece is **free thread** k, with length `ℓ_k = |c_j^in − c_i^out|`.

**Clearance.** The hole is wider than the thread, so inside the hole the thread can lie at an angle to the bead's axis. Where it leaves the hole, the point `c` can be anywhere in the hole's mouth:

```
c = f^± + w,      w ⊥ a_i,     |w| ≤ (hole − d_thread)/2
```

Threads that pass through a bead more than once pack round each other in the hole, so each one can still reach close to the wall. (A first version took `n·d_thread` off the hole for `n` passes, as if the threads lay in a line. That left start-ring beads almost no room and folded small starts that lie flat in real pieces: see [fix-hole-clearance.md](fix-hole-clearance.md).) That gives a maximum tilt between the bead and the thread inside it:

```
tan φ_max = (hole − d_thread) / L
```

| Bead | Hole | Thread 0.2 mm | Thread 0.15 mm |
|---|---|---|---|
| 11/0 Delica (L 1.30) | 0.8 | 25° | 27° |
| 11/0 round (L 1.45) | 0.8 | 22° | 24° |
| 15/0 round (L 1.00) | 0.7 | 27° | 29° |

The thread inside the hole runs straight from where it enters to where it leaves, and counts as thread. Off center on opposite sides at the two ends, it runs across the hole and is longer than the bead, so turning a bead against its thread costs thread.

This replaces `SHARED_GAP_STIFFNESS`. The two beads of an increase are passed once and have no bead between them yet, so they can tilt and splay by up to φ_max. Once the next round goes through them, a second thread has to cross each hole too, and the fabric gets stiffer. Beaders know this: passing through again stiffens the work.

Which way a pass runs (`s`) is fixed by the order of the thread path. In circular peyote, a bead's later passes run the same way as its first; flat and even-count turns can reverse it. This is worked out once, when the pattern is compiled.

### 2.3 Thread stiffness, and what tension means

A perfectly limp thread would let the fabric fold with no resistance (the "floppy" problem below). Real thread is a little stiff. A thread under tension T with bending stiffness B, bent through an angle θ where it leaves a hole, stores extra energy of about

```
E_kink ≈ √(B·T) · θ² / 2          (small θ; from the elastic boundary layer of a tensioned thread)
```

where θ is the angle between the thread inside the hole and the free thread outside it. Dividing everything by T, the whole model has **one length scale**:

```
ℓ_B = √(B / T)        the bending length of the thread

E / T = Σ_k ℓ_k  +  ℓ_B · Σ_kinks θ² / 2
```

That gives tension a physical meaning:

| | ℓ_B compared with a bead | What happens |
|---|---|---|
| **tight** | ℓ_B ≪ L | Thread length dominates. Beads are pulled into the tightest packing their shape allows, and they nest |
| **normal** | ℓ_B ≈ 0.2 L | Thread bends are rounded off a little. The fabric holds its shape but gives |
| **loose** | ℓ_B ≈ L, plus slack | Thread stiffness and slack win. Beads sit loosely, with thread showing |

**Slack.** Loose work is also loose because the beader never pulled all the thread through. Model this as a **slack allowance**: free thread k does not pull until it is longer than `δ_k`.

```
E_k = T_k · max(0, ℓ_k − δ_k)
```

The current `TENSION.slack` numbers (0.25 / 0.08 / 0 mm) can be the first guesses for `δ`. The meaning changes, though. Today slack is added to the length the solver aims for, so it pushes beads apart. In this model it is thread that is allowed to stay loose, and it never pushes anything. The `squeeze` factor goes away: nesting comes from the bead shapes.

Each round already has its own `tension`, so `T`, `ℓ_B` and `δ` can vary by round. The bezel's tight 15/0 rounds get a small `ℓ_B`. A loose start ring gets slack, which is the fix already suggested for the flat circle's dome.

### 2.4 Friction and the spiral (later, version 2)

The thread rubs as it goes through holes and round corners, so tension drops along the path (the capstan law):

```
T(s) = T_pull · exp(−μ Θ(s))
```

Θ(s) is the total angle the thread has turned between point s and the needle when the beader pulls. Beads near the needle get the full pull; beads further back get less. That is **one-sided by nature**: it depends on the stitching direction and where the step-up is, and it predicts the slight twist and spiral real circular peyote shows. It adds one parameter, μ. Leave it out of version 1, and add it if photos show a twist the first version misses.

## 3. Solving

### 3.1 Build the piece the way it is stitched

Don't start from a guessed profile. **Add the beads step by step, as the beader does**, and let each step settle before the next:

1. **Start ring.** A ring of beads in stringing order. It really is a closed loop, and its size is the sum of the bead lengths (plus slack).
2. **Each new bead** in a gap between up beads `u` and `v`, with `w` the bead below it if there is one:
   - its axis points from where the thread leaves `u` to where it enters `v`
   - with a `w`, it rests on `w`: one bead width out from it, away from the fabric below; a pair or triple lies end to end, centered over `w` (as built: see section 8)
   - with no `w`, its center goes on the line between `u` and `v`, moved half a diameter outward from the middle of their round, and a pair or triple goes on that line, side by side
3. **Settle** the whole piece built so far (3.2), starting from where the beads were at the last step.
4. **Next step.**

This needs no axis, no profile and no 2D angles, so it works the same for an oval, a one-sided increase, a corner, or an animal. Each step's shape comes free, and the step view already wants it. It also deals with history: a piece whose shape isn't fully fixed (below) takes the shape it was built in, as real work does.

### 3.2 Settling: thread forces, then contacts

Each pass, for every bead (rigid-body position-based dynamics, Müller et al. 2020; a quasi-static version with no velocities):

```
1. thread:   for each free thread k from c_i (leaving i) to c_j (entering j):
                 e = c_j − c_i;   if |e| ≤ δ_k skip
                 f = T_k · e/|e|
                 F_i += f,  τ_i += (c_i − x_i) × f
                 F_j −= f,  τ_j −= (c_j − x_j) × f
             plus the kink torques from 2.3
2. move:     x_i += η · F_i          (capped at a tenth of a bead per pass)
             turn bead i by η' · τ_i (axis–angle)
3. clearance: put each c back in its hole mouth: project w onto the plane ⊥ a_i, cap at the clearance radius
4. contacts: for each pair with gap < 0, push them apart along n_ij,
             sharing the move between position and turning by their effective masses
             w = 1/m + (r × n)ᵀ I⁻¹ (r × n)
5. stop when no bead moves more than 10⁻⁴ mm in a pass
```

Step 1 makes the thread pull. Step 4 makes the beads solid. The fixed point of these steps is the force and torque balance in section 1. The solver stops when it has converged, not after a fixed 600 passes. Thread and contact residuals are reported, which replaces `strain`. What's left is a real measure of how far the pattern asks for something the beads can't do.

For a slower, more exact solve (tests, calibration), the same energy can go into L-BFGS with a log barrier on the gaps (Incremental Potential Contact, Li et al. 2020). The answer should be the same.

Cost: about 30 contacts and 4 free threads per bead, with GJK on two small convex cores. A few thousand beads × a few hundred passes is fine in the browser. Stepping through the pattern is cheap because each step starts from the step before.

### 3.3 Floppy shapes and two possible shapes

Two things are physically true and the model should say them, not hide them:

- **Floppy modes.** Peyote fabric is stiff in its own plane but bends easily out of it. Thread stiffness (`ℓ_B`) and the history from 3.1 settle most of this. What remains is real: a tube can be squashed.
- **More than one stable shape.** A row with too many beads can ruffle up or down, and a saddle can flip. Settle the piece twice, from slightly different nudges (seeded, so it stays deterministic). If the two shapes differ in form but their energy is within a few percent, report **"this shape can go either way"** instead of choosing one without saying so.

## 4. Reading the shape without assuming symmetry

### 4.1 Before solving: curvature from the counts, bead by bead

Growth (step 1) has a local version, and it is exact rather than averaged over a round.

Join each bead to the beads it touches in the ideal fabric: its two up beads, the bead below it, and the beads above. That gives a triangle mesh whose edge lengths come from the bead sizes (the contact distances when the fabric lies flat). The **angle defect** at bead b is

```
K_b = 2π − Σ (angles of the triangles meeting at b)        (π − Σ at the edge of the piece)
```

Each angle comes from its triangle's three edge lengths by the law of cosines. `K_b > 0` means the fabric wants to dome there, `K_b < 0` that it wants to ruffle or saddle, and `K_b ≈ 0` that it can lie flat or roll into a tube.

This is what growth already measures, done bead by bead. Gauss–Bonnet for the patch inside a round says

```
dC/ds = 2π − Σ_{beads inside} K_b       ⇒       growth = 1 − (Σ_inside K_b) / 2π
```

So growth is the sum of these defects round one round, and the per-bead map holds the same information without averaging round the round. An oval with increases only at its ends shows defects only at its ends; a one-sided increase shows them on one side. It is cheap enough for the editor to show live as a heat map on the 2D diagram, before any 3D solve.

### 4.2 After solving: what the piece actually did

On the mesh of solved bead centers:

- **Gaussian curvature** per bead (angle defect, as above, but from the 3D positions) and **mean curvature** (from the dihedral angles). The difference from 4.1 shows where the beads had to give.
- **Local verdict per bead:** flat (both small), dome or cup (K > 0), wall or tube (K ≈ 0, mean curvature ≠ 0), ruffle or saddle (K < 0).
- **Per round**, where a round makes sense: fit its own plane and center (PCA). Report its size, its tilt against the round below, and how far its center moved. The round centers make a **centerline**, and its curvature gives a bend: "the tube bends 30° toward gap 4". There is no global axis to assume.
- The current radius, height and angle table becomes a special case: for an axisymmetric piece every round's plane lines up, the centerline is straight, and the old numbers come back.

## 5. What goes and what comes in

| Goes | Comes in (measurable) |
|---|---|
| `thread`, `column`, `gap` and `bend` links and their rest lengths | Bead shape: `L`, `D`, `hole` (already in the catalog), `ρ` for cylinders |
| `STIFFNESS` table | Thread diameter `d_thread` (from the thread's spec) |
| `SHARED_GAP_STIFFNESS` | Bending length `ℓ_B` per tension level (or `B` per thread and `T` per tension) |
| `TENSION.squeeze` | Slack allowance `δ` per tension level |
| Profile-based starting guess and 2D angles in 3D | Step-by-step build |
| Global axis, `startFrame` | Local frames, centerline |
| Fixed 600 passes | Stop on convergence |

Four or five numbers, each with a physical meaning that can be measured with calipers or fitted to one photo, instead of eight fitted by hand.

## 6. How to test it

Unit tests (these need no photos):

| Test | Expected |
|---|---|
| Two Delicas end to end, pulled together | Centers exactly L apart, axes in line |
| Two rounds end to end, tilted 20° | Closer than L (they nest) |
| Flat even-count peyote strip | Flat. Bead pitch along the row and across rows matches the catalog sizes |
| No beads overlap at the end, ever | Every gap ≥ −10⁻³ mm |
| Turning or moving the input | Same shape |
| A symmetric pattern | Symmetric shape, except for a small effect at the step-up |

Shape benchmarks, chosen so they **can't** be solved by assuming symmetry:

| Pattern | Expected |
|---|---|
| Flat circle | Flat, with no dome when the start ring has slack |
| Triangle | Flat, with three corners. Defects in 4.1 only at the corners |
| Tube with increases on one side only | Flares out on that side and stays a wall on the other (increases add width round the tube, not length along it, so it flares rather than bends) |
| Oval (`05-moo-deng`) | Oval cross-section, closed end shaped like the pattern's increases |
| Rivoli bezel | Both edges curl in. Opening size against a photo |
| Ruffle (growth > 1.3) | Waves, flagged as able to go either way where it can |

Calibration then needs fewer numbers than before. Measure `L`, `D`, `hole`, `ρ` and the thread diameter with calipers, and fit `ℓ_B` and `δ` per tension level to two or three photographed pieces (side view and top view, next to a ruler, as [shape-model.md §4](shape-model.md#4-what-to-calibrate-next) already plans).

## 7. Build order

Each stage can be checked on its own. The current solver can stay behind a switch until the new one matches or beats it on the references.

1. **Rigid beads and contacts.** Rounded-cylinder shapes, GJK distance, the contact push with turning. Tests: pairs of beads.
2. **Thread forces.** Passes and their direction, hole faces, clearance, slack. Tests: a strung ring pulls into a circle; a flat strip.
3. **Settling and stopping.** Quasi-static loop, residuals, two-nudge check for "either way".
4. **Step-by-step build.** Placement rule, warm start from the step before. Wire into the step view.
5. **Reading the shape.** Intrinsic defect map (4.1) in the editor; solved curvature, local verdicts and centerline (4.2) in the 3D view.
6. **Benchmarks and calibration.** Section 6. Then friction (2.4) if photos show a twist.

## 8. What was built, and what changed

The first version follows sections 1–3 with the changes below. Each one came from a test that failed the first way.

**The energy is minimized directly.** The solver minimizes the energy of section 1 with L-BFGS (a quasi-Newton method) and a line search, so every step it takes lowers the energy, and it stops when no step does. Two position-based versions (section 3.2) were tried first and dropped:

- *A constant pull on each free thread* doesn't tighten a loop. Every bead in a chain is pulled equally both ways, so slack can sit anywhere at no cost, and only the small inward pull where the thread turns closes it.
- *A pull in proportion to each thread's extra length* (a spring) tightens loops, but it overweights threads that can never be short. Between beads half a row apart, the thread has to cross about D/2 (≈ 0.4–0.8 mm). Those threads kept tilting and buckling the beads, and more iterations made pieces wavier instead of settling them.

Uniform tension says only each thread's total length matters, Σ(ℓ − δ)⁺, so that is the energy. The solver doesn't need a step size, and the result doesn't change with the iteration cap once it has converged (a tube gives the same shape at 400 and 1600 steps).

**Contacts use probe spheres, not closest points.** The distance between two convex beads (GJK, or alternating projection) is not smooth when two flat faces meet side by side, as Delicas do: the closest point jumps from one edge to the other. The energy's gradient was then wrong by more than its size, and the solver stalled. Instead, each bead is filled with a ring or two of overlapping **probe spheres** (8 per ring), and each probe's overlap with the other bead is measured against that bead's exact signed distance (a closed formula for a rounded cylinder). The energy is (k/2)·overlap² with k = 400 per unit tension, which leaves overlaps under 0.01 mm. The gradient matches finite differences to 0.6%.

**A new bead rests on the bead under its gap.** Section 3.1 placed a new bead on the line from where the thread leaves up-bead u to where it enters up-bead v, half a bead outward. In a straight row that line runs just above the bead underneath. At the corners of a small start ring it cuts right across it. In Moo Deng (a 4-bead center start), round 3's pairs were placed on top of the start ring. The contact penalty shoved them apart at random, some ended up inside the ring, and the cylinder was built on a scrambled bottom. Now, when there is a bead under the gap, the new bead goes one bead width out from it (the peyote column), and a pair lies end to end, centered over it. The line is used only when nothing is underneath.

**A tube start isn't settled on its own.** A freshly strung tube start is a loose loop. Settling it alone flattened its zigzag (round 1 low, round 2 high) at random, and round 3 beads then went up at some gaps and down at others. It is settled together with round 3.

**Thread that moves to the other edge of a tube doesn't pull across.** Going from the front lip to the back edge (`edge: back`), the thread is woven through the beads between. A straight free thread there pulled the two lips together, so the model leaves it out. A new step's thread joins the last step's only if the two beads are thread neighbours.

**The piece is turned so its front rounds rise.** Nothing in the physics says which way is up.

**Room in the hole, the thread inside it, and leaning to the front.** A real Moo Deng lies flat at round 3, but the model folded it into a saddle: the thread had too little room in the holes. Fixing that made Moo Deng's wall lean, a trap the step-by-step build fell into, fixed by starting each new bead a little toward the front of the fabric. See [fix-hole-clearance.md](fix-hole-clearance.md).

### What it gives

With generic bead sizes (catalog estimates) and the first-guess constants:

| Pattern | Springs model (since replaced) | Thread-tension model |
|---|---|---|
| Plain tube, 16 Delicas round | Wall | Wall, rising 0.8 mm (D/2) per round, waviness under 0.1 mm |
| [1. Flat circle](references/01-flat-circle.md) | Center rises into a dome (rounds 3–5 "cup") | A shallow bowl, about 2 mm deep over 15 mm: rounds 3–4 at about 30°, the outer rounds within 26° |
| [2. Rivoli bezel](references/02-rivoli-bezel-cup.md) | Both edges curl in | Both edges curl in; front lip about 1.4 mm in from the band, back lip about 0.8 mm |
| [3. Triangle](references/03-flat-triangle.md) | Three corners, slight warp | Three corners, warped about 5.7 mm over its 26 mm width. Same cause as the springs model's warp: with nominal sizes the sides are a little short of row length |
| Tube, one increase every other round in the same gap | Can't show it: the starting guess is symmetric, so it stays round | Flares out on the increase side: 7.5 mm from the axis there, 5.3 mm on the opposite side |
| `05-moo-deng` | Wall | Closed bottom (rounds 1–6 within 25° of flat), turning up over rounds 7–8 into a cylinder: rounds 9–17 are walls, radius 5.5–6.1 mm, waviness under 0.4 mm. The bottom is a little lumpy, which the counts predict: rounds 2–4 have growth 1.10 and round 5 (8 → 14 beads) 1.37, more than a flat disk holds |

One prediction to check against photos: **rigid flat-ended beads in a ring sit further out than ΣL/2π.** Their inner corners touch first and leave wedge gaps outside. A 16-Delica tube comes out at R ≈ 4.0 mm, not 3.3, and a 32-bead bezel band at about 7.3 mm, not 6.6. The profile model uses ΣL/2π, as the springs model did.

### Filled pieces

A closed piece worked around a core bead (the [ball](references/06-beaded-ball.md), the [whale](references/07-whale.md)) caved in: nothing in the model pushed outward, so thread pull and bending let the bottom settle as a wide, rippled disk (2.5 mm of ripple on the whale) and the belly fold in. Patterns marked `filled: true` now get a pressure from inside:

- **Volume.** A closed surface of triangles through the bead centers: each round zipped to the up beads it was worked into, with a flat lid on the first and last rounds. The energy gains −P·V, and ∂V/∂p = (q × r)/6 per triangle (p, q, r).
- **Size of P.** The thread pulls back like a skin, which holds at most about 2γ/R (Laplace). A fixed P would blow big pieces up and barely touch small ones, so each step sets P = `FILL_PRESSURE` / (R·L): R is the radius of a sphere with the surface's area, L the mean bead length. The whale blew up from about 0.35; the value is 0.3.
- **Guard.** The pressure eases off and stops once the volume reaches that of a sphere with the surface's area at the start of the step, the most such a skin can hold: more would have to stretch the thread. With it, even 0.6 settles.
- **When.** From the first of the widest rounds on, when the cup is as wide as it gets and the core goes in. Pushing from the start, through a lid over the flat start's rim, pulled the threads at its increases open (up to 1.65 mm past their slack, against 1.09 mm without filling). Waiting until the first decrease left the open cup to buckle unpushed for 8 rounds, and it buckled differently in Node and in Chrome (ripple 1.0 mm against 5.2 mm at round 18), because floating-point differences pick which way it goes.

On the whale: ripple under 0.7 mm in every round (it was up to 2.5 mm), in Node and in Chrome alike, about 19 mm across and 16 mm tall, with no thread pulled further open than without the filling.

### Costs

A whole piece takes 0.4 s (flat circle, 77 beads) to 3 s (Moo Deng, 170 beads) in Node, about 3–10 times the springs model. Steps are built in order and cached, so stepping through a piece solves each step once. Most of the time is contacts. If bigger pieces need it, the first speed-up is to settle only the last few rounds at each step and the whole piece at the end.

### Constants

| Constant | Value | Where |
|---|---|---|
| Slack δ (loose / normal / tight) | 0.25 / 0.08 / 0 mm | `THREAD_TENSION` |
| Bending length ℓ_B (loose / normal / tight) | 0.6 / 0.25 / 0.05 mm | `THREAD_TENSION` |
| Thread diameter | 0.2 mm, or the pattern's `thread_diameter` | `THREAD_DIAMETER` |
| Lean of a new bead to the front | 0.1 of its diameter | `FRONT_LEAN` |
| Edge rounding of cylinder beads | 12% of the smaller size | `EDGE_ROUNDING` |
| Contact stiffness | 400 per unit tension | `CONTACT` |
| Pressure in a `filled` piece | 0.3 / (R·L) per unit tension | `FILL_PRESSURE` |

All are first guesses, to be fitted to photos as in [shape-model.md §4](shape-model.md#4-what-to-calibrate-next).

## References

- Müller, Macklin, Chentanez, Jeschke, Kim. *Detailed Rigid Body Simulation with Extended Position Based Dynamics*. SCA 2020. Rigid bodies and contacts in a position-based solver.
- Li et al. *Incremental Potential Contact*. SIGGRAPH 2020. The barrier method for the exact solve.
- Gilbert, Johnson, Keerthi. *A fast procedure for computing the distance between complex objects in three-dimensional space* (GJK). 1988.
- Discrete Gaussian curvature as angle defect, and discrete Gauss–Bonnet: Meyer, Desbrun, Schröder, Barr. *Discrete Differential-Geometry Operators for Triangulated 2-Manifolds*. 2003.
- Capstan equation (Euler–Eytelwein) for friction round a curve.
