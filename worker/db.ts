// Every query on the app's tables. Each one takes the signed-in user's id (from
// the session, never from the request) and only touches that user's rows: D1 has
// no row level security, so this file is where one account is kept from another.

import type { OwnedBead } from "../src/collection/my-beads.js";
import {
  emptyChanges,
  type SyncBead,
  type SyncChanges,
  type SyncDesign,
  type SyncPin,
  type SyncProfile,
  type SyncPull,
  type SyncPushResult,
} from "../src/collection/sync.js";

/** Everything of the user's stored at or after `since` (server time), with the time to pull from next. */
export async function pullChanges(db: D1Database, userId: string, since: number, now = Date.now()): Promise<SyncPull> {
  const [designs, pins, beads, profiles] = await db.batch([
    db.prepare(`select * from designs where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from pins where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from owned_beads where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from profiles where user_id = ? and synced_at >= ?`).bind(userId, since),
  ]);
  const profile = profiles?.results[0] as ProfileRow | undefined;
  return {
    now,
    designs: (designs?.results as DesignRow[]).map(designOf),
    pins: (pins?.results as PinRow[]).map(pinOf),
    beads: (beads?.results as BeadRow[]).map(beadOf),
    ...(profile ? { profile: profileOf(profile) } : {}),
  };
}

/**
 * Stores the changes, each only when it is at least as new as the stored row.
 * Returns the stored copies of the rows that were newer, for the browser to take.
 */
export async function pushChanges(db: D1Database, userId: string, changes: SyncChanges, now = Date.now()): Promise<SyncPushResult> {
  const statements: { kind: "design" | "pin" | "bead" | "profile"; key: string; statement: D1PreparedStatement }[] = [];
  for (const d of changes.designs) {
    statements.push({
      kind: "design",
      key: d.id,
      statement: db
        .prepare(
          `insert into designs (owner_id, id, kind, title, yaml, deleted, created_at, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (owner_id, id) do update set
             kind = excluded.kind, title = excluded.title, yaml = excluded.yaml, deleted = excluded.deleted,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= designs.updated_at`,
        )
        .bind(userId, d.id, d.kind, d.title, d.yaml, d.deleted ? 1 : 0, d.created, d.updated, now),
    });
  }
  for (const p of changes.pins) {
    statements.push({
      kind: "pin",
      key: p.target,
      statement: db
        .prepare(
          `insert into pins (owner_id, target, pinned, pinned_at, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?)
           on conflict (owner_id, target) do update set
             pinned = excluded.pinned, pinned_at = excluded.pinned_at,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= pins.updated_at`,
        )
        .bind(userId, p.target, p.pinned ? 1 : 0, p.pinnedAt, p.updated, now),
    });
  }
  for (const b of changes.beads) {
    const bead = b.bead;
    statements.push({
      kind: "bead",
      key: b.key,
      statement: db
        .prepare(
          `insert into owned_beads (owner_id, bead_key, kind, bead, size, name, rgb, amount, note, deleted, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (owner_id, bead_key) do update set
             kind = coalesce(excluded.kind, owned_beads.kind), bead = coalesce(excluded.bead, owned_beads.bead),
             size = coalesce(excluded.size, owned_beads.size), name = coalesce(excluded.name, owned_beads.name),
             rgb = coalesce(excluded.rgb, owned_beads.rgb), amount = excluded.amount, note = excluded.note,
             deleted = excluded.deleted, updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= owned_beads.updated_at`,
        )
        .bind(
          userId,
          b.key,
          bead?.kind ?? null,
          bead?.kind === "catalog" ? bead.bead : null,
          bead?.kind === "own" ? bead.size : null,
          bead?.kind === "own" ? bead.name : null,
          bead?.kind === "own" ? bead.rgb : null,
          bead?.amount ?? null,
          bead?.note ?? null,
          b.deleted ? 1 : 0,
          b.updated,
          now,
        ),
    });
  }
  if (changes.profile) {
    const p = changes.profile;
    statements.push({
      kind: "profile",
      key: userId,
      statement: db
        .prepare(
          `insert into profiles (user_id, display_name, only_my_beads, updated_at, synced_at)
           values (?, ?, ?, ?, ?)
           on conflict (user_id) do update set
             display_name = excluded.display_name, only_my_beads = excluded.only_my_beads,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= profiles.updated_at`,
        )
        .bind(userId, p.name, p.onlyMyBeads ? 1 : 0, p.updated, now),
    });
  }
  const rejected = emptyChanges();
  if (statements.length === 0) return { now, rejected };

  const results = await db.batch(statements.map((s) => s.statement));
  const kept = statements.filter((_, i) => (results[i]?.meta.changes ?? 0) === 0);
  if (kept.length === 0) return { now, rejected };

  const keys = (kind: string) => kept.filter((s) => s.kind === kind).map((s) => s.key);
  const lookups: D1PreparedStatement[] = [];
  const designKeys = keys("design");
  const pinKeys = keys("pin");
  const beadKeys = keys("bead");
  const order: ("design" | "pin" | "bead" | "profile")[] = [];
  if (designKeys.length) {
    order.push("design");
    lookups.push(db.prepare(`select * from designs where owner_id = ? and id in (${marks(designKeys)})`).bind(userId, ...designKeys));
  }
  if (pinKeys.length) {
    order.push("pin");
    lookups.push(db.prepare(`select * from pins where owner_id = ? and target in (${marks(pinKeys)})`).bind(userId, ...pinKeys));
  }
  if (beadKeys.length) {
    order.push("bead");
    lookups.push(db.prepare(`select * from owned_beads where owner_id = ? and bead_key in (${marks(beadKeys)})`).bind(userId, ...beadKeys));
  }
  if (keys("profile").length) {
    order.push("profile");
    lookups.push(db.prepare(`select * from profiles where user_id = ?`).bind(userId));
  }
  const rows = await db.batch(lookups);
  order.forEach((kind, i) => {
    const found = rows[i]?.results ?? [];
    if (kind === "design") rejected.designs = (found as DesignRow[]).map(designOf);
    if (kind === "pin") rejected.pins = (found as PinRow[]).map(pinOf);
    if (kind === "bead") rejected.beads = (found as BeadRow[]).map(beadOf);
    if (kind === "profile" && found[0]) rejected.profile = profileOf(found[0] as ProfileRow);
  });
  return { now, rejected };
}

