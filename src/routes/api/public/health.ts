import { createFileRoute } from "@tanstack/react-router";
import { APP_VERSION } from "@/lib/version";

// v2.53: liveness check without database access. The container's warm-up
// call (docker/warmup.mjs) hits it right after start, which loads the server
// entry and with it the daily scheduler — otherwise the scheduler would only
// start with the first page view after a restart.
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ ok: true, version: APP_VERSION }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        }),
    },
  },
});
