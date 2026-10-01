// Market status: works out, for every card/vehicle-unit/motion-sensor record,
// whether its type approval is the current one in its lane, has been
// superseded by a newer approval, or has disappeared from JRC entirely.
//
// Deliberately isomorphic (no "server" suffix, no DB access): it only needs
// the already-merged card records the Data tab already computes (base row +
// manual overrides) and the jrc_current_listing mirror fetched separately, so
// it runs the same way in the browser and on the server and never re-derives
// the override merge.
//
// Lanes: grouping is by (country, device type) ONLY — not by manufacturer.
// A country has one active type approval per device type at a time,
// whichever manufacturer holds it.
//
// Ranking inside a lane (v2.40):
//   1. Generation first: G2.2 > G2.1 > G1 (> unknown). A newer generation
//      always beats an older one, even if the older generation has a more
//      recent approval date (e.g. a G1 renewal issued after the G2.2).
//   2. Within a generation: newest TYPE APPROVAL date wins.
// The approval date is `date_status` (JRC "Date" column; on
// dtc_other_certificates this is field 8 "Date of approval" of the
// certificate). `certificate_issued_date` is the date of the SECURITY
// certificate (field 7.2, verified against the PDFs on 08.09.2026) and is
// only used as a fallback when no approval date is on file — it must not be
// overwritten with the approval date, it drives the "valid until" display.
//
// An entry of the same generation dated within CLOSE_DATE_WARNING_DAYS of the
// lane's top entry is flagged (on both sides) as a likely data entry error
// (duplicate, wrong manufacturer, wrong date): it puts in doubt which one is
// really current.

import { parseLooseDate } from "./expiry";

export type MarketStatus = "current" | "superseded" | "delisted" | "unmatched";

export type MarketCard = {
  id: string;
  country?: string | null;
  current_manufacturer?: string | null;
  current_manufacturer_normalized?: string | null;
  device_type?: string | null;
  generation?: string | null;
  type_approval_number?: string | null;
  certificate_issued_date?: string | null;
  date_status?: string | null;
};

/** Shape returned by getCurrentListing() (src/lib/db.server.ts / market.functions.ts). */
export type CurrentListingEntry = {
  source_type: string;
  type_approval_number: string; // already normalised (see normApproval below)
  raw_type_approval: string;
  manufacturer: string;
  device_type: string;
};

export type MarketStatusEntry = {
  id: string;
  status: MarketStatus;
  groupKey: string;
  /** Position in the lane's ranking (0 = top candidate). */
  rank: number;
  groupSize: number;
};

/** Two approval dates of the same generation in the same lane closer together
 * than this are flagged as a likely data error. */
export const CLOSE_DATE_WARNING_DAYS = 92; // ~3 months

/** Where the date used for ranking came from. */
export type RankingDateSource = "approval" | "security_certificate" | "none";

export type MarketGroupEntry = {
  id: string;
  manufacturer: string;
  generation: string;
  type_approval_number: string;
  certificate_issued_date: string;
  /** The date the lane was ranked by, as stored (see RankingDateSource). */
  ranking_date: string;
  ranking_date_source: RankingDateSource;
  status: MarketStatus;
  /** Set on both sides of a same-generation pair whose approval dates are
   * within CLOSE_DATE_WARNING_DAYS of each other — worth a manual check. */
  closeDateWarningDays?: number;
};

export type MarketGroup = {
  key: string;
  country: string;
  deviceType: string;
  /** Every manufacturer that appears in this lane, in ranking order. */
  manufacturers: string[];
  /** Ranking order: newest generation first, then newest approval; undated last. */
  entries: MarketGroupEntry[];
};

