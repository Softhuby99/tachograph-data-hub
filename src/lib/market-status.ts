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
// Grouping is by (country, device type) ONLY — NOT by manufacturer and NOT by
// generation. A country can have only one active type approval per device
// type at a time: whichever is newest by certificate_issued_date, regardless
// of which manufacturer holds it. (Confirmed against the Ukraine G1 -> G2
// case — one country, one manufacturer, two generations, the newer one is
// current today — and against the Greece case, where a G1 approval from one
// manufacturer and later G2/G2.2 approvals from a different manufacturer all
// share one lane: the newest overall wins, the rest are "superseded" no
// matter who holds them.) Within a group, entries are ranked purely by
// certificate_issued_date; the most recent is the candidate for "current".
//
// Two entries in the same lane whose dates fall within CLOSE_DATE_WARNING_DAYS
// of each other are flagged: that's suspiciously close for two genuinely
// separate approvals and is more likely a data entry error (duplicate, wrong
// manufacturer, wrong date) than a real same-quarter handover.

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
  /** 0 = most recent (or only) dated entry in its group; -1 for undated entries. */
  rank: number;
  groupSize: number;
};

/** Two dates in the same lane closer together than this are flagged as a
 * likely data error rather than a genuine back-to-back approval. */
export const CLOSE_DATE_WARNING_DAYS = 92; // ~3 months

export type MarketGroupEntry = {
  id: string;
  manufacturer: string;
  generation: string;
  type_approval_number: string;
  certificate_issued_date: string;
  status: MarketStatus;
  /** Set on both sides of a pair whose dates are within
   * CLOSE_DATE_WARNING_DAYS of each other — worth a manual check. */
  closeDateWarningDays?: number;
};

