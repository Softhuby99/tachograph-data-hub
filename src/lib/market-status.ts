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
// Grouping is by (country, manufacturer, device type) — NOT by generation. A
// G2 type approval supersedes the G1 that came before it in the same
// country/manufacturer/device-type lane (confirmed against the Ukraine
// G1 -> G2 case: one country, one manufacturer, two generations, the newer
// one is what is current today). Within a group, entries are ranked purely by
// certificate_issued_date; the most recent is the candidate for "current".

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

export type MarketGroupEntry = {
  id: string;
  generation: string;
  type_approval_number: string;
  certificate_issued_date: string;
  status: MarketStatus;
};

export type MarketGroup = {
  key: string;
  country: string;
  manufacturer: string;
  deviceType: string;
  /** Newest first; undated entries last. */
  entries: MarketGroupEntry[];
};

function normApproval(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function groupKeyFor(card: MarketCard): string {
  const country = String(card.country ?? "")
    .trim()
    .toLowerCase();
  const manufacturer = String(
    card.current_manufacturer_normalized || card.current_manufacturer || "",
  )
    .trim()
    .toLowerCase();
  const deviceType = String(card.device_type || "Card")
    .trim()
    .toLowerCase();
  return `${country}|${manufacturer}|${deviceType}`;
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
function isListed(typeApproval: string, listing: CurrentListingEntry[]): boolean {
  const key = normApproval(typeApproval);
  if (!key) return false;
  return listing.some((e) => {
    const haystack = e.type_approval_number || normApproval(e.raw_type_approval);
    if (!haystack) return false;
    // Substring either direction: the DB sometimes stores a longer combined
    // form ("e5*165/2014*980/2023*2002*00") than JRC's short form ("e5-2002-00")
    // and vice versa — see jrc.server.ts's matchCard, which has the same shape.
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

  for (const [key, members] of groupsByKey) {
    const dated = members
      .map((c) => ({ card: c, date: parseDateMs(c.certificate_issued_date) }))
      .filter((m) => !Number.isNaN(m.date))
      .sort((a, b) => b.date - a.date);
    const undated = members.filter((c) => Number.isNaN(parseDateMs(c.certificate_issued_date)));

    dated.forEach((m, index) => {
      const status: MarketStatus =
        index === 0
          ? isListed(String(m.card.type_approval_number ?? ""), listing)
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
    groups.push({
      key,
      country: String(first?.country ?? ""),
      manufacturer: String(
        first?.current_manufacturer_normalized || first?.current_manufacturer || "",
      ),
      deviceType: String(first?.device_type || "Card"),
      entries: orderedMembers.map((c) => ({
        id: c.id,
        generation: String(c.generation ?? ""),
        type_approval_number: String(c.type_approval_number ?? ""),
        certificate_issued_date: String(c.certificate_issued_date ?? ""),
        status: byId.get(c.id)?.status ?? "unmatched",
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
