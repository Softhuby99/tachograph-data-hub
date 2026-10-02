// v2.53: app_settings (key → JSON) and run_locks (update-run lease).
// Local PostgreSQL only; on the hosted backend both degrade to defaults /
// "no lock" so the app keeps working there without the scheduler.

import { eventsBackendAvailable, eventsQuery } from "@/lib/db.server";

export function settingsAvailable(): boolean {
  return eventsBackendAvailable();
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!settingsAvailable()) return fallback;
  try {
    const rows = await eventsQuery<{ value: T }>(
      `SELECT value FROM public.app_settings WHERE key = $1`,
      [key],
    );
    return rows.length ? (rows[0]!.value as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  if (!settingsAvailable()) return;
  await eventsQuery(
    `INSERT INTO public.app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export type LockInfo = { holder: string; acquiredAt: string; expiresAt: string };

const LOCK = "update";

/**
 * Takes the update lease for `holder`, or renews it when the holder already
 * has it. Returns null on success, or the current foreign lease.
 */
export async function acquireUpdateLock(
  holder: string,
  ttlSeconds: number,
): Promise<LockInfo | null> {
  if (!settingsAvailable()) return null;
  const got = await eventsQuery<{ holder: string }>(
    `INSERT INTO public.run_locks (name, holder, acquired_at, expires_at)
     VALUES ($1, $2, now(), now() + make_interval(secs => $3))
     ON CONFLICT (name) DO UPDATE
        SET holder = EXCLUDED.holder,
            acquired_at = CASE WHEN run_locks.holder = EXCLUDED.holder AND run_locks.expires_at >= now()
                               THEN run_locks.acquired_at ELSE now() END,
            expires_at = EXCLUDED.expires_at
      WHERE run_locks.expires_at < now() OR run_locks.holder = EXCLUDED.holder
     RETURNING holder`,
    [LOCK, holder, ttlSeconds],
  );
  if (got.length > 0) return null;
  return (await currentUpdateLock()) ?? { holder: "unknown", acquiredAt: "", expiresAt: "" };
}

export async function releaseUpdateLock(holder: string): Promise<void> {
  if (!settingsAvailable()) return;
  await eventsQuery(`DELETE FROM public.run_locks WHERE name = $1 AND holder = $2`, [LOCK, holder]);
}

/** Releases any lease whose holder starts with one of the prefixes (start-up clean-up). */
export async function releaseUpdateLocksByPrefix(prefixes: string[]): Promise<number> {
  if (!settingsAvailable() || prefixes.length === 0) return 0;
  const rows = await eventsQuery<{ holder: string }>(
    `DELETE FROM public.run_locks
      WHERE name = $1 AND (${prefixes.map((_, i) => `holder LIKE $${i + 2}`).join(" OR ")})
      RETURNING holder`,
    [LOCK, ...prefixes.map((p) => `${p}%`)],
  );
  return rows.length;
}

export async function currentUpdateLock(): Promise<LockInfo | null> {
  if (!settingsAvailable()) return null;
  const rows = await eventsQuery<{ holder: string; acquired_at: Date; expires_at: Date }>(
    `SELECT holder, acquired_at, expires_at FROM public.run_locks
      WHERE name = $1 AND expires_at >= now()`,
    [LOCK],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    holder: r.holder,
    acquiredAt: new Date(r.acquired_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  };
}