export type MarketGroup = {
  key: string;
  country: string;
  deviceType: string;
  /** Every manufacturer that appears in this lane, in entry order. A lane can
   * now span more than one manufacturer — supersession is purely by date. */
  manufacturers: string[];
  /** Newest first; undated entries last. */
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
// Stripping separators and doing a substring test (normApproval) cannot match
// the long form against the short one ("e516520149802023200200" does not
// contain "e5200200"), so every record stored in long form showed as
// Delisted even while JRC still lists it. approvalKeys() pulls out
// (issuing mark, approval number, extension) from every approval found in a
// string; two approvals match when mark and number agree and the extensions
// agree or one side has none (same tolerance the substring test already had).
// ---------------------------------------------------------------------------

type ApprovalKey = { mark: string; number: string; ext: string | null };

const LONG_APPROVAL_RE = /\be\s*(\d{1,2}|cy)\s*\*[^\s;,]*?\*\s*(\d{1,5})\s*\*\s*(\d{1,2})(?!\d)/g;
const SHORT_APPROVAL_RE =
  /\be\s*(\d{1,2}|cy)\s*[-_ ]\s*(?:aetr\s*[-_ ]\s*)?(\d{1,5})(?:\s*[-_/]\s*(?:v|extension\s*)?(\d{1,2}))?(?!\d)/g;

function stripZeros(value: string): string {
  const t = value.replace(/^0+/, "");
  return t === "" ? "0" : t;
}

function approvalKeys(value: string | null | undefined): ApprovalKey[] {
  const text = String(value ?? "").toLowerCase();
  const out: ApprovalKey[] = [];
  for (const m of text.matchAll(LONG_APPROVAL_RE)) {
    out.push({ mark: m[1], number: stripZeros(m[2]), ext: stripZeros(m[3]) });
  }
  const rest = text.replace(LONG_APPROVAL_RE, " ");
  for (const m of rest.matchAll(SHORT_APPROVAL_RE)) {
    out.push({
      mark: m[1],
      number: stripZeros(m[2]),
      ext: m[3] !== undefined ? stripZeros(m[3]) : null,
    });
  }
  return out;
}

function keysMatch(a: ApprovalKey, b: ApprovalKey): boolean {
  return (
    a.mark === b.mark &&
    a.number === b.number &&
    (a.ext === null || b.ext === null || a.ext === b.ext)
  );
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

function parseDateMs(value: string | null | undefined): number {
  // certificate_issued_date arrives as DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY /
  // ISO — the same loose formats expiry.ts already parses correctly. The
  // native Date.parse() silently fails (NaN) on DD.MM.YYYY whenever the day
  // is >12, and silently swaps day/month when both are <=12 — it must not be
  // used here.
  const d = parseLooseDate(value);
  return d ? d.getTime() : NaN;
}

/** Is this type approval still listed on JRC right now, on any of the pages? */
function isListed(
  typeApproval: string,
  listing: CurrentListingEntry[],
  listingKeys: ApprovalKey[][],
): boolean {
  const key = normApproval(typeApproval);
  if (!key) return false;
  // First pass: substring either direction after stripping separators.
  // Catches cosmetic differences (e1-181-01 vs e1_181_01) and combined
  // strings, but NOT long form vs short form — see approvalKeys() above.
  const bySubstring = listing.some((e) => {
    const haystack = e.type_approval_number || normApproval(e.raw_type_approval);
    if (!haystack) return false;
    return haystack.includes(key) || key.includes(haystack);
  });
  if (bySubstring) return true;
  // Second pass: compare issuing mark + approval number + extension.
  const own = approvalKeys(typeApproval);
  if (own.length === 0) return false;
  return listingKeys.some((keys) => keys.some((k) => own.some((o) => keysMatch(o, k))));
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
    const dated = members
      .map((c) => ({ card: c, date: parseDateMs(c.certificate_issued_date) }))
      .filter((m) => !Number.isNaN(m.date))
      .sort((a, b) => b.date - a.date);
    const undated = members.filter((c) => Number.isNaN(parseDateMs(c.certificate_issued_date)));

    // Flag consecutive dated entries that are suspiciously close together —
    // more likely a duplicate/data entry error than a genuine same-quarter
    // handover between approvals.
    const closeWarningDays = new Map<string, number>();
    for (let i = 0; i < dated.length - 1; i++) {
      const diffDays = Math.round((dated[i].date - dated[i + 1].date) / DAY_MS);
      if (diffDays <= CLOSE_DATE_WARNING_DAYS) {
        closeWarningDays.set(dated[i].card.id, diffDays);
        closeWarningDays.set(dated[i + 1].card.id, diffDays);
      }
    }

    dated.forEach((m, index) => {
      const status: MarketStatus =
        index === 0
          ? isListed(String(m.card.type_approval_number ?? ""), listing, listingKeys)
            ? "current"
            : "delisted"
          : "superseded";
      byId.set(m.card.id, {
        id: m.card.id,
        status,
        groupKey: key,
        rank: index,
        groupSize: dated.length,
      });
    });

    for (const c of undated) {
      byId.set(c.id, { id: c.id, status: "unmatched", groupKey: key, rank: -1, groupSize: dated.length });
    }

    const first = members[0];
    const orderedMembers = [...dated.map((m) => m.card), ...undated];
    const manufacturers: string[] = [];
    for (const c of orderedMembers) {
      const m = manufacturerOf(c);
      if (m && !manufacturers.includes(m)) manufacturers.push(m);
    }
    groups.push({
      key,
      country: String(first?.country ?? ""),
      deviceType: String(first?.device_type || "Card"),
      manufacturers,
      entries: orderedMembers.map((c) => ({
        id: c.id,
        manufacturer: manufacturerOf(c),
        generation: String(c.generation ?? ""),
        type_approval_number: String(c.type_approval_number ?? ""),
        certificate_issued_date: String(c.certificate_issued_date ?? ""),
        status: byId.get(c.id)?.status ?? "unmatched",
        closeDateWarningDays: closeWarningDays.get(c.id),
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
