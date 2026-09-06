import { createServerFn } from "@tanstack/react-start";

// Public (no auth) function the client uses to decide whether to render the
// Sign in / Sign out controls and the admin-token login.
// AUTH_MODE=none -> Supabase login disabled (local Docker).
// ADMIN_TOKEN set + AUTH_MODE=none -> local admin login required for writes.
export const getAuthMode = createServerFn({ method: "GET" }).handler(async () => {
  const localMode = process.env["AUTH_MODE"] === "none";
  return {
    enabled: !localMode,
    adminRequired: localMode && !!process.env["ADMIN_TOKEN"],
  };
});
