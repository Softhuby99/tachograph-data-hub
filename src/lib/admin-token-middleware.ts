import { createMiddleware } from "@tanstack/react-start";

/**
 * Sends the admin token with every server-function call once the user has
 * entered one ("Admin sign in"; kept in this browser's localStorage). The
 * server checks it for everything that writes (adminAuth in auth.ts) or is
 * admin-only (requireAdmin); without it those calls answer 401.
 */
export const attachAdminToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const adminToken =
    typeof localStorage !== "undefined" ? localStorage.getItem("admin-token") : null;
  return next({
    headers: adminToken ? { "x-admin-token": adminToken } : {},
  });
});
