// Keeping My designs, pins, My beads and the profile in step between a browser
// and the account: the changes each side sends, and how they're read. The browser
// (web/sync.ts) and the Worker (worker/db.ts) both use this, so they check data
// the same way.
//
// Every row carries `updated`, the time it was last changed on the device that
// changed it (ms since 1970). The newer change wins. A deletion is a row too
// (`deleted: true`), so other devices learn about it instead of bringing it back.
// Pulls ask for what changed on the server since the server's own time `now`
// from the previous pull, so devices with wrong clocks don't miss changes.

import { DESIGN_KINDS, type DesignKind, findDesign, type MyDesigns, putDesign, readSavedDesign } from "./designs.js";
import { addOwned, type MyBeads, type OwnedBead, ownedId, readOwnedBead, removeOwned } from "./my-beads.js";

export interface SyncDesign {
  id: string;
  kind: DesignKind;
  title: string;
  /** Empty for a deleted design. */
  yaml: string;
  created: number;
  updated: number;
  deleted?: true;
}

/** A pin (design id or "example:<kind>:<name>"), or an unpin (`pinned: false`). */
export interface SyncPin {
  target: string;
  pinned: boolean;
  /** When it was pinned: the newest pin comes first. */
  pinnedAt: number;
  updated: number;
}

/** An owned bead, keyed by `ownedId`. A deleted bead may leave out `bead`. */
export interface SyncBead {
  key: string;
  bead?: OwnedBead;
  updated: number;
  deleted?: true;
}

export interface SyncProfile {
  name: string;
  onlyMyBeads: boolean;
  updated: number;
}

export interface SyncChanges {
  designs: SyncDesign[];
  pins: SyncPin[];
  beads: SyncBead[];
  profile?: SyncProfile;
}

/** What a pull returns: the changes, and the server time to pull from next. */
export interface SyncPull extends SyncChanges {
  now: number;
}

/** What a push returns: the server's copies of rows it kept because they were newer. */
export interface SyncPushResult {
  now: number;
  rejected: SyncChanges;
}

/** At most this many rows in one push. The browser sends more in several pushes. */
export const SYNC_BATCH = 100;

export const MAX_ID = 64;
export const MAX_TARGET = 200;
export const MAX_NAME = 80;

export class SyncError extends Error {}

export function emptyChanges(): SyncChanges {
  return { designs: [], pins: [], beads: [] };
}

export function changeCount(changes: SyncChanges): number {
  return changes.designs.length + changes.pins.length + changes.beads.length + (changes.profile ? 1 : 0);
}

/** Reads a push. Rows it can't read are dropped; too many rows is an error. */
export function readSyncChanges(raw: unknown): SyncChanges {
  if (!isRecord(raw)) throw new SyncError("not a list of changes");
  const out = emptyChanges();
  for (const d of list(raw.designs)) {
    const design = readSyncDesign(d);
    if (design) out.designs.push(design);
  }
  for (const p of list(raw.pins)) {
    const pin = readSyncPin(p);
    if (pin) out.pins.push(pin);
  }
  for (const b of list(raw.beads)) {
    const bead = readSyncBead(b);
    if (bead) out.beads.push(bead);
  }
  const profile = readSyncProfile(raw.profile);
  if (profile) out.profile = profile;
  if (changeCount(out) > SYNC_BATCH + 1) throw new SyncError(`too many changes at once (at most ${SYNC_BATCH})`);
  return out;
}

export function readSyncDesign(raw: unknown): SyncDesign | undefined {
  if (!isRecord(raw) || !isTime(raw.updated)) return undefined;
  if (typeof raw.id !== "string" || !raw.id || raw.id.length > MAX_ID) return undefined;
  if (raw.deleted === true) {
    const kind = (DESIGN_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as DesignKind) : "peyote";
    return { id: raw.id, kind, title: "", yaml: "", created: isTime(raw.created) ? raw.created : raw.updated, updated: raw.updated, deleted: true };
  }
  const design = readSavedDesign(raw);
  if (!design || design.title.length > 200 || design.yaml.length > 1_000_000) return undefined;
  return { ...design, updated: raw.updated };
}

export function readSyncPin(raw: unknown): SyncPin | undefined {
  if (!isRecord(raw) || !isTime(raw.updated) || typeof raw.pinned !== "boolean") return undefined;
  if (typeof raw.target !== "string" || !raw.target || raw.target.length > MAX_TARGET) return undefined;
  return { target: raw.target, pinned: raw.pinned, pinnedAt: isTime(raw.pinnedAt) ? raw.pinnedAt : raw.updated, updated: raw.updated };
}

