import { createServerFn } from "@tanstack/react-start";

// Public (no auth): tells the client whether an admin token is configured, i.e.
// whether to offer "Admin sign in". Editing, update checks and the Tools menu
// need that login; without a configured token the server refuses every write.
export const getAuthMode = createServerFn({ method: "GET" }).handler(async () => ({
  adminRequired: !!process.env["ADMIN_TOKEN"],
}));
