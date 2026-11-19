import { useEffect, useMemo, useState } from "react";
import { type MarketStatusEntry, type MarketGroup } from "@/lib/market-status";
import { approvalHolderOf, chipPlatformOf, isOwnApproval } from "@/lib/chip-platform";
import {
  computeShareList,
  shareKeyOf,
  shareScope,
  UNKNOWN_PLATFORM,
  type PartKind,
} from "@/lib/market-share";
import { flagUrl } from "@/lib/country-flag";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { RecordDetailDialog } from "@/components/tacho/RecordDetailDialog";
import { PART_LABEL } from "@/components/tacho/constants";
import { type TachoCard } from "@/components/tacho/types";

const PART_CLASS: Record<PartKind, string> = {
  own: "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partner: "border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unknown: "border-border bg-muted text-muted-foreground",
};

const PART_BAR: Record<PartKind, string> = {
  own: "bg-emerald-500",
  partner: "bg-sky-500",
  unknown: "bg-slate-400",
};

export function CurrentStatusView({
  cards,
  marketStatus,
  deviceType,
  groupBy,
  includeHistory,
}: {
  cards: TachoCard[];
  marketStatus: { byId: Map<string, MarketStatusEntry>; groups: MarketGroup[] };
  /** v2.57: product group / group by / history come from the Overview filter bar. */
  deviceType: string;
  // "holder" = who holds the type approval; "platform" = whose chip platform
  // is inside the card (derived from the security certificate, see
  // src/lib/chip-platform.ts), whoever holds the approval.
  groupBy: "holder" | "platform";
  includeHistory: boolean;
}) {
  const [selectedMfg, setSelectedMfg] = useState<string | null>(null);
  useEffect(() => setSelectedMfg(null), [groupBy]);
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);

  const byId = marketStatus.byId;
  // v2.84: the figures come from src/lib/market-share.ts — the same computation
  // the Reports menu uses, so both always show the same numbers.
  const groupKeyOf = (c: TachoCard) => shareKeyOf(c, groupBy);
  const { scoped, current } = useMemo(
    () => shareScope(cards, byId, { deviceType, includeHistory }),
    [cards, byId, deviceType, includeHistory],
  );
  const delisted = useMemo(
    () => scoped.filter((c) => byId.get(c.id)?.status === "delisted"),
    [scoped, byId],
  );

  const shareList = useMemo(() => computeShareList(current, groupBy), [current, groupBy]);
  const shareMax = shareList[0]?.holders || 1;

  const mfgCountries = useMemo(() => {
    if (!selectedMfg) return [];
    return current
      .filter((c) => groupKeyOf(c) === selectedMfg)
      .sort((a, b) => a.country.localeCompare(b.country));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, selectedMfg, groupBy]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {includeHistory ? "Long-term share" : "Current market share"}
            {groupBy === "platform" ? " by chip platform" : ""}{" "}
            {deviceType !== "all" ? `— ${deviceType}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            {includeHistory ? (
              <>
                Every type approval on record, including superseded and delisted ones (
                {scoped.length} record{scoped.length === 1 ? "" : "s"} in scope).
              </>
            ) : (
              <>
                One type approval per country/product-group lane, whichever manufacturer holds it:
                the newest generation (G2.2 before G2.1 before G1), within it the most recent type
                approval date, still listed on JRC today. {current.length} of {scoped.length} record
                {scoped.length === 1 ? "" : "s"} in scope count as current.
              </>
            )}
            {groupBy === "platform" &&
              " Grouped by the vendor of the secure chip platform, taken from the security certificate number (field 7.2 of the type approval); “own” means the platform vendor also holds the approval, “via partner” means another card manufacturer does."}{" "}
            Click a row to list its countries.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {(["own", "partner", "unknown"] as PartKind[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-4 rounded-sm ${PART_BAR[k]}`} />
                {groupBy === "platform"
                  ? PART_LABEL[k]
                  : k === "own"
                    ? "own chip platform"
                    : k === "partner"
                      ? "chip platform of another vendor"
                      : "platform unknown"}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">
                    {groupBy === "platform" ? "Chip platform" : "Manufacturer"}
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {includeHistory ? "Approvals" : "Current approvals"}
                  </th>
                  <th
                    className="whitespace-nowrap py-2 pr-3 text-right font-medium"
                    title="Approvals per generation: G1 / G2.1 / G2.2"
                  >
                    G1 / G2.1 / G2.2
                  </th>
                  {groupBy === "platform" && (
                    <th className="py-2 pr-3 text-right font-medium">Own / via partner</th>
                  )}
                  <th className="py-2 pr-3 text-right font-medium">Countries</th>
                  <th className="py-2 pr-3 text-right font-medium">Market share</th>
                  <th className="hidden w-40 py-2 pr-3 font-medium lg:table-cell"></th>
                </tr>
              </thead>
              <tbody>
                {shareList.map((m) => (
                  <tr
                    key={m.name}
                    onClick={() => setSelectedMfg(m.name)}
                    className="cursor-pointer border-b last:border-0 hover:bg-accent/60"
                    title="Click to list the countries"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium">{m.name}</div>
                      {m.parts.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.parts.map((p) => (
                            <span
                              key={p.label}
                              className={`rounded border px-1.5 py-0.5 text-[11px] leading-4 ${PART_CLASS[p.kind]}`}
                              title={
                                groupBy === "platform"
                                  ? `${p.label}: ${p.n} approval(s) — ${PART_LABEL[p.kind]}`
                                  : `${p.label} chip: ${p.n} approval(s) — ${PART_LABEL[p.kind]}`
                              }
                            >
                              {groupBy === "holder" && p.kind !== "unknown"
                                ? `${p.label} chip`
                                : p.label}{" "}
                              {p.n}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.holders}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {m.gens["G1"] ?? 0} / {m.gens["G2.1"] ?? 0} / {m.gens["G2.2"] ?? 0}
                    </td>
                    {groupBy === "platform" && (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.name === UNKNOWN_PLATFORM ? (
                          "—"
                        ) : (
                          <>
                            <span className="text-emerald-600 dark:text-emerald-400">{m.own}</span>
                            {" / "}
                            <span className="text-sky-600 dark:text-sky-400">{m.partner}</span>
                          </>
                        )}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-right tabular-nums">{m.countries}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.share.toFixed(1)}%</td>
                    <td className="hidden py-2 pr-3 lg:table-cell">
                      {/* v2.59: bar split own (green) / partner (blue) / unknown (grey) */}
                      <div className="flex h-3 overflow-hidden rounded bg-muted">
                        {(["own", "partner", "unknown"] as PartKind[]).map((k) => {
                          const n = m.parts
                            .filter((p) => p.kind === k)
                            .reduce((a, p) => a + p.n, 0);
                          return n ? (
                            <div
                              key={k}
                              className={`h-full ${PART_BAR[k]}`}
                              style={{ width: `${(n / shareMax) * 100}%` }}
                              title={`${PART_LABEL[k]}: ${n}`}
                            />
                          ) : null;
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
                {shareList.length === 0 && (
                  <tr>
                    <td
                      colSpan={groupBy === "platform" ? 7 : 6}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No current entries in scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {delisted.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Delisted — no longer shown on JRC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Our most recent record for this lane, but its type approval is not currently listed on
              either JRC page. Worth a manual check — JRC may have removed it, or the stored type
              approval number may no longer match its JRC spelling.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Country</th>
                    <th className="py-2 pr-3 font-medium">Manufacturer</th>
                    <th className="py-2 pr-3 font-medium">Product group</th>
                    <th className="py-2 pr-3 font-medium">Type approval</th>
                  </tr>
                </thead>
                <tbody>
                  {delisted.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setDetailCard(c)}
                      className="cursor-pointer border-b last:border-0 hover:bg-accent/60"
                      title="Click for full details"
                    >
                      <td className="py-2 pr-3">{c.country || "—"}</td>
                      <td className="py-2 pr-3">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </td>
                      <td className="py-2 pr-3">{c.device_type || "Card"}</td>
                      <td className="py-2 pr-3 font-medium">{c.type_approval_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Country list for the manufacturer clicked above; clicking a country
          in turn opens the full record, same two-level pattern as Overview. */}
      <Dialog open={!!selectedMfg} onOpenChange={(o) => !o && setSelectedMfg(null)}>
        <DialogContent
          className={`max-h-[80vh] ${groupBy === "platform" ? "max-w-5xl" : "max-w-2xl"}`}
        >
          <DialogHeader>
            <DialogTitle>
              {selectedMfg} · {mfgCountries.length} {includeHistory ? "" : "current "}approval
              {mfgCountries.length === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 pr-4 font-medium">Type Approval</th>
                <th className="py-2 pr-4 font-medium">Generation</th>
                <th className="py-2 pr-4 font-medium">Approved</th>
                {groupBy === "platform" && (
                  <th className="py-2 pr-4 font-medium">Approval holder</th>
                )}
              </tr>
            </thead>
            <tbody>
              {mfgCountries.map((c) => {
                const fUrl = flagUrl(c.country, 40);
                const platform = groupBy === "platform" ? chipPlatformOf(c) : null;
                const own = platform ? isOwnApproval(c, platform.vendor) : false;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setDetailCard(c)}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-accent/60"
                    title="Click for full details"
                  >
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        {fUrl ? (
                          <img
                            src={fUrl}
                            alt=""
                            width={24}
                            height={18}
                            loading="lazy"
                            className="h-[18px] w-6 shrink-0 rounded-sm border object-cover"
                          />
                        ) : (
                          <span>{c.country_flag}</span>
                        )}
                        <span className="font-medium">{c.country}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-medium text-primary underline-offset-2 hover:underline">
                      {c.type_approval_number || "—"}
                    </td>
                    <td className="py-2 pr-4">{c.generation || "—"}</td>
                    <td className="py-2 pr-4">{c.date_status || "—"}</td>
                    {platform && (
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {platform.vendor && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${own ? "border-emerald-500 text-emerald-600" : "border-sky-500 text-sky-600"}`}
                            >
                              {own ? "own approval" : "via partner"}
                            </Badge>
                          )}
                          <span>{approvalHolderOf(c) || "—"}</span>
                        </div>
                        {platform.evidence && (
                          <div
                            className="mt-0.5 text-xs text-muted-foreground"
                            title={
                              platform.source === "text"
                                ? "Derived from the platform text fields only — no known security certificate on file."
                                : "Derived from the security certificate number."
                            }
                          >
                            {platform.source === "text" ? "platform text: " : ""}
                            {platform.evidence.slice(0, 60)}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {mfgCountries.length === 0 && (
                <tr>
                  <td
                    colSpan={groupBy === "platform" ? 5 : 4}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>

      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </div>
  );
}
