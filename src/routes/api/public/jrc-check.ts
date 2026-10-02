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

  // The environment secret decides on its own: when it is configured, a wrong
  // token is rejected right here. Falling through to the database would let any
  // unauthenticated caller force one query per request.
  const envSecret = process.env["CRON_SECRET"];
  if (envSecret && envSecret.length > 0) {
    if (safeEqual(provided, envSecret)) return runCheck();
    await logCronDenied(provided);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // No environment secret configured — fall back to the DB-stored token.
  const { getCronConfig } = await import("@/lib/db.server");
  const config = await getCronConfig();
  const dbToken = config?.token ?? "";
  if (!dbToken) {
    return new Response(JSON.stringify({ error: "No cron secret configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (!dbToken || !safeEqual(provided, dbToken)) {
    await logCronDenied(provided);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return runCheck();
}

/** v2.52: rejected cron calls are logged (auth category, counts toward brute force). */
async function logCronDenied(provided: string) {
  try {
    const m = await import("@/lib/events.server");
    const ctx = await m.requestContext();
    await m.emitEvent({
      level: "WARN",
      category: "auth",
      code: "auth.cron.denied",
      status: "denied",
      trigger: "cron",
      message: `Cron endpoint: ${provided ? "wrong" : "missing"} secret — run refused`,
      clientIp: ctx.clientIp,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      httpStatus: 401,
    });
  } catch {
    /* logging must never change the outcome */
  }
}

async function runCheck() {
  const { runUpdateCheck } = await import("@/lib/jrc.server");
  try {
    const result = await runUpdateCheck("cron");
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    try {
      const m = await import("@/lib/events.server");
      await m.emitEvent({
        level: "ERROR",
        category: "update",
        code: "update.run.failed",
        status: "failed",
        trigger: "cron",
        message: `Scheduled update run aborted: ${m.errorMessage(e)}`,
        details: m.errorDetails(e),
        dedupKey: "update.run.failed:cron",
      });
    } catch {
      /* ignore */
    }
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
