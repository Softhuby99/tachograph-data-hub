import { createMiddleware } from "@tanstack/react-start";

/**
 * Attaches the Supabase bearer token to server-fn RPCs when Supabase auth is
 * configured. When AUTH_MODE=none (local Docker deployment without a backend),
 * Supabase env vars are absent, so this middleware is a no-op — the
 * `optionalAuth` server middleware accepts the anonymous local identity.
 */
export const attachBearer = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!url) {
      // No Supabase backend configured — nothing to attach.
      return next();
    }
    // Lazy-load the Supabase client only when configured, so a build without
    // Supabase env never touches the (throwing) generated client.
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