export function readSyncBead(raw: unknown): SyncBead | undefined {
  if (!isRecord(raw) || !isTime(raw.updated)) return undefined;
  const bead = readOwnedBead(raw.bead);
  if (bead && (bead.amount?.length ?? 0) <= 100 && (bead.note?.length ?? 0) <= 500) {
    const key = ownedId(bead);
    return raw.deleted === true ? { key, bead, updated: raw.updated, deleted: true } : { key, bead, updated: raw.updated };
  }
  if (raw.deleted === true && typeof raw.key === "string" && raw.key && raw.key.length <= MAX_TARGET) {
    return { key: raw.key, updated: raw.updated, deleted: true };
  }
  return undefined;
}

export function readSyncProfile(raw: unknown): SyncProfile | undefined {
  if (!isRecord(raw) || !isTime(raw.updated)) return undefined;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "";
  return { name, onlyMyBeads: raw.onlyMyBeads === true, updated: raw.updated };
}

// ---- The browser's side: what changed locally, and taking in the server's rows ----

/** Everything a browser keeps that follows the account. */
export interface LocalState {
  designs: MyDesigns;
  beads: MyBeads;
  name: string;
  onlyMyBeads: boolean;
}

/**
 * What the account held after the last sync, as this browser saw it. Comparing
 * localStorage with it tells what changed here since; `since` is the server time
 * to pull from next.
 */
export interface SyncRecord {
  since: number;
  /** Design id → its `updated`. */
  designs: Record<string, number>;
  /** Pinned target → when it was pinned. */
  pins: Record<string, number>;
  /** Bead key → the bead, as JSON. */
  beads: Record<string, string>;
  profile?: { name: string; onlyMyBeads: boolean };
}

export function emptyRecord(): SyncRecord {
  return { since: 0, designs: {}, pins: {}, beads: {} };
}

export function readSyncRecord(text: string | null | undefined): SyncRecord | undefined {
  if (!text) return undefined;
  try {
    const raw = JSON.parse(text) as unknown;
    if (!isRecord(raw) || !isTime(raw.since) || !isRecord(raw.designs) || !isRecord(raw.pins) || !isRecord(raw.beads)) return undefined;
    return raw as unknown as SyncRecord;
  } catch {
    return undefined;
  }
}

/** The changes made here since the record: new and changed rows, and deletions (dated `now`). */
export function localChanges(state: LocalState, record: SyncRecord, now: number): SyncChanges {
  const out = emptyChanges();
  for (const d of state.designs.designs) {
    if (record.designs[d.id] !== d.updated) out.designs.push({ ...d });
  }
  const live = new Set(state.designs.designs.map((d) => d.id));
  for (const id of Object.keys(record.designs)) {
    if (!live.has(id)) out.designs.push({ id, kind: "peyote", title: "", yaml: "", created: now, updated: now, deleted: true });
  }
  // Pins: the newest pin is first in the list, so new pins get times in that order.
  const pinned = state.designs.pinned;
  pinned.forEach((target, i) => {
    if (!(target in record.pins)) out.pins.push({ target, pinned: true, pinnedAt: now + (pinned.length - i), updated: now });
  });
  for (const target of Object.keys(record.pins)) {
    if (!pinned.includes(target)) out.pins.push({ target, pinned: false, pinnedAt: record.pins[target]!, updated: now });
  }
  const beadKeys = new Set<string>();
  for (const bead of state.beads.beads) {
    const key = ownedId(bead);
    beadKeys.add(key);
    if (record.beads[key] !== JSON.stringify(bead)) out.beads.push({ key, bead, updated: now });
  }
  for (const key of Object.keys(record.beads)) {
    if (!beadKeys.has(key)) out.beads.push({ key, updated: now, deleted: true });
  }
  const profile = { name: state.name, onlyMyBeads: state.onlyMyBeads };
  if (!record.profile ? state.name !== "" || state.onlyMyBeads : record.profile.name !== profile.name || record.profile.onlyMyBeads !== profile.onlyMyBeads) {
    out.profile = { ...profile, updated: now };
  }
  return out;
}

/**
 * Takes in rows from the server. A row replaces the local one unless `local`
 * (this browser's unsent changes) has a newer change to it; those stay in the
 * returned `local`, still to push. `pinTimes` gets each pin's time.
 */
