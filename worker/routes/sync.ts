// /api/sync: a browser pulls what changed in the account, and pushes its own changes.

import { Hono } from "hono";
import { readSyncChanges, SyncError } from "../../src/collection/sync.js";
import { pullChanges, pushChanges } from "../db.js";
import type { AppEnv } from "../env.js";

export const sync = new Hono<AppEnv>();

/** GET /api/sync?since=<the `now` of the last pull>: everything changed since (all of it without `since`). */
sync.get("/", async (c) => {
  const since = Number(c.req.query("since") ?? 0);
  return c.json(await pullChanges(c.env.DB, c.var.userId, Number.isFinite(since) && since > 0 ? since : 0));
});

/** POST /api/sync with { designs, pins, beads, profile }: at most SYNC_BATCH rows. */
sync.post("/", async (c) => {
  let changes;
  try {
    changes = readSyncChanges(await c.req.json());
  } catch (err) {
    return c.json({ error: err instanceof SyncError ? err.message : "not JSON" }, 400);
  }
  return c.json(await pushChanges(c.env.DB, c.var.userId, changes));
});
