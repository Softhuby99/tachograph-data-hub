import pathlib, sys

# ---------------------------------------------------------------------------
# 1) market-status.ts: lane = (country, device type) only — manufacturer is no
#    longer part of the grouping key, so a country can hold only one "current"
#    type approval per device type regardless of who holds it. Also adds a
#    close-dates data-quality flag (two entries in the same lane whose dates
#    are within ~3 months of each other are probably a data entry error).
# ---------------------------------------------------------------------------

ms_path = pathlib.Path("src/lib/market-status.ts")
ms = ms_path.read_text()

if "parseLooseDate" not in ms:
    print("FAIL [market-status.ts]: doesn't look like the 2.36 date-parsing fix is applied yet "
          "(no 'parseLooseDate' found) — apply that patch first.")
    sys.exit(1)

if "CLOSE_DATE_WARNING_DAYS" in ms:
    print("SKIP [market-status.ts]: already patched (found CLOSE_DATE_WARNING_DAYS) — leaving it as is.")
else:
    NEW_MARKET_STATUS = '''// Market status: works out, for every card/vehicle-unit/motion-sensor record,
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
  const DAY_MS = 86_400_000;

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
'''
    ms_path.write_text(NEW_MARKET_STATUS)
    print("OK [market-status.ts]: rewritten with country+device-type lanes + close-date warning")

# ---------------------------------------------------------------------------
# 2) index.tsx: update the three spots that assumed one manufacturer per lane.
# ---------------------------------------------------------------------------

idx_path = pathlib.Path("src/routes/index.tsx")
idx = idx_path.read_text()

def apply(old, new, label):
    global idx
    n = idx.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (need exactly 1)")
        sys.exit(1)
    idx = idx.replace(old, new, 1)
    print(f"OK [{label}]")

apply(
'''            One type approval per country/manufacturer/product-group lane — the most recently
            issued one, still listed on JRC today. {current.length} of {scoped.length} record
            {scoped.length === 1 ? "" : "s"} in scope count as current. Click a row to list its
            countries.
          </p>''',
'''            One type approval per country/product-group lane — the most recently issued one,
            still listed on JRC today, whichever manufacturer holds it. {current.length} of{" "}
            {scoped.length} record{scoped.length === 1 ? "" : "s"} in scope count as current.
            Click a row to list its countries.
          </p>''',
    "1-hint-text",
)

apply(
'''  const chains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => g.entries.length > 1)
      .filter((g) => deviceType === "all" || (g.deviceType || "Card") === deviceType)
      .filter(
        (g) =>
          !q || g.country.toLowerCase().includes(q) || g.manufacturer.toLowerCase().includes(q),
      )
      .sort((a, b) => a.country.localeCompare(b.country) || a.manufacturer.localeCompare(b.manufacturer));
  }, [groups, deviceType, search]);''',
'''  const chains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => g.entries.length > 1)
      .filter((g) => deviceType === "all" || (g.deviceType || "Card") === deviceType)
      .filter(
        (g) =>
          !q ||
          g.country.toLowerCase().includes(q) ||
          g.manufacturers.some((m) => m.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.country.localeCompare(b.country) || a.deviceType.localeCompare(b.deviceType));
  }, [groups, deviceType, search]);''',
    "2-chains-memo",
)

apply(
'''            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {g.country || "—"} · {g.manufacturer || "—"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {g.deviceType}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4">
                {g.entries.map((e) => (
                  <li
                    key={e.id}
                    className="relative cursor-pointer rounded-r px-1 py-0.5 -ml-1 hover:bg-accent/60"
                    onClick={() => cardById.get(e.id) && setDetailCard(cardById.get(e.id)!)}
                    title="Click for full details"
                  >
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.type_approval_number || "—"}</span>
                      <Badge variant="secondary" className="text-xs">
                        {e.generation || "—"}
                      </Badge>
                      <Badge variant="outline" className={`text-xs ${MARKET_STATUS_BADGE_CLASS[e.status]}`}>
                        {MARKET_STATUS_LABEL[e.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {e.certificate_issued_date || "no issue date on file"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>''',
'''            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {g.country || "—"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {g.deviceType}
                </span>
              </CardTitle>
              {g.manufacturers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {g.manufacturers.length > 1 ? "Manufacturers: " : "Manufacturer: "}
                  {g.manufacturers.join(", ")}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4">
                {g.entries.map((e) => (
                  <li
                    key={e.id}
                    className="relative cursor-pointer rounded-r px-1 py-0.5 -ml-1 hover:bg-accent/60"
                    onClick={() => cardById.get(e.id) && setDetailCard(cardById.get(e.id)!)}
                    title="Click for full details"
                  >
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.type_approval_number || "—"}</span>
                      <Badge variant="secondary" className="text-xs">
                        {e.generation || "—"}
                      </Badge>
                      {e.manufacturer && (
                        <Badge variant="outline" className="text-xs">
                          {e.manufacturer}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-xs ${MARKET_STATUS_BADGE_CLASS[e.status]}`}>
                        {MARKET_STATUS_LABEL[e.status]}
                      </Badge>
                      {e.closeDateWarningDays !== undefined && (
                        <Badge
                          variant="outline"
                          className="text-xs border-amber-500 text-amber-600"
                          title={`Only ${e.closeDateWarningDays} day${e.closeDateWarningDays === 1 ? "" : "s"} from the neighbouring entry in this lane — worth a manual check for a data entry error.`}
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" /> Check dates
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {e.certificate_issued_date || "no issue date on file"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>''',
    "3-history-card-and-entries",
)

idx_path.write_text(idx)
print("ALL PATCHES APPLIED OK")
