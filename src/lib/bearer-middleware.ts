import { createMiddleware } from "@tanstack/react-start";

/**
 * Attaches auth tokens to server-fn RPCs.
 * - Supabase mode: attaches the Supabase bearer token.
 * - Local Docker mode (no VITE_SUPABASE_URL): attaches the admin token from
 *   localStorage when present, so writes pass the ADMIN_TOKEN check in noneAuth.
 */
export const attachBearer = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) {
    // Local Docker mode — attach admin token from localStorage if the user
    // entered one. Without it, writes will be rejected with 401.
    const adminToken =
      typeof localStorage !== "undefined" ? localStorage.getItem("admin-token") : null;
    return next({
      headers: adminToken ? { "x-admin-token": adminToken } : {},
    });
  }
  // Supabase mode — attach the session bearer.
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
