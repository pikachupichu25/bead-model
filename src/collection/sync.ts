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

import { DESIGN_KINDS, type DesignKind, readSavedDesign } from "./designs.js";
import { type OwnedBead, ownedId, readOwnedBead } from "./my-beads.js";

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

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
