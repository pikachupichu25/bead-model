# Fix: Pressure from Inside for Filled Pieces

**Status: done.** A fix for the thread-tension model ([physics-model-proposal.md](physics-model-proposal.md)), which squashed closed pieces that are worked around a core bead. Found on the [whale](references/07-whale.md) and also applied to the [beaded ball](references/06-beaded-ball.md).

## The problem

The real whale body is a ball, 16–20 mm across, with a flatter bottom. The model squashed it into a pillow:

- The bottom (rounds 1–7) settled as a wide, rippled disk: heights within each round went up and down by up to 2.6 mm.
- The off-white belly caved in, and rounds 17–23 rippled by about 1 mm.
- Beads sat on average 1 mm inside the piece's convex outline, the worst 4.9 mm.

## Why it happens

The model's forces only pull inward or resist bending:

- The thread only pulls, and the piece settles where the thread is as short as it can be.
- Bending resistance at the holes is weak (the bending length is 0.25 mm at normal tension).
- Contacts only stop beads from overlapping.

So nothing holds a closed shell open. In the real piece, the **core bead** does that job: the beads are pulled tight round it. The source says to add or remove rows to fit the core. The model had no core, so the shell was free to fold in on itself, as long as that didn't cost thread.

The ball's notes already said this: "The real ball is held round by its core bead, which the model doesn't have yet."

## The fix

### 1. A `filled` key in the pattern

`filled: true` (default `false`) says the piece is stuffed or worked around a core bead. It is set once for the whole pattern, next to `thread_diameter`. It is checked to be true or false, and the editor keeps it when it writes the file. Open pieces (cups, bezels, the flat circle) leave it off. It is set on the whale and on the beaded ball.

### 2. Pressure on the enclosed volume

The energy of a filled piece gains a term **−P·V**, where V is the volume inside the piece. More volume lowers the energy, so the piece pushes out until its thread stops it.

**The surface.** V is measured inside triangles through the bead centers (`enclosingFaces`):

- Each round is zipped to the up beads it was worked into. Up bead i sits at position i round the ring. A bead in gap i, slot j of s, sits at i + (j+1)/(s+1). The two rings are then merged in that order, one triangle at a time.
- A flat lid (a fan of triangles) covers the first ring and the last round built so far.

For the ball and the whale (and Moo Deng), every edge is shared by exactly two triangles going opposite ways, and V − E + F = 2: a closed surface. A tube start has no bottom to push on, so it gets no surface.

**The force.** For each triangle (p, q, r), V gains p·(q × r)/6, so ∂V/∂p = (q × r)/6. That force acts at the bead's center, so it moves the bead but doesn't turn it.

### 3. How hard to push

A fixed pressure didn't work. On the whale:

| P (per unit thread tension, 1/mm²) | Result |
|---|---|
| 0 | squashed (mean dent 0.98 mm) |
| 0.03 | round (mean dent 0.16 mm) |
| 0.1 and up | blew up: beads pushed hundreds of mm apart |

This is the Laplace law. The thread pulls back like a skin with pull γ per mm, and a skin of radius R holds at most about 2γ/R. Past that the piece blows up, because the thread pulls with the same force however far it is stretched. γ is about one thread per bead length. So a fixed P that is safe for a small piece of small beads would blow up a big piece or one of big beads.

The pressure is therefore set at the start of each step from the piece and its beads:

```
P = FILL_PRESSURE / (R · L)
```

- **R** is the radius of a sphere with the same area as the surface.
- **L** is the mean bead length.
- **FILL_PRESSURE** has no units, and is 0.3. On its own, this formula blew the whale up from about 0.35.

### 4. A guard against blowing up

0.3 is close to 0.35, so there is also a guard. The pressure eases off over the last tenth, and then stops, once V reaches the volume of a sphere with the surface's area at the start of the step: A^{3/2} / (6√π). That is the most a skin of that area can hold, so any more volume would have to come from stretching the thread. With the guard, 0.6 settles too. At 2 a few threads still pull open, but the piece no longer blows up.

### 5. When to start pushing

This was the hardest part. Three options were tried:

| Pushing from | What happened |
|---|---|
| The first round | The flat start was pushed into a dome through the lid over its rim. 4 threads at the increases (rounds 6–9) pulled open by up to 1.65 mm past their slack, against at most 1.09 mm without filling |
| The first decrease (round 19) | Fine in Node, but not in the browser. The open cup buckled for 8 rounds with nothing pushing on it, and floating-point differences between JavaScript engines picked which way. At round 18 the ripple was 1.0 mm in Node and 5.2 mm in Chrome, and the finished Chrome whale kept up to 3 mm of ripple |
| **The first of the widest rounds (round 10)** | The cup is as wide as it gets, which is about when the core goes in. No thread opens further than without filling, and Node and Chrome agree |

The last one is the fix.

## Results

Whale, whole piece, in Node:

| | Before | After |
|---|---|---|
| Ripple, worst round | 2.6 mm (round 4) | 0.72 mm (round 4); 0.2–0.4 mm in rounds 6–23 |
| Rounds labelled "ruffles" | rounds 2–7 and 17–23 | none. The profile goes flat, cup, wall, curls in |
| Mean / worst dent inside the convex outline | 0.98 / 4.9 mm | 0.19 / 0.81 mm |
| Size | 20.5 × 18.2 × 16.1 mm | 19.4 × 18.7 × 16.1 mm |
| Thread most open past its slack | 1.09 mm | 1.04 mm |
| Solve time | 5.0 s | 5.7 s |

The size is now inside the source's 16–20 mm, and still a little flatter than wide. In Chrome the worst ripple is 0.68 mm.

Beaded ball, in Chrome: worst ripple 0.41 mm. Its two ends still match: rounds 1 and 25 are within 0.3 mm of each other in radius, as before.

The result holds with the random nudge seeded six different ways (mean dent 0.18–0.20 mm every time), and is the same in Node and in Chrome.

## Still open

- **The core itself.** The pressure stands in for a core bead but doesn't know its size. A core bigger or smaller than the shell would change the shape. The honest model would be a sphere of the core's diameter that the beads can't enter, which needs a `core` size in the pattern.
- **The step-up seam** shows as a faint line down one side. It was there before. The step-ups pull each round in a little where they are (see the ball's notes).
- **The pressure strength** (0.3) is a choice inside a safe range (about 0.1 to 0.6), not fitted to a photo. Photos of a finished whale or ball would pin it down.
- **Stuffed pieces with no widest round,** such as a long tube closed at both ends, start pushing at their first round of greatest bead count, which may be early. No such pattern exists yet.

Tests: `test/tension.test.ts` checks that the surface is closed for the ball and the whale, that every round of the whale ripples by less than 1 mm with no thread more than 1.2 mm past its slack, and that `filled` is read, checked and kept by the editor.
