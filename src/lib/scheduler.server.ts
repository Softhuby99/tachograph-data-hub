// v2.53: daily automatic update run inside the web process.
//
// Agreed 02.10.2026:
//  - daily at a configurable time (default 03:15, Europe/Berlin), switchable
//    on/off under Tools (admin);
//  - all sources, proposals only (nothing is written to cards);
//  - one lease ("run_locks") keeps scheduler, cron endpoint and manual checks
//    from running at the same time;
//  - a missed run (last automatic start > 24 h ago) is caught up 10 minutes
//    after the server starts;
//  - a source error does not stop the other sources, there is no immediate
//    retry; the next attempt is the next daily run;
//  - a run cut short by a restart is marked "interrupted";
//  - after each automatic run: log retention and the data quality summary.
// The external cron endpoint (/api/public/jrc-check) stays and shares the
// same code path and lease.

import { randomUUID } from "crypto";
import { emitEvent, errorDetails, errorMessage, cleanupEvents, BOOT_ID } from "@/lib/events.server";
import {
  acquireUpdateLock,
  currentUpdateLock,
  getSetting,
  putSetting,
  releaseUpdateLock,
  releaseUpdateLocksByPrefix,
  settingsAvailable,
  type LockInfo,
} from "@/lib/settings.server";
import { eventsQuery, insertCheckRun } from "@/lib/db.server";

export const TIMEZONE = "Europe/Berlin";
const DEFAULT_CONFIG: SchedulerConfig = { enabled: true, time: "03:15" };
const AUTO_LOCK_TTL_S = 60 * 60;
const MANUAL_LOCK_TTL_S = 3 * 60;
// Test hook: SCHEDULER_CATCHUP_DELAY_MS shortens the wait (default 10 min).
const CATCH_UP_DELAY_MS = Number(process.env["SCHEDULER_CATCHUP_DELAY_MS"]) || 10 * 60 * 1000;
const MISSED_AFTER_MS = 24 * 60 * 60 * 1000;
/** A slot is skipped when an automatic run already started this recently. */
const RECENT_RUN_MS = 12 * 60 * 60 * 1000;
/** A slot that passed more than this long ago is left to the next day. */
const SLOT_WINDOW_MIN = 120;
const TICK_MS = 30 * 1000;

export type SchedulerConfig = { enabled: boolean; time: string };
export type AutoTrigger = "scheduler" | "cron";

type SchedulerState = {
  lastStartAt?: string;
  lastFinishAt?: string;
  lastRunId?: string;
  lastTrigger?: AutoTrigger;
  lastStatus?: string;
  lastMessage?: string;
  lastSlotDate?: string;
  bootId?: string;
};

export type SchedulerStatus = {
  available: boolean;
  enabled: boolean;
  time: string;
  timezone: string;
  nextRunAt: string | null;
  lastStartAt: string | null;
  lastFinishAt: string | null;
  lastStatus: string | null;
  lastTrigger: string | null;
  lastMessage: string | null;
  running: boolean;
  lock: LockInfo | null;
};

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ------------------------------------------------------------------ time

function berlinParts(d: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function slotMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 3 * 60 + 15;
}

/** Next instant the configured Berlin wall-clock time comes round (DST-safe). */
export function nextRunAt(config: SchedulerConfig, now = new Date()): Date | null {
  if (!config.enabled) return null;
  const slot = slotMinutes(config.time);
  const start = Math.ceil(now.getTime() / 60000) * 60000;
  for (let t = start; t < start + 50 * 3600 * 1000; t += 60000) {
    if (berlinParts(new Date(t)).minutes === slot) return new Date(t);
  }
  return null;
}

// ---------------------------------------------------------- settings/state

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  const v = await getSetting<Partial<SchedulerConfig>>("scheduler", DEFAULT_CONFIG);
  return {
    enabled: v.enabled !== false,
    time: typeof v.time === "string" && TIME_RE.test(v.time) ? v.time : DEFAULT_CONFIG.time,
  };
}

export async function setSchedulerConfig(
  next: SchedulerConfig,
  actor = "local-admin",
): Promise<SchedulerConfig> {
  if (!TIME_RE.test(next.time)) throw new Error("Time must be HH:MM (00:00–23:59)");
  if (!settingsAvailable()) throw new Error("The scheduler needs the local database");
  const before = await getSchedulerConfig();
  const config = { enabled: !!next.enabled, time: next.time };
  await putSetting("scheduler", config);
  if (before.enabled !== config.enabled || before.time !== config.time) {
    await emitEvent({
      level: "INFO",
      category: "scheduler",
      code: "scheduler.config.changed",
      status: "success",
      trigger: "manual",
      actor,
      message:
        `Schedule ${config.enabled ? `on, daily ${config.time} (${TIMEZONE})` : "switched off"}` +
        ` — was ${before.enabled ? `on, ${before.time}` : "off"}`,
      details: { before, after: config },
    });
  }
  return config;
}

async function getState(): Promise<SchedulerState> {
  return await getSetting<SchedulerState>("scheduler_state", {});
}

async function patchState(patch: Partial<SchedulerState>): Promise<void> {
  const state = await getState();
  await putSetting("scheduler_state", { ...state, ...patch });
}