function normApproval(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Type approval numbers turn up in many spellings for the same approval:
//   JRC short form   e5-2002-00, e1_181_01, e26 2387/03, e4-AETR-0001-00,
//                    e2-151-Extension 1, e5-0100-v02, e1-0005-00 Korr. 01
//   full long form   e5*165/2014*980/2023*2002*00, e4*AETR*3821/85*0007*00
//   several in one   e1-232 / e1-227, e4-0042-01; zuvor e4-0026-00
// approvalKeys() pulls out (issuing mark, series, approval number, extension)
// from every approval found in a string. The series separates the AETR
// numbering (e4-AETR-0001-00) from the EU numbering (e4-0001-00) — they are
// independent sequences, so the same mark + number in different series are
// DIFFERENT approvals.
// ---------------------------------------------------------------------------

export type ApprovalKey = {
  mark: string;
  series: "eu" | "aetr";
  number: string;
  ext: string | null;
};

const LONG_APPROVAL_RE = /\be\s*(\d{1,2}|cy)\s*\*([^\s;,]*?)\*\s*(\d{1,5})\s*\*\s*(\d{1,2})(?!\d)/g;
const SHORT_APPROVAL_RE =
  /\be\s*(\d{1,2}|cy)\s*[-_ ]\s*(aetr\s*[-_ ]\s*)?(\d{1,5})(?:\s*[-_/]\s*(?:v|extension\s*)?(\d{1,2}))?(?!\d)/g;

function stripZeros(value: string): string {
  const t = value.replace(/^0+/, "");
  return t === "" ? "0" : t;
}

export function approvalKeys(value: string | null | undefined): ApprovalKey[] {
  const text = String(value ?? "").toLowerCase();
  const out: ApprovalKey[] = [];
  for (const m of text.matchAll(LONG_APPROVAL_RE)) {
    out.push({
      mark: m[1],
      series: m[2].includes("aetr") ? "aetr" : "eu",
      number: stripZeros(m[3]),
      ext: stripZeros(m[4]),
    });
  }
  const rest = text.replace(LONG_APPROVAL_RE, " ");
  for (const m of rest.matchAll(SHORT_APPROVAL_RE)) {
    out.push({
      mark: m[1],
      series: m[2] ? "aetr" : "eu",
      number: stripZeros(m[3]),
      ext: m[4] !== undefined ? stripZeros(m[4]) : null,
    });
  }
  return out;
}

/** Same approval; a missing extension on either side is tolerated (used for
 * "is this still listed on JRC"). */
export function keysMatch(a: ApprovalKey, b: ApprovalKey): boolean {
  return (
    a.mark === b.mark &&
    a.series === b.series &&
    a.number === b.number &&
    (a.ext === null || b.ext === null || a.ext === b.ext)
  );
}

/** Same approval including the extension (both missing counts as equal). Used
 * where a looser match would attach a JRC revision to the wrong record, e.g.
 * the Update Monitor matching e1-209-03 onto a record stored as e1-209. */
export function keysMatchStrict(a: ApprovalKey, b: ApprovalKey): boolean {
  return a.mark === b.mark && a.series === b.series && a.number === b.number && a.ext === b.ext;
}

function manufacturerOf(card: MarketCard): string {
  return String(card.current_manufacturer_normalized || card.current_manufacturer || "").trim();
}

function groupKeyFor(card: MarketCard): string {
  const country = String(card.country ?? "")
    .trim()
    .toLowerCase();
  const deviceType = String(card.device_type || "Card")
    .trim()
    .toLowerCase();
  return `${country}|${deviceType}`;
}

/** G2.2 = 3, G2.1 / G2 = 2, G1 = 1, anything else 0. */
export function generationRank(generation: string | null | undefined): number {
  const g = String(generation ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/^G2[.,]?2/.test(g) || g === "G2V2") return 3;
  if (/^G2([.,]?1)?$/.test(g) || g.startsWith("G2.1") || g === "G2V1") return 2;
  if (/^G1/.test(g)) return 1;
  return 0;
}

function parseDateMs(value: string | null | undefined): number {
  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY / ISO via expiry.ts. Never use the
  // native Date.parse() here: it fails (NaN) on DD.MM.YYYY when the day is
  // >12 and silently swaps day/month when both are <=12.
  const d = parseLooseDate(value);
  return d ? d.getTime() : NaN;
}

/** date_status sometimes carries a note after the date, e.g.
 * "08.06.2023 (JRC-Listung)". Only a trailing parenthetical is stripped —
 * free text such as "Stand 15.07.2026" (an as-of date, not an approval date)
 * deliberately stays unparsed. */
function approvalDateMs(value: string | null | undefined): number {
  const text = String(value ?? "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  return parseDateMs(text);
}

function rankingDate(card: MarketCard): { ms: number; text: string; source: RankingDateSource } {
  const approval = approvalDateMs(card.date_status);
  if (!Number.isNaN(approval)) {
    return { ms: approval, text: String(card.date_status ?? "").trim(), source: "approval" };
  }
  const security = parseDateMs(card.certificate_issued_date);
  if (!Number.isNaN(security)) {
    return {
      ms: security,
      text: String(card.certificate_issued_date ?? "").trim(),
      source: "security_certificate",
    };
  }
  return { ms: NaN, text: "", source: "none" };
}

/** Is this type approval still listed on JRC right now, on any of the pages? */
function isListed(
  typeApproval: string,
  listing: CurrentListingEntry[],
  listingKeys: ApprovalKey[][],
): boolean {
  const own = approvalKeys(typeApproval);
  // Keyed comparison first: it handles long vs short form and knows the AETR
  // and EU series apart.
  if (own.length > 0 && listingKeys.some((keys) => keys.some((k) => own.some((o) => keysMatch(o, k))))) {
    return true;
  }
  // Then the older substring test (either direction, separators stripped),
  // kept so nothing that matched before v2.39 stops matching. It never
  // confuses the series: "e4000100" is not contained in "e4aetr000100".
  const key = normApproval(typeApproval);
  if (!key) return false;
  return listing.some((e) => {
    const haystack = e.type_approval_number || normApproval(e.raw_type_approval);
    if (!haystack) return false;
    return haystack.includes(key) || key.includes(haystack);
  });
}

export function computeMarketStatus(
  cards: MarketCard[],
  listing: CurrentListingEntry[],
): { byId: Map<string, MarketStatusEntry>; groups: MarketGroup[] } {
  const byId = new Map<string, MarketStatusEntry>();
  const groupsByKey = new Map<string, MarketCard[]>();

  for (const card of cards) {
    const key = groupKeyFor(card);
    const arr = groupsByKey.get(key);
    if (arr) arr.push(card);
    else groupsByKey.set(key, [card]);
  }

  const groups: MarketGroup[] = [];
  const DAY_MS = 86_400_000;
  // Parsed once per run rather than once per lane.
  const listingKeys = listing.map((e) => approvalKeys(e.raw_type_approval));

  for (const [key, members] of groupsByKey) {
    const ranked = members
      .map((card) => ({ card, gen: generationRank(card.generation), date: rankingDate(card) }))
      .sort((a, b) => {
        if (a.gen !== b.gen) return b.gen - a.gen;
        const aDated = !Number.isNaN(a.date.ms);
        const bDated = !Number.isNaN(b.date.ms);
        if (aDated !== bDated) return aDated ? -1 : 1;
        if (aDated && bDated) return b.date.ms - a.date.ms;
        return 0;
      });

    const top = ranked[0];
    const topDated = top ? !Number.isNaN(top.date.ms) : false;

    // Close-date check, only where it decides who is current: other entries
    // of the top entry's generation dated within CLOSE_DATE_WARNING_DAYS of
    // it. Older approvals sitting close to each other (e.g. several parallel
    // G1 card approvals in 2012) are history, not a conflict, and are not
    // flagged.
    const closeWarningDays = new Map<string, number>();
    if (top && topDated) {
      for (const r of ranked.slice(1)) {
        if (r.gen !== top.gen || Number.isNaN(r.date.ms)) continue;
        const diffDays = Math.round(Math.abs(top.date.ms - r.date.ms) / DAY_MS);
        if (diffDays <= CLOSE_DATE_WARNING_DAYS) {
          closeWarningDays.set(r.card.id, diffDays);
          const prev = closeWarningDays.get(top.card.id);
          closeWarningDays.set(top.card.id, prev === undefined ? diffDays : Math.min(prev, diffDays));
        }
      }
    }
    ranked.forEach((r, index) => {
      const dated = !Number.isNaN(r.date.ms);
      let status: MarketStatus;
      if (index === 0) {
        status = !dated
          ? "unmatched"
          : isListed(String(r.card.type_approval_number ?? ""), listing, listingKeys)
            ? "current"
            : "delisted";
      } else if (r.gen < top.gen) {
        // An older generation than the lane's top entry is superseded whether
        // or not it carries a date.
        status = "superseded";
      } else if (dated && topDated) {
        status = "superseded";
      } else {
        // Same generation as the top entry but no date to compare with (or the
        // top itself is undated): the order cannot be decided.
        status = "unmatched";
      }
      byId.set(r.card.id, {
        id: r.card.id,
        status,
        groupKey: key,
        rank: index,
        groupSize: ranked.length,
      });
    });

    const manufacturers: string[] = [];
    for (const r of ranked) {
      const m = manufacturerOf(r.card);
      if (m && !manufacturers.includes(m)) manufacturers.push(m);
    }
    const first = members[0];
    groups.push({
      key,
      country: String(first?.country ?? ""),
      deviceType: String(first?.device_type || "Card"),
      manufacturers,
      entries: ranked.map((r) => ({
        id: r.card.id,
        manufacturer: manufacturerOf(r.card),
        generation: String(r.card.generation ?? ""),
        type_approval_number: String(r.card.type_approval_number ?? ""),
        certificate_issued_date: String(r.card.certificate_issued_date ?? ""),
        ranking_date: r.date.text,
        ranking_date_source: r.date.source,
        status: byId.get(r.card.id)?.status ?? "unmatched",
        closeDateWarningDays: closeWarningDays.get(r.card.id),
      })),
    });
  }

  return { byId, groups };
}

export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  current: "Current",
  superseded: "Superseded",
  delisted: "Delisted",
  unmatched: "Unmatched",
};

/** Outline Badge className per status — kept here so every surface (Data tab
 * row, detail view, Current Status, History) renders the same colour. */
export const MARKET_STATUS_BADGE_CLASS: Record<MarketStatus, string> = {
  current: "border-emerald-500 text-emerald-600",
  superseded: "border-muted-foreground/40 text-muted-foreground",
  delisted: "border-destructive text-destructive",
  unmatched: "border-amber-500 text-amber-600",
};

/** The top-ranked CARD approval of every country lane (v2.45). `status`
 * "current" means it is the active approval (newest in its lane and still
 * listed on JRC); "delisted" / "unmatched" mean the country has no confirmed
 * active approval right now. Shared by the map and the Overview charts. */
export type CountryTopApproval = {
  country: string;
  id: string;
  generation: string;
  type_approval_number: string;
  manufacturer: string;
  status: MarketStatus;
};

export function topCardApprovalByCountry(groups: MarketGroup[]): Map<string, CountryTopApproval> {
  const out = new Map<string, CountryTopApproval>();
  for (const g of groups) {
    if (g.deviceType !== "Card") continue;
    const country = String(g.country ?? "").trim();
    const top = g.entries[0];
    if (!country || !top) continue;
    out.set(country, {
      country,
      id: top.id,
      generation: top.generation,
      type_approval_number: top.type_approval_number,
      manufacturer: top.manufacturer,
      status: top.status,
    });
  }
  return out;
}
