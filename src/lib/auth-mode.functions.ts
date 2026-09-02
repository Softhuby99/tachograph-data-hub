import { createServerFn } from "@tanstack/react-start";

// Public (no auth) function the client uses to decide whether to render the
// Sign in / Sign out controls. AUTH_MODE=none -> login disabled (local Docker).
export const getAuthMode = createServerFn({ method: "GET" }).handler(async () => {
  return { enabled: process.env["AUTH_MODE"] !== "none" };
});