/** How many live designs and beads the user has, for the profile. */
export async function countRows(db: D1Database, userId: string): Promise<{ designs: number; beads: number }> {
  const row = await db
    .prepare(
      `select (select count(*) from designs where owner_id = ?1 and deleted = 0) as designs,
              (select count(*) from owned_beads where owner_id = ?1 and deleted = 0) as beads`,
    )
    .bind(userId)
    .first<{ designs: number; beads: number }>();
  return row ?? { designs: 0, beads: 0 };
}

interface DesignRow {
  id: string;
  kind: SyncDesign["kind"];
  title: string;
  yaml: string;
  deleted: number;
  created_at: number;
  updated_at: number;
}

interface PinRow {
  target: string;
  pinned: number;
  pinned_at: number;
  updated_at: number;
}

interface BeadRow {
  bead_key: string;
  kind: "catalog" | "own" | null;
  bead: string | null;
  size: string | null;
  name: string | null;
  rgb: string | null;
  amount: string | null;
  note: string | null;
  deleted: number;
  updated_at: number;
}

interface ProfileRow {
  display_name: string;
  only_my_beads: number;
  updated_at: number;
}

function designOf(r: DesignRow): SyncDesign {
  const design: SyncDesign = { id: r.id, kind: r.kind, title: r.title, yaml: r.yaml, created: r.created_at, updated: r.updated_at };
  return r.deleted ? { ...design, deleted: true } : design;
}

function pinOf(r: PinRow): SyncPin {
  return { target: r.target, pinned: r.pinned === 1, pinnedAt: r.pinned_at, updated: r.updated_at };
}

function beadOf(r: BeadRow): SyncBead {
  const extra = { ...(r.amount ? { amount: r.amount } : {}), ...(r.note ? { note: r.note } : {}) };
  let bead: OwnedBead | undefined;
  if (r.kind === "catalog" && r.bead) bead = { kind: "catalog", bead: r.bead, ...extra };
  if (r.kind === "own" && r.size && r.name && r.rgb) bead = { kind: "own", size: r.size, name: r.name, rgb: r.rgb, ...extra };
  return { key: r.bead_key, ...(bead ? { bead } : {}), updated: r.updated_at, ...(r.deleted ? { deleted: true as const } : {}) };
}

function profileOf(r: ProfileRow): SyncProfile {
  return { name: r.display_name, onlyMyBeads: r.only_my_beads === 1, updated: r.updated_at };
}

function marks(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}
