/**
 * Certificate validity dates.
 *
 * The dates in this dataset are free text, and they arrive in several
 * spellings: the Common Criteria import writes DD.MM.YYYY, the JRC tables use
 * DD/MM/YYYY, and hand-entered values are sometimes ISO. The data was there all
 * along but never evaluated — this is what turns the collection from a list
 * into something that warns before a card generation runs out of certificate.
 */

export type ExpiryState = "expired" | "critical" | "warning" | "ok" | "unknown";

export type Expiry = {
  state: ExpiryState;
  /** Parsed date, null when the value could not be read. */
  date: Date | null;
  /** Whole days from today; negative once the date has passed. */
  days: number | null;
};

const MS_PER_DAY = 86_400_000;

/** Days ahead at which a certificate counts as critical / worth warning about. */
export const CRITICAL_DAYS = 90;
export const WARNING_DAYS = 183; // ~6 months

/**
 * Reads DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY and YYYY-MM-DD. Two-digit years and
 * anything else are rejected rather than guessed — a wrong warning date is
 * worse than none. Returns null when the value is not a plain date.
 */
export function parseLooseDate(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return makeDate(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (dmy) return makeDate(Number(dmy[1]), Number(dmy[2]), Number(dmy[3]));

  return null;
}

function makeDate(day: number, month: number, year: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates such as 31.02.2026, which Date would roll over.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** Classifies a validity date relative to today. */
export function expiryOf(value: unknown, today = new Date()): Expiry {
  const date = parseLooseDate(value);
  if (!date) return { state: "unknown", date: null, days: null };
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((date.getTime() - midnight) / MS_PER_DAY);
  if (days < 0) return { state: "expired", date, days };
  if (days <= CRITICAL_DAYS) return { state: "critical", date, days };
  if (days <= WARNING_DAYS) return { state: "warning", date, days };
  return { state: "ok", date, days };
}

/** Short human wording for a validity state, e.g. "expires in 42 days". */
export function expiryLabel(e: Expiry): string {
  if (e.state === "unknown" || e.days === null) return "";
  if (e.days < 0) return `expired ${Math.abs(e.days)} day${Math.abs(e.days) === 1 ? "" : "s"} ago`;
  if (e.days === 0) return "expires today";
  return `expires in ${e.days} day${e.days === 1 ? "" : "s"}`;
}

/** True for the states the UI highlights: past due or inside the warning window. */
export function needsAttention(e: Expiry): boolean {
  return e.state === "expired" || e.state === "critical" || e.state === "warning";
}
