// /api/palettes/public: anyone, signed in or not, reads the palettes people made public.

import { Hono } from "hono";
import { getPublicPalette, listPublicPalettes } from "../db.js";
import type { AppEnv } from "../env.js";

export const palettes = new Hono<AppEnv>();

/** GET /api/palettes/public?q=<words>&cursor=<the `next` of the last page>: public palettes, newest first. */
palettes.get("/public", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 80);
  const cursor = Number(c.req.query("cursor") ?? 0);
  return c.json(await listPublicPalettes(c.env.DB, query, Number.isInteger(cursor) && cursor > 0 ? cursor : 0));
});

/** GET /api/palettes/public/<owner>/<id>: one public palette. Private, deleted and missing all give the same 404. */
palettes.get("/public/:owner/:id", async (c) => {
  const palette = await getPublicPalette(c.env.DB, c.req.param("owner"), c.req.param("id"));
  return palette ? c.json(palette) : c.json({ error: "not found" }, 404);
});
