// Optional-auth middleware. Branches on AUTH_MODE:
//  - AUTH_MODE=none -> no login (local Docker). Passes a fixed local user id.
//    When ADMIN_TOKEN is set, writes require it via the x-admin-token header.
//  - otherwise     -> delegate to requireSupabaseAuth (Lovable preview/published).
//
// Auth is a UI/login gate only; data access lives in db.server.ts and does not
// depend on a user session. When AUTH_MODE=none the app is fully usable without
// any backend login, as requested for the self-contained Docker deployment.
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
  // In local mode, writes require ADMIN_TOKEN when it is configured.
  const adminToken = process.env["ADMIN_TOKEN"];
  if (adminToken && adminToken.length > 0) {
    const request = getRequest();
    const provided = request?.headers?.get("x-admin-token") ?? "";
    if (!safeEqualStr(provided, adminToken)) {
      throw new Response("Unauthorized", { status: 401 });
    }
  }
  return next({
    context: {
      userId: "local-user",
      claims: { sub: "local-user" } as Record<string, unknown>,
    },
  });
});

export const optionalAuth = process.env["AUTH_MODE"] === "none" ? noneAuth : requireSupabaseAuth;
