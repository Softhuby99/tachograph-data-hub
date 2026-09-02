// Optional-auth middleware. Branches on AUTH_MODE:
//  - AUTH_MODE=none -> no login (local Docker). Passes a fixed local user id.
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
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const noneAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  return next({
    context: {
      userId: "local-user",
      claims: { sub: "local-user" } as Record<string, unknown>,
    },
  });
});

export const optionalAuth =
  process.env["AUTH_MODE"] === "none" ? noneAuth : requireSupabaseAuth;
