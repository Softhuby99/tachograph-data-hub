import { createFileRoute } from "@tanstack/react-router";

// Read-only proxy for the offline app's update check when it runs in a
// browser (the Electron app fetches directly via its main process).
// Strictly allowlisted to the JRC tachograph pages to prevent open-proxy abuse.
const ALLOWED_HOSTS = new Set(["dtc.jrc.ec.europa.eu", "ted.europa.eu", "api.ted.europa.eu"]);

export const Route = createFileRoute("/api/public/fetch")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url).searchParams.get("url");
        if (!url) return new Response("Missing url parameter", { status: 400 });

        let target: URL;
        try {
          target = new URL(url);
        } catch {
          return new Response("Invalid url", { status: 400 });
        }
        if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
          return new Response("Host not allowed", { status: 403 });
        }

        const res = await fetch(target.toString(), {
          headers: { "user-agent": "TachographCardsInfoTool/1.0" },
        });
        if (!res.ok) {
          return new Response(`Upstream request failed [${res.status}]`, { status: 502 });
        }
        return new Response(await res.text(), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
