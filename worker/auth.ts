// Sign-in with Better Auth, kept in D1. Made per request, since the D1 binding
// only exists inside a request. Google sign-in is on when its keys are set.

import { betterAuth } from "better-auth";
import type { Env } from "./env.js";

export type Provider = "google";

export function enabledProviders(env: Env): Provider[] {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ["google"] : [];
}

export function makeAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    emailAndPassword: { enabled: env.ALLOW_PASSWORD === "1" },
    session: {
      // Keep the session in a signed cookie for 5 minutes, so most requests don't read D1.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Better Auth's own rate limit is kept in memory, which a Worker loses between requests. Off for now.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof makeAuth>;
