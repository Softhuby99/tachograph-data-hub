import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Scheduled update check. Called by the database cron job (or any external
// scheduler) with a shared secret; never by the browser.
// Security: POST-only, header-only (no query param), env secret checked before
// any DB access, timing-safe comparison.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function handle(request: Request) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", allow: "POST" },
    });
  }

  // Token from headers only — never from URL query params.
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  // Check env secret first (avoids DB hit when it matches).
  const envSecret = process.env["CRON_SECRET"];
  if (envSecret && envSecret.length > 0 && safeEqual(provided, envSecret)) {
    return runCheck();
  }

  // Fall back to DB-stored token.
  const { getCronConfig } = await import("@/lib/db.server");
  const config = await getCronConfig();
  const dbToken = config?.token ?? "";
  if (!envSecret && !dbToken) {
    return new Response(JSON.stringify({ error: "No cron secret configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (!dbToken || !safeEqual(provided, dbToken)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return runCheck();
}

async function runCheck() {
  const { runUpdateCheck } = await import("@/lib/jrc.server");
  try {
    const result = await runUpdateCheck();
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/jrc-check")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
