// Optional-auth middleware. Branches on AUTH_MODE:
//  - AUTH_MODE=none -> no login (local Docker). Writes require ADMIN_TOKEN;
//    without it the instance is read-only (an unset token must not mean "open").
//  - otherwise     -> delegate to requireSupabaseAuth (Lovable preview/published).
//
// Auth is a UI/login gate only; data access lives in db.server.ts and does not
// depend on a user session. When AUTH_MODE=none the app is readable without
// any backend login; writing needs the admin token (self-contained Docker deployment).
//
// This module is intentionally NOT *.server.* so it can be imported by
// *.functions.ts files that ship a client stub. AUTH_MODE is a deployment-level
// flag (set once per image), not a per-request secret, so reading it at module
// scope is safe: on the client bundle it is undefined -> requireSupabaseAuth,
// on the Docker server it is "none" -> noneAuth.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Timing-safe string comparison without importing node:crypto (client-safe). */
function safeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

const noneAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  // In local mode every write needs ADMIN_TOKEN. Without a configured token the
  // instance stays read-only: an unset token must not mean "anyone may write",
  // because the container is reachable from the whole network it is bound to.
  const adminToken = process.env["ADMIN_TOKEN"] ?? "";
  if (adminToken.length === 0) {
    throw new Response(
      "This instance is read-only: set ADMIN_TOKEN in the container environment " +
        "(e.g. /opt/TDH/.env) and enter the same value under Tools to enable writing.",
      { status: 403 },
    );
  }
  const request = getRequest();
  const provided = request?.headers?.get("x-admin-token") ?? "";
  if (!safeEqualStr(provided, adminToken)) {
    throw new Response("Unauthorized: missing or wrong admin token", { status: 401 });
  }
  return next({
    context: {
      userId: "local-user",
      claims: { sub: "local-user" } as Record<string, unknown>,
    },
  });
});

export const optionalAuth = process.env["AUTH_MODE"] === "none" ? noneAuth : requireSupabaseAuth;
