import { describe, expect, it } from "vitest";
import { emptyMyDesigns, type SavedDesign } from "../src/collection/designs.js";
import { emptyMyBeads } from "../src/collection/my-beads.js";
import {
  applyRemote,
  batches,
  emptyChanges,
  emptyRecord,
  type LocalState,
  localChanges,
  pinTimesOf,
  readSyncChanges,
  recordOf,
  SyncError,
} from "../src/collection/sync.js";

const design = (id: string, updated: number, title = "Heart"): SavedDesign => ({
  id,
  kind: "flat",
  title,
  yaml: `title: ${title}\n`,
  created: 1,
  updated,
});

const state = (patch: Partial<LocalState> = {}): LocalState => ({
  designs: emptyMyDesigns(),
  beads: emptyMyBeads(),
  name: "",
  onlyMyBeads: false,
  ...patch,
});

/** Syncs `local` with nothing new on the server, and returns the record. */
function settle(local: LocalState, since = 10) {
  const changes = localChanges(local, emptyRecord(), 5);
  const times = pinTimesOf(local, emptyRecord(), changes);
  return recordOf(applyRemote(local, emptyChanges(), changes, times).state, since, times);
}

describe("readSyncChanges", () => {
  it("keeps rows it can read and drops the rest", () => {
    const changes = readSyncChanges({
      designs: [design("d1", 2), { id: "d2", updated: 3, deleted: true }, { id: "", kind: "flat", yaml: "", updated: 1 }],
      pins: [{ target: "d1", pinned: true, updated: 2 }, { target: "x" }],
      beads: [{ bead: { kind: "catalog", bead: "miyuki DB-0010" }, updated: 2 }, { key: "own:a:b", deleted: true, updated: 2 }, { bead: {}, updated: 1 }],
      profile: { name: "  Kim  ", updated: 4 },
    });
    expect(changes.designs.map((d) => [d.id, d.deleted ?? false])).toEqual([["d1", false], ["d2", true]]);
    expect(changes.pins).toEqual([{ target: "d1", pinned: true, pinnedAt: 2, updated: 2 }]);
    expect(changes.beads.map((b) => b.key)).toEqual(["catalog:miyuki db-0010", "own:a:b"]);
    expect(changes.profile).toEqual({ name: "Kim", onlyMyBeads: false, updated: 4 });
  });

  it("refuses a push with too many rows", () => {
    expect(() => readSyncChanges({ designs: Array.from({ length: 150 }, (_, i) => design(`d${i}`, 1)) })).toThrow(SyncError);
    expect(() => readSyncChanges("nope")).toThrow(SyncError);
  });
});

describe("localChanges", () => {
  it("is everything when there is no record yet (first sign-in)", () => {
    const local = state({
      designs: { version: 1, designs: [design("d1", 2)], pinned: ["d1", "example:flat:heart-band"] },
      beads: { version: 1, beads: [{ kind: "catalog", bead: "miyuki DB-0010" }] },
      name: "Kim",
    });
    const changes = localChanges(local, emptyRecord(), 100);
    expect(changes.designs.map((d) => d.id)).toEqual(["d1"]);
    // The newest pin (first) gets the later time.
    expect(changes.pins.map((p) => [p.target, p.pinnedAt])).toEqual([["d1", 102], ["example:flat:heart-band", 101]]);
    expect(changes.beads.map((b) => b.key)).toEqual(["catalog:miyuki db-0010"]);
    expect(changes.profile).toEqual({ name: "Kim", onlyMyBeads: false, updated: 100 });
  });

  it("is nothing right after a sync", () => {
    const local = state({ designs: { version: 1, designs: [design("d1", 2)], pinned: ["d1"] }, name: "Kim" });
    expect(localChanges(local, settle(local), 100)).toEqual(emptyChanges());
  });

  it("finds edits, deletions, unpins and bead changes since the record", () => {
    const before = state({
      designs: { version: 1, designs: [design("d1", 2), design("d2", 2)], pinned: ["d1"] },
      beads: { version: 1, beads: [{ kind: "catalog", bead: "miyuki DB-0010" }, { kind: "catalog", bead: "miyuki DB-0035" }] },
    });
    const record = settle(before);
    const after = state({
      designs: { version: 1, designs: [design("d1", 9, "Edited")], pinned: [] },
      beads: { version: 1, beads: [{ kind: "catalog", bead: "miyuki DB-0010", amount: "5 g" }] },
      onlyMyBeads: true,
    });
    const changes = localChanges(after, record, 100);
    expect(changes.designs.map((d) => [d.id, d.title, d.deleted ?? false])).toEqual([["d1", "Edited", false], ["d2", "", true]]);
    expect(changes.pins).toEqual([{ target: "d1", pinned: false, pinnedAt: 5 + 1, updated: 100 }]);
    expect(changes.beads.map((b) => [b.key, b.deleted ?? false])).toEqual([["catalog:miyuki db-0010", false], ["catalog:miyuki db-0035", true]]);
    expect(changes.profile?.onlyMyBeads).toBe(true);
  });
});

