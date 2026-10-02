import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

// v2.52: operations log — start-up event once per process, and server errors.
type EventsModule = typeof import("./lib/events.server");
let eventsModule: Promise<EventsModule | null> | undefined;
function events(): Promise<EventsModule | null> {
  if (!eventsModule) {
    eventsModule = import("./lib/events.server").catch(() => null);
  }
  return eventsModule;
}
void events().then((m) => m?.emitBootOnce());

// v2.53: daily automatic update run (local PostgreSQL only; no-op otherwise).
void import("./lib/scheduler.server")
  .then((m) => m.startScheduler())
  .catch((e) => console.error("[scheduler] not started", e));

function logServerError(error: unknown, request: Request, swallowed: boolean) {
  void events().then((m) => {
    if (!m) return;
    let path = "";
    try {
      path = new URL(request.url).pathname;
    } catch {
      /* ignore */
    }
    return m.emitEvent({
      level: "ERROR",
      category: "system",
      code: "system.server.error",
      status: "failed",
      httpStatus: 500,
      message: `Unexpected server error on ${path || "request"}: ${m.errorMessage(error)}`,
      details: { path, method: request.method, swallowed, ...m.errorDetails(error) },
      dedupKey: `system.server.error:${path}:${m.errorMessage(error).replace(/\d+/g, "#").slice(0, 120)}`,
    });
  });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(captured);
  logServerError(captured, request, true);
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request);
    } catch (error) {
      console.error(error);
      logServerError(error, request, false);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
