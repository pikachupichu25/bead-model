# Fix: Room for the Thread in the Hole

**Status: done.** A fix for the thread-tension model ([physics-model-proposal.md](physics-model-proposal.md)), which buckled small center starts that lie flat in real pieces. Doing the fix turned up two more problems, fixed as steps 5 and 6.

## The problem

In a real Moo Deng sample, round 3 (`(2A) x4`, a pair in each gap of a 4-bead start) lies almost flat. The model folds the start ring and round 3 into a saddle instead: heights go up and down by about ±0.9 mm, and the holes tilt about 27° out of the plane.

## Why it happens

Flat is a valid shape in the model: with no random nudge, the piece stays exactly flat. But a saddle uses about 20% less thread, so any nudge tips it over.

The extra thread is in the start ring and its links to round 2. A Delica is wider (1.6 mm) than it is long (1.3 mm), so four of them can't close into a tight flat square: each corner leaves about 2 mm of thread showing. Laid flat, rounds 2–3 also push the ring open. Folding the ring out of the plane closes those gaps.

A real piece doesn't need to fold, because the thread can shift off center inside each hole and turn the corners without tilting the beads. The model gives it too little room to do that:

1. **The clearance formula is too strict.** The room for the thread to move off center was `(hole − passes × thread) / 2`. That treats every thread through a hole as if they lay side by side along one diameter. Start-ring beads get 2–3 passes, so with 0.2 mm thread they had only 0.06–0.16 mm. In a round hole, threads pack round each other, and each can still reach close to the wall.
2. **The hole size is a guess.** The generic 11/0 cylinder had no hole size, so the model used 0.45 × D = 0.72 mm. Miyuki lists 0.8 mm for the Delica 11/0.
3. **The thread diameter is fixed** at 0.2 mm (size D Nymo). FireLine 6 lb is about 0.15 mm and 4 lb about 0.12 mm.

### Evidence

Round 3 of Moo Deng, solved up to its own step, with different room for the thread:

| Room per side | Round 3 |
|---|---|
| 0.16 mm (0.72 hole, 0.2 thread, 2 passes: as before) | saddle, 1.9 mm high, holes tilted 27° |
| 0.20–0.25 mm | partly buckled, 0.7–1.4 mm |
| 0.30 mm or more | flat: 0.06 mm or less, 0° tilt |

With room `(hole − thread) / 2` and the 0.8 mm hole, round 3 is flat with both 0.2 mm and 0.15 mm thread.

### Ruled out

- **The bead counts.** Round 3's growth is 1.10, close to flat, and flat is an equilibrium.
- **The shape of the bead edges.** Square-edged beads (finer contact probes) buckle just as much.
- **Earlier threads pulling forever.** Locking each step's thread at its settled length, as friction would, barely changed the result.

## The fix

1. **Clearance per thread.** Each thread can reach `(hole − thread) / 2` from the hole's center, however many passes go through. Passing through again still stiffens the work, because each pass is one more thread that has to bend at the hole.
2. **Hole sizes for generic beads.** Copy Miyuki's holes into `catalog/beads/generic.yaml` (the generic sizes already copy Miyuki's), still marked `estimate`:

   | Line | 15/0 | 11/0 | 10/0 | 8/0 | 6/0 |
   |---|---|---|---|---|---|
   | cylinder | 0.65 | 0.8 | 1.0 | 1.5 | |
   | round | 0.7 | 0.8 | 0.8 | 1.1 | 1.5 |

3. **Thread diameter per pattern.** An optional `thread_diameter` (mm) next to `step_up`, used by the thread-tension model. It defaults to 0.2. The editor keeps it when it writes the file.
4. **A test** that round 3 of Moo Deng is flat at its own step. The existing tests should all still pass.
5. **The thread inside each hole counts.** With more room in the holes, Moo Deng's wall leaned over: rounds tilted steadily from −54° at the bottom to +39° at the top, and beads turned up to 50° against the bead under them. Each end of a hole picked its own off-center point, so a bead turned against its thread cost nothing. A real thread entering on one side and leaving on the other runs diagonally through the hole, which is longer than the bead. That diagonal is now part of the energy. It didn't stop the lean on its own, but it is correct and makes turning a bead cost thread.
6. **New beads lean to the front.** The leaning wall turned out to be a trap, not the physics: straight cylinders came out of some runs, and they used less thread (about 90 mm beyond slack against 120–140 mm for the leaning ones). Which shape a run fell into depended on the random nudge. When a closed bottom turns up into a wall, each bead had to "choose" up or down by that nudge alone. If one side turned up before the other, the wall rose on a slant and every later round followed it. Now each new bead also starts 0.1 bead diameters toward the front of the fabric (outward × the thread's direction, +z on the start ring), so a whole round leaves the plane the same way, toward the side the beader works from. Settling each step from three nudges and keeping the lowest energy was tried first. It didn't find the straight wall and was five times slower.

## What to watch

The result depends on about 0.1 mm of play in the holes, so the model is sensitive to the real hole and thread sizes. Before fitting anything to the sample, measure:

- the hole of the beads used (a needle or wire gauge works)
- the thread used, from its spec

## Results

All with generic bead sizes (now with holes) and 0.2 mm thread:

| Pattern | Before | After |
|---|---|---|
| Moo Deng, round 3 at its own step | saddle, 1.9 mm high, holes tilted 27° | flat: under 0.03 mm, holes in the plane |
| Moo Deng, whole piece | wall rounds 9–17 straight, bottom lumpy | every round within 2° of one axis; wall waviness under 0.3 mm, 6 mm tall |
| Triangle | warped, 5.7 mm | every round flat (under 11°) |
| Plain tube, horn, bezel | | about the same |
| Flat circle | shallow bowl, rounds 3–4 about 30° | a little deeper in the middle (rounds 3–4 at 35–47°); outer rounds flatter |

Straightness no longer hangs on the random nudge: Moo Deng's wall stays straight with the nudge at 0, 1, 2, 3 and 5 times its size (height 5.7–6.2 mm, waviness under 0.8 mm). Solving takes about as long as before (Moo Deng 2.7 s).

Still open:

- The flat circle's middle. The real piece is flat; see the "dome" discussion in [shape-model.md](shape-model.md#3-comparing-with-the-reference-pieces). It is a tube start, so a loose foundation, which isn't modeled, is still the first suspect.
- Measured hole and thread sizes. The 0.8 mm hole is Miyuki's listed size, and 0.2 mm thread is a default. Real ones may differ, and the shape is sensitive to about 0.1 mm here.

Tests: `test/tension.test.ts` checks that round 3 is flat at its step, that every round of Moo Deng is within 10° of square to the axis, and that `thread_diameter` is read, validated and kept by the editor.