export function applyRemote(
  state: LocalState,
  remote: SyncChanges,
  local: SyncChanges,
  pinTimes: Map<string, number>,
): { state: LocalState; local: SyncChanges } {
  let designs = state.designs;
  let beads = state.beads;
  let { name, onlyMyBeads } = state;
  const left = { ...local, designs: [...local.designs], pins: [...local.pins], beads: [...local.beads] };
  const wins = <T extends { updated: number }>(rows: T[], match: (row: T) => boolean, theirs: number): boolean => {
    const i = rows.findIndex(match);
    if (i >= 0 && rows[i]!.updated > theirs) return false;
    if (i >= 0) rows.splice(i, 1);
    return true;
  };
  for (const r of remote.designs) {
    if (!wins(left.designs, (d) => d.id === r.id, r.updated)) continue;
    if (r.deleted) {
      if (findDesign(designs, r.id)) designs = { ...designs, designs: designs.designs.filter((d) => d.id !== r.id) };
    } else {
      designs = putDesign(designs, { id: r.id, kind: r.kind, title: r.title, yaml: r.yaml, created: r.created, updated: r.updated });
    }
  }
  for (const r of remote.pins) {
    if (!wins(left.pins, (p) => p.target === r.target, r.updated)) continue;
    if (r.pinned) pinTimes.set(r.target, r.pinnedAt);
    else pinTimes.delete(r.target);
  }
  for (const r of remote.beads) {
    if (!wins(left.beads, (b) => b.key === r.key, r.updated)) continue;
    beads = removeOwned(beads, r.key);
    if (!r.deleted && r.bead) beads = addOwned(beads, r.bead);
  }
  if (remote.profile && !(left.profile && left.profile.updated > remote.profile.updated)) {
    delete left.profile;
    ({ name, onlyMyBeads } = remote.profile);
  }
  // Unsent pins and unpins still count here; then the newest pin first.
  for (const p of left.pins) {
    if (p.pinned) pinTimes.set(p.target, p.pinnedAt);
    else pinTimes.delete(p.target);
  }
  const pinned = [...pinTimes.entries()].sort((a, b) => b[1] - a[1]).map(([target]) => target);
  return { state: { designs: { ...designs, pinned }, beads, name, onlyMyBeads }, local: left };
}

/** The pin times this browser knows: from the record, then for pins made since. */
export function pinTimesOf(state: LocalState, record: SyncRecord, local: SyncChanges): Map<string, number> {
  const times = new Map<string, number>();
  for (const target of state.designs.pinned) {
    const time = record.pins[target] ?? local.pins.find((p) => p.target === target)?.pinnedAt;
    if (time !== undefined) times.set(target, time);
  }
  return times;
}

/** The record of a state the account now holds too. */
export function recordOf(state: LocalState, since: number, pinTimes: Map<string, number>): SyncRecord {
  return {
    since,
    designs: Object.fromEntries(state.designs.designs.map((d) => [d.id, d.updated])),
    pins: Object.fromEntries(state.designs.pinned.map((t) => [t, pinTimes.get(t) ?? 0])),
    beads: Object.fromEntries(state.beads.beads.map((b) => [ownedId(b), JSON.stringify(b)])),
    profile: { name: state.name, onlyMyBeads: state.onlyMyBeads },
  };
}

/** Splits changes into pushes of at most SYNC_BATCH rows and about `maxBytes` of design files each. */
export function batches(changes: SyncChanges, maxBytes = 1_000_000): SyncChanges[] {
  const out: SyncChanges[] = [];
  let current = emptyChanges();
  let rows = 0;
  let bytes = 0;
  const next = () => {
    if (changeCount(current) > 0) out.push(current);
    current = emptyChanges();
    rows = 0;
    bytes = 0;
  };
  for (const d of changes.designs) {
    if (rows + 1 > SYNC_BATCH || (rows > 0 && bytes + d.yaml.length > maxBytes)) next();
    current.designs.push(d);
    rows++;
    bytes += d.yaml.length;
  }
  for (const p of changes.pins) {
    if (rows + 1 > SYNC_BATCH) next();
    current.pins.push(p);
    rows++;
  }
  for (const b of changes.beads) {
    if (rows + 1 > SYNC_BATCH) next();
    current.beads.push(b);
    rows++;
  }
  if (changes.profile) current.profile = changes.profile;
  next();
  return out;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