describe("applyRemote", () => {
  it("takes the server's rows, unless the change here is newer", () => {
    const local = state({ designs: { version: 1, designs: [design("d1", 50, "Mine, newer"), design("d2", 5, "Mine, older")], pinned: [] } });
    const mine = localChanges(local, emptyRecord(), 60);
    const remote = { ...emptyChanges(), designs: [{ ...design("d1", 40, "Theirs"), yaml: "x" }, { ...design("d2", 30, "Theirs") }, design("d3", 30, "New there")] };
    const { state: merged, local: left } = applyRemote(local, remote, mine, new Map());
    expect(merged.designs.designs.map((d) => [d.id, d.title]).sort()).toEqual([["d1", "Mine, newer"], ["d2", "Theirs"], ["d3", "New there"]]);
    expect(left.designs.map((d) => d.id)).toEqual(["d1"]);
  });

  it("removes what was deleted elsewhere, and orders pins newest first", () => {
    const local = state({ designs: { version: 1, designs: [design("d1", 5)], pinned: ["d1"] } });
    const record = settle(local);
    const remote = {
      ...emptyChanges(),
      designs: [{ id: "d1", kind: "flat" as const, title: "", yaml: "", created: 1, updated: 20, deleted: true as const }],
      pins: [
        { target: "d1", pinned: false, pinnedAt: 6, updated: 20 },
        { target: "example:nora:flower", pinned: true, pinnedAt: 30, updated: 30 },
        { target: "example:flat:heart-band", pinned: true, pinnedAt: 25, updated: 25 },
      ],
    };
    const mine = localChanges(local, record, 21);
    const times = pinTimesOf(local, record, mine);
    const { state: merged } = applyRemote(local, remote, mine, times);
    expect(merged.designs.designs).toEqual([]);
    expect(merged.designs.pinned).toEqual(["example:nora:flower", "example:flat:heart-band"]);
  });

  it("replaces and removes beads, and takes the profile", () => {
    const local = state({ beads: { version: 1, beads: [{ kind: "catalog", bead: "miyuki DB-0010" }, { kind: "catalog", bead: "miyuki DB-0035" }] } });
    const record = settle(local);
    const remote = {
      ...emptyChanges(),
      beads: [
        { key: "catalog:miyuki db-0010", bead: { kind: "catalog" as const, bead: "miyuki DB-0010", note: "for the whale" }, updated: 20 },
        { key: "catalog:miyuki db-0035", updated: 20, deleted: true as const },
      ],
      profile: { name: "Kim", onlyMyBeads: true, updated: 20 },
    };
    const { state: merged } = applyRemote(local, remote, localChanges(local, record, 21), new Map());
    expect(merged.beads.beads).toEqual([{ kind: "catalog", bead: "miyuki DB-0010", note: "for the whale" }]);
    expect([merged.name, merged.onlyMyBeads]).toEqual(["Kim", true]);
  });
});

describe("batches", () => {
  it("splits by row count and by size", () => {
    const many = { ...emptyChanges(), designs: Array.from({ length: 250 }, (_, i) => design(`d${i}`, 1)) };
    expect(batches(many).map((b) => b.designs.length)).toEqual([100, 100, 50]);
    const big = { ...emptyChanges(), designs: [{ ...design("a", 1), yaml: "x".repeat(800) }, { ...design("b", 1), yaml: "x".repeat(800) }] };
    expect(batches(big, 1000).map((b) => b.designs.length)).toEqual([1, 1]);
    expect(batches(emptyChanges())).toEqual([]);
  });
});
