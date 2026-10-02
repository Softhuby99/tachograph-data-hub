// v2.52: operations log ("Betriebsprotokoll").
//
// One entry point, emitEvent(), used by the update monitor, server functions,
// the admin token checks, the fetch proxy and the server entry. Rules:
//  - never throws and never blocks the action that reports (best effort);
//  - no recursion: an error while logging goes to stderr only;
//  - everything is sanitised before it is stored: control characters removed,
//    lengths capped, secrets (admin token, cron secret, DB password, bearer
//    tokens, URL credentials) replaced, sensitive keys in details redacted;
//  - recurring identical problems fold into one open row (dedup_key) until it
//    is acknowledged; auth events are always stored one by one;
//  - when the database is unavailable (or not the local PostgreSQL), the event
//    is written as one JSON line to stderr (supervisor log, rotated).
//
// Reading the log is admin-only — see events.functions.ts.

import { randomUUID, timingSafeEqual } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { APP_VERSION } from "@/lib/version";
import { envFlag } from "@/lib/env-flag";
import { eventsBackendAvailable, eventsQuery } from "@/lib/db.server";

export type EventLevel = "ERROR" | "WARN" | "INFO";
export type EventCategory = "update" | "auth" | "action" | "proxy" | "system" | "log";

export type EventInput = {
  level: EventLevel;
  category: EventCategory;
  /** Stable machine code, e.g. update.source.failed */
  code: string;
  message: string;
  status?: "success" | "partial" | "failed" | "denied" | "info";
  trigger?: "manual" | "cron" | "scheduler" | "system" | "client";
  actor?: string;
  durationMs?: number;
  httpStatus?: number;
  sourceType?: string;
  requestId?: string;
  runId?: string;
  checkRunId?: string | null;
  proposalId?: string | null;
  cardId?: string | null;
  details?: Record<string, unknown>;
  clientIp?: string;
  userAgent?: string;
  /** Fold into the open row with the same key instead of inserting. */
  dedupKey?: string;
};

/** One id per server process start; links all events of one boot. */
export const BOOT_ID = randomUUID();

const MAX_MESSAGE = 500;
const MAX_STRING = 2000;
const MAX_KEYS = 40;
const MAX_DEPTH = 3;
const MAX_STACK_LINES = 15;
const SENSITIVE_KEY =
  /(token|secret|passw|authorization|cookie|session|api[-_]?key|private[-_]?key)/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretsInEnv(): string[] {
  return ["ADMIN_TOKEN", "CRON_SECRET", "DB_PASSWORD"]
    .map((k) => process.env[k] ?? "")
    .filter((v) => v.length >= 4);
}

/** Removes secrets, control characters and caps the length of one string. */
export function cleanText(input: unknown, max = MAX_STRING): string {
  let s = typeof input === "string" ? input : input == null ? "" : String(input);
  for (const secret of secretsInEnv()) s = s.split(secret).join("[redacted]");
  s = s
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:token|secret|key|password|sig)=)[^&\s]+/gi, "$1[redacted]");
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, " ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function oneLine(input: unknown, max = MAX_MESSAGE): string {
  return cleanText(input, max * 2)
    .replace(/\s*\n\s*/g, " ")
    .slice(0, max);
}

/** Plain-JSON copy of details: depth/keys/length capped, sensitive keys redacted. */
export function cleanDetails(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return cleanText(value);
  if (value instanceof Error) return errorDetails(value);
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => cleanDetails(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      const key = oneLine(k, 60);
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : cleanDetails(v, depth + 1);
    }
    return out;
  }
  return cleanText(String(value));
}