export async function schedulerStatus(): Promise<SchedulerStatus> {
  const available = settingsAvailable();
  const config = available ? await getSchedulerConfig() : { ...DEFAULT_CONFIG, enabled: false };
  const state = available ? await getState() : {};
  const lock = available ? await currentUpdateLock() : null;
  const next = available ? nextRunAt(config) : null;
  return {
    available,
    enabled: config.enabled,
    time: config.time,
    timezone: TIMEZONE,
    nextRunAt: next ? next.toISOString() : null,
    lastStartAt: state.lastStartAt ?? null,
    lastFinishAt: state.lastFinishAt ?? null,
    lastStatus: state.lastStatus ?? null,
    lastTrigger: state.lastTrigger ?? null,
    lastMessage: state.lastMessage ?? null,
    running: !!lock && /^(scheduler|cron):/.test(lock.holder),
    lock,
  };
}

// ------------------------------------------------------------- the runs

function busyMessage(lock: LockInfo): string {
  const who = lock.holder.startsWith("manual")
    ? "A manual check"
    : lock.holder.startsWith("cron")
      ? "A cron-triggered update run"
      : "The scheduled update run";
  const since = lock.acquiredAt
    ? ` (since ${new Date(lock.acquiredAt).toLocaleTimeString("de-DE", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" })})`
    : "";
  return `${who} is in progress${since} — try again in a few minutes.`;
}

export class UpdateBusyError extends Error {
  lock: LockInfo;
  constructor(lock: LockInfo) {
    super(busyMessage(lock));
    this.name = "UpdateBusyError";
    this.lock = lock;
  }
}

/**
 * Manual checks from the Update Monitor run source by source from the
 * browser. Each call renews a short "manual" lease, so the scheduler waits
 * while someone is checking by hand — and a manual check is refused while an
 * automatic run holds the lease.
 */
export async function withManualLease<T>(fn: () => Promise<T>): Promise<T> {
  const busy = await acquireUpdateLock("manual", MANUAL_LOCK_TTL_S);
  if (busy) throw new UpdateBusyError(busy);
  return await fn();
}

/**
 * One automatic run of all sources (scheduler or cron endpoint), followed by
 * log retention and the data quality summary. Throws UpdateBusyError when
 * another run holds the lease.
 */
export async function runAutomaticUpdate(trigger: AutoTrigger): Promise<unknown> {
  const runId = randomUUID();
  const holder = `${trigger}:${runId}`;
  const busy = await acquireUpdateLock(holder, AUTO_LOCK_TTL_S);
  if (busy) throw new UpdateBusyError(busy);
  const startedAt = new Date().toISOString();
  await patchState({
    lastStartAt: startedAt,
    lastRunId: runId,
    lastTrigger: trigger,
    lastStatus: "running",
    lastMessage: "",
    bootId: BOOT_ID,
  });
  try {
    const { runUpdateCheck } = await import("@/lib/jrc.server");
    const result = await runUpdateCheck(trigger, { runId });
    const failed = result.sources.filter((s) => s.error).length;
    await patchState({
      lastFinishAt: new Date().toISOString(),
      lastStatus: result.status,
      lastMessage:
        `${result.sources.length - failed}/${result.sources.length} source(s) ok, ` +
        `${result.created} new proposal(s)`,
    });
    await afterAutomaticRun(trigger, runId);
    return result;
  } catch (e) {
    await patchState({
      lastFinishAt: new Date().toISOString(),
      lastStatus: "failed",
      lastMessage: errorMessage(e).slice(0, 200),
    });
    await emitEvent({
      level: "ERROR",
      category: "update",
      code: "update.run.failed",
      status: "failed",
      trigger,
      runId,
      message: `${trigger === "cron" ? "Cron" : "Scheduled"} update run aborted: ${errorMessage(e)}`,
      details: errorDetails(e),
      dedupKey: `update.run.failed:${trigger}`,
    });
    throw e;
  } finally {
    await releaseUpdateLock(holder).catch(() => undefined);
  }
}

async function afterAutomaticRun(trigger: AutoTrigger, runId: string): Promise<void> {
  try {
    await cleanupEvents();
  } catch (e) {
    await emitEvent({
      level: "WARN",
      category: "log",
      code: "log.cleanup.failed",
      status: "failed",
      trigger,
      runId,
      message: `Log retention failed: ${errorMessage(e)}`,
      details: errorDetails(e),
      dedupKey: "log.cleanup.failed",
    });
  }
  try {
    const { recordQualitySummary } = await import("@/lib/data-quality.server");
    await recordQualitySummary(trigger, runId);
  } catch (e) {
    await emitEvent({
      level: "WARN",
      category: "quality",
      code: "quality.summary.failed",
      status: "failed",
      trigger,
      runId,
      message: `Data quality summary failed: ${errorMessage(e)}`,
      details: errorDetails(e),
      dedupKey: "quality.summary.failed",
    });
  }
}

// ------------------------------------------------------- start-up & timer

/**
 * A run whose start was recorded but never its end was cut short by a
 * restart: log it, mark the sources it never reached, free the lease.
 */
