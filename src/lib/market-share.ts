// v2.84: the market share figures — ONE computation for Market Analytics
// (Overview) and the Reports menu. Both used to count on their own and showed
// different numbers for the same question (Reports counted the approval holder
// of every country's newest generation, Analytics the approvals in force
// grouped by holder or chip platform).
//
// Basis: the approvals in force today — one per country / product-group lane,
// market status "current" (newest generation, newest approval, still listed on
// JRC). With `includeHistory` every record in scope counts instead.
// Grouping: "holder" = who holds the type approval; "platform" = whose chip
// platform is inside the card (from the security certificate, chip-platform.ts).

import { chipPlatformOf, isOwnApproval, type PlatformCard } from "./chip-platform";
import type { MarketGroup, MarketStatusEntry } from "./market-status";
import { supplierName } from "./supplier";

export type ShareGroupBy = "holder" | "platform";
/** own = the platform vendor holds the approval itself; partner = another card manufacturer does. */
export type PartKind = "own" | "partner" | "unknown";
export const PART_ORDER: Record<PartKind, number> = { own: 0, partner: 1, unknown: 2 };
export const UNKNOWN_PLATFORM = "Platform unknown";
export const SHARE_GENERATIONS = ["G1", "G2.1", "G2.2"] as const;

export type ShareCard = PlatformCard & {
  id: string;
  country?: string | null;
  device_type?: string | null;
  generation?: string | null;
};

/** The approval holder under one name per company ("AKD d.o.o." = "AKD"). */
export function holderOf(card: ShareCard): string {
  return supplierName(card.current_manufacturer_normalized || card.current_manufacturer);
}

export function partKindOf(card: ShareCard): PartKind {
  const vendor = chipPlatformOf(card).vendor;
  return !vendor ? "unknown" : isOwnApproval(card, vendor) ? "own" : "partner";
}

/** The row a record is counted in. */
export function shareKeyOf(card: ShareCard, groupBy: ShareGroupBy): string {
  return groupBy === "holder" ? holderOf(card) : chipPlatformOf(card).vendor || UNKNOWN_PLATFORM;
}

/** The records the share is computed from. */
export function shareScope<T extends ShareCard>(
  cards: T[],
  statusById: Map<string, MarketStatusEntry>,
  opts: { deviceType: string; includeHistory: boolean },
): { scoped: T[]; current: T[] } {
  const scoped = cards.filter(
    (c) => opts.deviceType === "all" || (c.device_type || "Card") === opts.deviceType,
  );
  return {
    scoped,
    current: opts.includeHistory
      ? scoped
      : scoped.filter((c) => statusById.get(c.id)?.status === "current"),
  };
}

export type ShareListRow = {
  name: string;
  /** Approvals counted in this row. */
  holders: number;
  countries: number;
  own: number;
  partner: number;
  gens: Record<string, number>;
  /** By platform: the approval holders behind the row; by holder: the chip platforms used. */
  parts: { label: string; n: number; kind: PartKind }[];
  /** Per cent of all approvals in `current`. */
  share: number;
};

export function computeShareList(current: ShareCard[], groupBy: ShareGroupBy): ShareListRow[] {
  const map: Record<
    string,
    {
      holders: number;
      countries: Set<string>;
      own: number;
      partner: number;
      gens: Record<string, number>;
      parts: Record<string, { n: number; kind: PartKind }>;
    }
  > = {};
  for (const c of current) {
    const m = shareKeyOf(c, groupBy);
    const row = (map[m] ??= {
      holders: 0,
      countries: new Set(),
      own: 0,
      partner: 0,
      gens: {},
      parts: {},
    });
    row.holders++;
    const vendor = chipPlatformOf(c).vendor;
    const kind = partKindOf(c);
    const key = groupBy === "platform" ? holderOf(c) : vendor || "platform unknown";
    const part = (row.parts[key] ??= { n: 0, kind });
    part.n++;
    const gen = c.generation || "—";
    row.gens[gen] = (row.gens[gen] ?? 0) + 1;
    row.countries.add(String(c.country ?? ""));
    if (groupBy === "platform") {
      if (kind === "own") row.own++;
      else if (kind === "partner") row.partner++;
    }
  }
  const total = current.length || 1;
  return Object.entries(map)
    .map(([name, v]) => ({
      name,
      holders: v.holders,
      countries: v.countries.size,
      own: v.own,
      partner: v.partner,
      gens: v.gens,
      parts: Object.entries(v.parts)
        .map(([label, p]) => ({ label, ...p }))
        .sort(
          (a, b) =>
            PART_ORDER[a.kind] - PART_ORDER[b.kind] || b.n - a.n || a.label.localeCompare(b.label),
        ),
      share: (v.holders / total) * 100,
    }))
    .sort(
      (a, b) =>
        Number(a.name === UNKNOWN_PLATFORM) - Number(b.name === UNKNOWN_PLATFORM) ||
        b.holders - a.holders ||
        b.countries - a.countries ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Countries whose newest approval in scope is not in force (delisted or status
 * unclear) — they do not appear in the "in force today" figures.
 */
export function notInForce(groups: MarketGroup[], deviceType: string): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    if (deviceType !== "all" && g.deviceType !== deviceType) continue;
    if (!String(g.country ?? "").trim()) continue;
    const top = g.entries[0];
    if (top && top.status !== "current") out.add(g.country);
  }
  return [...out].sort();
}