/** Error → message, class and a shortened, cleaned stack (admin-only view). */
export function errorDetails(e: unknown): { error: string; errorClass: string; stack?: string } {
  if (e instanceof Error) {
    const stack = (e.stack ?? "")
      .split("\n")
      .slice(1, MAX_STACK_LINES + 1)
      .join("\n");
    return { error: oneLine(e.message), errorClass: e.name, stack: cleanText(stack, 3000) };
  }
  return { error: oneLine(e), errorClass: typeof e };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function uuidOrNull(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

// ------------------------------------------------------------- write path

/**
 * Write budgets per minute. Events that outsiders can trigger (auth, proxy,
 * server errors) have their own budget, so a flood of those can never crowd
 * out update/action errors of the same minute.
 */
const BUDGET_PER_MINUTE = { external: 200, internal: 300 } as const;
type BudgetClass = keyof typeof BUDGET_PER_MINUTE;
let budgetWindow = 0;
const budgetUsed: Record<BudgetClass, number> = { external: 0, internal: 0 };
const budgetDropped: Record<BudgetClass, number> = { external: 0, internal: 0 };

/** Auth rows per IP and 10 minutes; beyond that only the brute-force row grows. */
const AUTH_ROWS_PER_IP = 30;
const BRUTE_FORCE_THRESHOLD = 5;
const AUTH_WINDOW_MIN = 10;

/** Set while an event is being written: a log call from inside the write
 * path (should never happen) goes to stderr instead of recursing. */
const writing = new AsyncLocalStorage<boolean>();

function fallback(entry: Record<string, unknown>, reason: string) {
  try {
    process.stderr.write(
      `${JSON.stringify({ ts: new Date().toISOString(), tdh_event: true, fallback: reason, ...entry })}\n`,
    );
  } catch {
    /* nothing left to do */
  }
}

function budgetClass(row: Row): BudgetClass {
  return row.category === "auth" || row.category === "proxy" || row.code === "system.server.error"
    ? "external"
    : "internal";
}

function takeBudget(cls: BudgetClass): boolean {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== budgetWindow) {
    for (const k of Object.keys(budgetDropped) as BudgetClass[]) {
      if (budgetDropped[k] > 0) {
        fallback(
          { level: "WARN", code: "log.budget.exceeded", class: k, dropped: budgetDropped[k] },
          "budget",
        );
      }
      budgetUsed[k] = 0;
      budgetDropped[k] = 0;
    }
    budgetWindow = minute;
  }
  if (budgetUsed[cls] >= BUDGET_PER_MINUTE[cls]) {
    budgetDropped[cls]++;
    return false;
  }
  budgetUsed[cls]++;
  return true;
}

type Row = Record<string, unknown>;

function toRow(ev: EventInput): Row {
  return {
    level: ev.level,
    category: ev.category,
    code: oneLine(ev.code, 80),
    status: ev.status ?? "",
    message: oneLine(ev.message),
    trigger: ev.trigger ?? "system",
    actor: oneLine(ev.actor ?? "", 60),
    app_version: APP_VERSION,
    duration_ms: intOrNull(ev.durationMs),
    http_status: intOrNull(ev.httpStatus),
    source_type: oneLine(ev.sourceType ?? "", 60),
    request_id: oneLine(ev.requestId ?? "", 80),
    run_id: uuidOrNull(ev.runId),
    boot_id: BOOT_ID,
    check_run_id: uuidOrNull(ev.checkRunId),
    proposal_id: uuidOrNull(ev.proposalId),
    card_id: uuidOrNull(ev.cardId),
    details: (cleanDetails(ev.details ?? {}) ?? {}) as Record<string, unknown>,
    client_ip: oneLine(ev.clientIp ?? "", 64),
    user_agent: oneLine(ev.userAgent ?? "", 300),
    dedup_key: ev.category === "auth" || !ev.dedupKey ? null : oneLine(ev.dedupKey, 300),
  };
}

const INSERT_COLS = [
  "level",
  "category",
  "code",
  "status",
  "message",
  "trigger",
  "actor",
  "app_version",
  "duration_ms",
  "http_status",
  "source_type",
  "request_id",
  "run_id",
  "boot_id",
  "check_run_id",
  "proposal_id",
  "card_id",
  "details",
  "client_ip",
  "user_agent",
  "dedup_key",
] as const;

async function writeRow(row: Row): Promise<string | null> {
  if (row.dedup_key) {
    const folded = await eventsQuery<{ id: string }>(
      `UPDATE public.app_events
          SET repeat_count = repeat_count + 1, last_seen_at = now(), message = $2,
              details = $3::jsonb, duration_ms = $4, http_status = $5, run_id = COALESCE($6, run_id),
              check_run_id = COALESCE($7, check_run_id), app_version = $8, boot_id = $9
        WHERE dedup_key = $1 AND ack_at IS NULL
        RETURNING id`,
      [
        row.dedup_key,
        row.message,
        JSON.stringify(row.details),
        row.duration_ms,
        row.http_status,
        row.run_id,
        row.check_run_id,
        row.app_version,
        row.boot_id,
      ],
    );
    if (folded.length > 0) return folded[0].id;
  }
  const values = INSERT_COLS.map((c) => (c === "details" ? JSON.stringify(row[c]) : row[c]));
  const placeholders = INSERT_COLS.map((c, i) =>
    c === "details" ? `$${i + 1}::jsonb` : `$${i + 1}`,
  );
  const inserted = await eventsQuery<{ id: string }>(
    `INSERT INTO public.app_events (${INSERT_COLS.join(",")}) VALUES (${placeholders.join(",")})
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL AND ack_at IS NULL
     DO UPDATE SET repeat_count = public.app_events.repeat_count + 1, last_seen_at = now()
     RETURNING id`,
    values,
  );
  return inserted[0]?.id ?? null;
}

/** Counts failed admin checks of one IP in the window and raises a brute-force error. */
async function bruteForceCheck(row: Row): Promise<boolean> {
  const ip = String(row.client_ip ?? "");
  if (!ip) return true;
  const [{ n }] = await eventsQuery<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.app_events
      WHERE category = 'auth' AND client_ip = $1 AND level <> 'INFO'
        AND code <> 'auth.bruteforce' AND created_at > now() - ($2 || ' minutes')::interval`,
    [ip, String(AUTH_WINDOW_MIN)],
  );
  if (n + 1 >= BRUTE_FORCE_THRESHOLD) {
    // Not folded by dedup (auth) — fold manually: one open row per IP.
    const open = await eventsQuery<{ id: string }>(
      `UPDATE public.app_events SET repeat_count = repeat_count + 1, last_seen_at = now(),
              message = $2
        WHERE category = 'auth' AND code = 'auth.bruteforce' AND client_ip = $1 AND ack_at IS NULL
        RETURNING id`,
      [ip, `${n + 1} failed admin checks from ${ip} within ${AUTH_WINDOW_MIN} minutes`],
    );
    if (open.length === 0) {
      await writeRow(
        toRow({
          level: "ERROR",
          category: "auth",
          code: "auth.bruteforce",
          status: "denied",
          message: `${n + 1} failed admin checks from ${ip} within ${AUTH_WINDOW_MIN} minutes`,
          clientIp: ip,
          userAgent: String(row.user_agent ?? ""),
          details: { threshold: BRUTE_FORCE_THRESHOLD, windowMinutes: AUTH_WINDOW_MIN },
        }),
      );
    }
  }
  // Store the single attempt only while the IP stays below the row cap.
  return n < AUTH_ROWS_PER_IP;
}

/**
 * Records one event. Never throws. Returns the row id when stored in the DB.
 */
export async function emitEvent(ev: EventInput): Promise<string | null> {
  let row: Row;
  try {
    row = toRow(ev);
  } catch (e) {
    fallback(
      { code: ev?.code, message: String(ev?.message ?? "") },
      `sanitise: ${errorMessage(e)}`,
    );
    return null;
  }
  if (writing.getStore()) {
    fallback(row, "recursion");
    return null;
  }
  if (!eventsBackendAvailable()) {
    fallback(row, "no-local-db");
    return null;
  }
  if (!takeBudget(budgetClass(row))) return null;
  return writing.run(true, async () => {
    try {
      if (row.category === "auth" && row.level !== "INFO") {
        const store = await bruteForceCheck(row);
        if (!store) return null;
      }
      return await writeRow(row);
    } catch (e) {
      fallback(row, `db: ${oneLine(errorMessage(e), 200)}`);
      return null;
    }
  });
}

/** Fire-and-forget variant for code paths that must not await the log. */
export function emitEventLater(ev: EventInput): void {
  void emitEvent(ev);
}

/** Timing-safe check of a candidate against ADMIN_TOKEN (false when unset). */
export function adminTokenMatches(candidate: string): boolean {
  const expected = process.env["ADMIN_TOKEN"] ?? "";
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

let bootLogged = false;
/** Start-up event, once per process. */
export function emitBootOnce(): void {
  if (bootLogged) return;
  bootLogged = true;
  emitEventLater({
    level: "INFO",
    category: "system",
    code: "system.start",
    status: "info",
    message: `Web server started (v${APP_VERSION})`,
    details: {
      node: process.version,
      authMode: process.env["AUTH_MODE"] ?? "",
      adminTokenSet: !!process.env["ADMIN_TOKEN"],
    },
  });
}

// ------------------------------------------------------------- request info

/**
 * Client IP, user agent and a request id of the current request. The container
 * is reached directly (port mapping, no reverse proxy), so X-Forwarded-For is
 * NOT trusted — the socket address is used.
 */
export async function requestContext(): Promise<{
  clientIp: string;
  userAgent: string;
  requestId: string;
  path: string;
}> {
  const requestId = randomUUID();
  try {
    const { getRequest, getRequestIP } = await import("@tanstack/react-start/server");
    const req = getRequest();
    let path = "";
    try {
      path = new URL(req.url).pathname;
    } catch {
      /* ignore */
    }
    return {
      clientIp: getRequestIP() ?? "",
      userAgent: req.headers.get("user-agent") ?? "",
      requestId,
      path,
    };
  } catch {
    return { clientIp: "", userAgent: "", requestId, path: "" };
  }
}

/**
 * Wraps a server-function body: a failure is logged as action.failed with the
 * action name and the given references, then re-thrown unchanged.
 */
export async function logActionFailure<T>(
  action: string,
  refs: { proposalId?: string | null; cardId?: string | null; details?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Response) throw e; // auth / HTTP responses are logged where they arise
    const ctx = await requestContext();
    await emitEvent({
      level: "ERROR",
      category: "action",
      code: "action.failed",
      status: "failed",
      trigger: "manual",
      actor: "local-admin",
      message: `${action} failed: ${errorMessage(e)}`,
      durationMs: Date.now() - started,
      proposalId: refs.proposalId,
      cardId: refs.cardId,
      requestId: ctx.requestId,
      details: { action, ...(refs.details ?? {}), ...errorDetails(e) },
    });
    throw e;
  }
}

// ------------------------------------------------------------- read path (admin only)

export type EventFilter = {
  levels?: string[];
  categories?: string[];
  from?: string;
  to?: string;
  includeAcked?: boolean;
  q?: string;
  runId?: string;
  limit?: number;
  offset?: number;
};

const LEVELS = new Set(["ERROR", "WARN", "INFO"]);
const CATEGORIES = new Set(["update", "auth", "action", "proxy", "system", "log"]);

function whereFor(f: EventFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, value: unknown) => {
    params.push(value);
    parts.push(cond.replace("?", `$${params.length}`));
  };
  const levels = (f.levels ?? []).filter((l) => LEVELS.has(l));
  if (levels.length) add("level = ANY(?::text[])", levels);
  const cats = (f.categories ?? []).filter((c) => CATEGORIES.has(c));
  if (cats.length) add("category = ANY(?::text[])", cats);
  if (f.from && !Number.isNaN(Date.parse(f.from))) add("last_seen_at >= ?::timestamptz", f.from);
  if (f.to && !Number.isNaN(Date.parse(f.to))) add("created_at <= ?::timestamptz", f.to);
  if (!f.includeAcked) parts.push("ack_at IS NULL");
  if (f.runId && UUID_RE.test(f.runId)) add("run_id = ?::uuid", f.runId);
  const q = (f.q ?? "").trim().slice(0, 100);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const i = params.length;
    parts.push(
      `(message ILIKE $${i} OR code ILIKE $${i} OR source_type ILIKE $${i} OR request_id ILIKE $${i} OR CAST(run_id AS text) ILIKE $${i})`,
    );
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EventRow = {
  id: string;
  created_at: string;
  last_seen_at: string;
  repeat_count: number;
  level: EventLevel;
  category: string;
  code: string;
  status: string;
  message: string;
  trigger: string;
  actor: string;
  app_version: string;
  duration_ms: number | null;
  http_status: number | null;
  source_type: string;
  request_id: string;
  run_id: string | null;
  boot_id: string | null;
  check_run_id: string | null;
  proposal_id: string | null;
  card_id: string | null;
  details: { [key: string]: JsonValue };
  client_ip: string;
  user_agent: string;
  ack_at: string | null;
  ack_note: string;
};

export async function listEvents(f: EventFilter): Promise<{ rows: EventRow[]; total: number }> {
  if (!eventsBackendAvailable()) return { rows: [], total: 0 };
  const { sql, params } = whereFor(f);
  const limit = Math.min(Math.max(Number(f.limit) || 100, 1), 500);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const [{ n }] = await eventsQuery<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.app_events ${sql}`,
    params,
  );
  const rows = await eventsQuery<EventRow>(
    `SELECT id, created_at, last_seen_at, repeat_count, level, category, code, status, message,
            trigger, actor, app_version, duration_ms, http_status, source_type, request_id,
            run_id, boot_id, check_run_id, proposal_id, card_id, details, client_ip, user_agent,
            ack_at, ack_note
       FROM public.app_events ${sql}
      ORDER BY last_seen_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { rows, total: n };
}

export async function exportEvents(f: EventFilter): Promise<EventRow[]> {
  const { rows } = await listEvents({ ...f, limit: 500, offset: 0 });
  // Larger exports page through in steps of 500 (max 5000 rows).
  const all = [...rows];
  for (let offset = 500; all.length === offset && offset < 5000; offset += 500) {
    const next = await listEvents({ ...f, limit: 500, offset });
    all.push(...next.rows);
  }
  return all;
}

export async function ackEvents(ids: string[], note: string): Promise<number> {
  if (!eventsBackendAvailable()) return 0;
  const clean = ids.filter((id) => UUID_RE.test(id)).slice(0, 500);
  if (clean.length === 0) return 0;
  const rows = await eventsQuery<{ id: string }>(
    `UPDATE public.app_events SET ack_at = now(), ack_note = $2
      WHERE id = ANY($1::uuid[]) AND ack_at IS NULL AND level <> 'INFO'
      RETURNING id`,
    [clean, oneLine(note, 300)],
  );
  return rows.length;
}

export type SourceHealth = {
  source: string;
  lastStatus: string;
  lastAt: string | null;
  lastMessage: string;
  lastOkAt: string | null;
  lastAutoOkAt: string | null;
};

export async function eventOverview(): Promise<{
  openErrors: number;
  openWarnings: number;
  sources: SourceHealth[];
  schedule: { configured: boolean; note: string };
}> {
  if (!eventsBackendAvailable()) {
    return {
      openErrors: 0,
      openWarnings: 0,
      sources: [],
      schedule: { configured: false, note: "" },
    };
  }
  const counts = await eventsQuery<{ level: string; n: number }>(
    `SELECT level, count(*)::int AS n FROM public.app_events
      WHERE ack_at IS NULL AND level IN ('ERROR','WARN') GROUP BY level`,
  );
  const sources = await eventsQuery<SourceHealth>(
    `SELECT s.source_type AS source,
            l.status AS "lastStatus", l.created_at AS "lastAt", l.message AS "lastMessage",
            (SELECT max(created_at) FROM public.jrc_check_runs r
              WHERE r.source_type = s.source_type AND r.status = 'ok') AS "lastOkAt",
            (SELECT max(created_at) FROM public.jrc_check_runs r
              WHERE r.source_type = s.source_type AND r.status = 'ok'
                AND r.triggered_by IN ('cron','scheduler')) AS "lastAutoOkAt"
       FROM (SELECT DISTINCT source_type FROM public.jrc_check_runs) s
       CROSS JOIN LATERAL (SELECT status, created_at, message FROM public.jrc_check_runs r
                            WHERE r.source_type = s.source_type
                            ORDER BY created_at DESC LIMIT 1) l
      ORDER BY s.source_type`,
  );
  return {
    openErrors: counts.find((c) => c.level === "ERROR")?.n ?? 0,
    openWarnings: counts.find((c) => c.level === "WARN")?.n ?? 0,
    sources: sources.map((s) => ({ ...s, lastMessage: oneLine(s.lastMessage, 200) })),
    schedule: {
      configured: false,
      note: "No automatic schedule set up yet — runs only when started manually or via the cron endpoint.",
    },
  };
}

// ------------------------------------------------------------- admin checks

/**
 * Logs a failed admin check (wrong/missing token) for the current request.
 * Used by the write middleware (auth.ts) and requireAdmin() below.
 */
export async function logAdminDenied(action: string, providedToken: string): Promise<void> {
  const ctx = await requestContext();
  await emitEvent({
    level: "WARN",
    category: "auth",
    code: "auth.denied",
    status: "denied",
    message: `Admin check failed (${providedToken ? "wrong token" : "no token"}) for ${action || ctx.path || "request"}`,
    clientIp: ctx.clientIp,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    httpStatus: 401,
    details: { action, path: ctx.path, reason: providedToken ? "wrong_token" : "no_token" },
  });
}

/**
 * Read access to the operations log: only with a valid admin token in local
 * mode (AUTH_MODE=none + ADMIN_TOKEN). Throws a 401 Response otherwise.
 */
export async function requireAdmin(action: string): Promise<void> {
  let provided = "";
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    provided = getRequest()?.headers?.get("x-admin-token") ?? "";
  } catch {
    provided = "";
  }
  if (envFlag("AUTH_MODE") === "none" && adminTokenMatches(provided)) return;
  await logAdminDenied(action, provided);
  throw new Response("Unauthorized: admin login required", { status: 401 });
}
