import { createFileRoute } from "@tanstack/react-router";

// Read-only proxy for the offline app's update check when it runs in a
// browser (the Electron app fetches directly via its main process).
// Strictly allowlisted to the JRC tachograph pages to prevent open-proxy abuse.

const ALLOWED_HOSTS = new Set([
  "dtc.jrc.ec.europa.eu",
  "ted.europa.eu",
  "api.ted.europa.eu",
  "www.commoncriteriaportal.org",
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const TIMEOUT_MS = 15_000;

/** Fetch with manual redirect following — each hop must stay in the allowlist. */
async function fetchFollowRedirects(url: URL, maxHops = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current.toString(), {
        headers: { "user-agent": "TachographCardsInfoTool/1.0" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return res;
        const next = new URL(loc, current);
        if (next.protocol !== "https:" || !ALLOWED_HOSTS.has(next.hostname)) {
          return new Response("Redirect target not allowed", { status: 502 });
        }
        current = next;
        continue;
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
  return new Response("Too many redirects", { status: 502 });
}

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

        try {
          const res = await fetchFollowRedirects(target);
          if (!res.ok) {
            return new Response(`Upstream request failed [${res.status}]`, { status: 502 });
          }

          // Size-limited read (stream up to MAX_BYTES, reject if larger).
          const reader = res.body?.getReader();
          if (!reader) return new Response("No body", { status: 502 });
          const chunks: Uint8Array[] = [];
          let total = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BYTES) {
              return new Response("Response too large", { status: 502 });
            }
            chunks.push(value);
          }
          const body = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
          let offset = 0;
          for (const c of chunks) {
            body.set(c, offset);
            offset += c.length;
          }
          return new Response(body, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=3600",
            },
          });
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            return new Response("Request timed out", { status: 504 });
          }
          return new Response(
            `Upstream error: ${e instanceof Error ? e.message : String(e)}`,
            { status: 502 },
          );
        }
      },
    },
  },
});