async function markInterruptedRun(): Promise<void> {
  const state = await getState();
  if (!state.lastStartAt || state.lastStatus !== "running") return;
  if (state.lastFinishAt && state.lastFinishAt >= state.lastStartAt) return;
  const { UPDATE_SOURCE_ORDER } = await import("@/lib/jrc.server");
  const { JRC_SOURCES } = await import("@/lib/jrc-sources.server");
  let missing: string[] = [];
  if (state.lastRunId) {
    const done = await eventsQuery<{ source_type: string }>(
      `SELECT DISTINCT source_type FROM public.jrc_check_runs WHERE run_id = $1`,
      [state.lastRunId],
    );
    const doneSet = new Set(done.map((d) => d.source_type));
    missing = UPDATE_SOURCE_ORDER.filter((s) => !doneSet.has(s));
    for (const source of missing) {
      await insertCheckRun({
        source_type: source,
        source_url: (JRC_SOURCES as Record<string, { url: string }>)[source]?.url ?? "",
        rows_parsed: 0,
        proposals_created: 0,
        status: "interrupted",
        message: "Run interrupted by a server restart before this source was checked",
        run_id: state.lastRunId,
        triggered_by: state.lastTrigger ?? "scheduler",
        duration_ms: null,
      }).catch(() => null);
    }
  }
  await releaseUpdateLocksByPrefix(["scheduler:", "cron:"]);
  await patchState({
    lastFinishAt: new Date().toISOString(),
    lastStatus: "interrupted",
    lastMessage: `Interrupted by a restart; ${missing.length} source(s) not checked`,
  });
  await emitEvent({
    level: "WARN",
    category: "update",
    code: "update.run.interrupted",
    status: "failed",
    trigger: state.lastTrigger ?? "scheduler",
    runId: state.lastRunId,
    message:
      `${state.lastTrigger === "cron" ? "Cron" : "Scheduled"} update run started ` +
      `${new Date(state.lastStartAt).toISOString()} was interrupted by a restart` +
      (missing.length ? ` — not checked: ${missing.join(", ")}` : ""),
    details: {
      startedAt: state.lastStartAt,
      missingSources: missing,
      previousBootId: state.bootId,
    },
  });
}

async function startRun(reason: "slot" | "catch-up"): Promise<boolean> {
  try {
    await runAutomaticUpdate("scheduler");
    return true;
  } catch (e) {
    if (e instanceof UpdateBusyError) return false;
    // already logged in runAutomaticUpdate
    void reason;
    return true;
  }
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const config = await getSchedulerConfig();
    if (!config.enabled) return;
    const now = new Date();
    const { date, minutes } = berlinParts(now);
    const slot = slotMinutes(config.time);
    const state = await getState();
    if (state.lastSlotDate === date) return;
    if (minutes < slot || minutes - slot > SLOT_WINDOW_MIN) return;
    if (state.lastStartAt && now.getTime() - Date.parse(state.lastStartAt) < RECENT_RUN_MS) {
      await patchState({ lastSlotDate: date });
      return;
    }
    // Lease busy (manual check / cron)? Leave lastSlotDate unset and retry on
    // the next tick while the slot window is open.
    const lock = await currentUpdateLock();
    if (lock) return;
    await patchState({ lastSlotDate: date });
    await startRun("slot");
  } catch (e) {
    console.error("[scheduler] tick failed", e);
  } finally {
    ticking = false;
  }
}

async function catchUp(): Promise<void> {
  try {
    const config = await getSchedulerConfig();
    if (!config.enabled) return;
    const state = await getState();
    const last = state.lastStartAt ? Date.parse(state.lastStartAt) : NaN;
    if (!Number.isNaN(last) && Date.now() - last <= MISSED_AFTER_MS) return;
    if (!Number.isNaN(last)) {
      const hours = Math.round((Date.now() - last) / 3600000);
      await emitEvent({
        level: "WARN",
        category: "scheduler",
        code: "scheduler.run.missed",
        status: "info",
        trigger: "scheduler",
        message: `Last automatic update run started ${hours} h ago — catching up now`,
        details: { lastStartAt: state.lastStartAt, hours },
      });
    }
    const started = await startRun("catch-up");
    if (!started) {
      // A manual check holds the lease — try once more a little later.
      setTimeout(() => void catchUp(), 5 * 60 * 1000).unref?.();
    }
  } catch (e) {
    console.error("[scheduler] catch-up failed", e);
  }
}

type SchedulerGlobal = { __tdhSchedulerStarted?: boolean };

/** Called once per process from the server entry. No-op without local DB. */
export function startScheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g.__tdhSchedulerStarted || !settingsAvailable()) return;
  if (process.env["SCHEDULER_DISABLED"] === "1") return;
  g.__tdhSchedulerStarted = true;
  void (async () => {
    try {
      await markInterruptedRun();
    } catch (e) {
      console.error("[scheduler] interrupted-run check failed", e);
    }
    setTimeout(() => void catchUp(), CATCH_UP_DELAY_MS).unref?.();
    setInterval(() => void tick(), TICK_MS).unref?.();
  })();
}
