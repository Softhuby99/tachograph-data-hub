import { createFileRoute } from "@tanstack/react-router";

// Scheduled update check. Called by the database cron job (or any external
// scheduler) with a shared secret; never by the browser.
async function handle(request: Request) {
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("token") ??
    "";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: config } = await supabaseAdmin
    .from("cron_config")
    .select("token")
    .maybeSingle();

  const accepted = [process.env["CRON_SECRET"], config?.token].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );

  if (accepted.length === 0) {
    return new Response(JSON.stringify({ error: "No cron secret configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  if (!accepted.includes(provided)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }


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
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
