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

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (default)
const TIMEOUT_MS = 15_000;

// The Common Criteria portal ships its whole product list inside one HTML page
// (~20 MB, ~20 s), so it needs far higher limits than the small JRC tables.
const LARGE_HOSTS = new Set(["www.commoncriteriaportal.org"]);
const LARGE_MAX_BYTES = 40 * 1024 * 1024; // 40 MB
const LARGE_TIMEOUT_MS = 90_000;
const maxBytesFor = (h: string) => (LARGE_HOSTS.has(h) ? LARGE_MAX_BYTES : MAX_BYTES);
const timeoutFor = (h: string) => (LARGE_HOSTS.has(h) ? LARGE_TIMEOUT_MS : TIMEOUT_MS);

type PortalProduct = {
  name?: string;
  pps?: string;
  category_name?: string;
};

type PortalPp = { ID?: string; Name?: string };

/** Read one JSON array embedded as `var <name> = [...]` in the portal page. */
function extractPortalArray<T>(html: string, variable: string): T[] {
  const marker = `var ${variable} = [`;
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const from = start + marker.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(from, i + 1)) as T[];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/**
 * The archive page is about 18 MB. Returning it through the public endpoint can
 * exceed an intermediary response limit even though the upstream fetch itself
 * succeeds. Keep only tachograph products plus the PP lookup used by the
 * offline parser; the resulting response is normally only a few kilobytes.
 */
function compactCommonCriteriaPage(html: string): string {
  const products = extractPortalArray<PortalProduct>(html, "productList");
  const pps = extractPortalArray<PortalPp>(html, "ppsList");
  if (products.length === 0 || pps.length === 0) {
    throw new Error("Common Criteria product data was not found");
  }
  const ppNames = new Map(pps.map((pp) => [String(pp.ID ?? ""), String(pp.Name ?? "")]));
  const tachographProducts = products.filter((product) => {
    const profiles = String(product.pps ?? "")
      .split(",")
      .map((id) => ppNames.get(id.trim()) ?? "")
      .join(" ");
    return /tachograph/i.test(`${product.name ?? ""} ${profiles} ${product.category_name ?? ""}`);
  });
  const usedPpIds = new Set(
    tachographProducts.flatMap((product) =>
      String(product.pps ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
  const tachographPps = pps.filter((pp) => usedPpIds.has(String(pp.ID ?? "")));
  return `var productList = ${JSON.stringify(tachographProducts)};\nvar ppsList = ${JSON.stringify(tachographPps)};`;
}

/** Fetch with manual redirect following — each hop must stay in the allowlist. */
async function fetchFollowRedirects(url: URL, maxHops = 5): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutFor(current.hostname));
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
          const limit = maxBytesFor(target.hostname);
          let total = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limit) {
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
          const responseBody =
            target.hostname === "www.commoncriteriaportal.org" &&
            target.pathname === "/products/index.cfm"
              ? compactCommonCriteriaPage(new TextDecoder().decode(body))
              : body;
          return new Response(responseBody, {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "cache-control": "public, max-age=3600",
            },
          });
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            return new Response("Request timed out", { status: 504 });
          }
          return new Response(`Upstream error: ${e instanceof Error ? e.message : String(e)}`, {
            status: 502,
          });
        }
      },
    },
  },
});
