import { useEffect, useMemo, useState } from "react";
import { type MarketStatusEntry, type MarketGroup } from "@/lib/market-status";
import { chipPlatformOf, isOwnApproval } from "@/lib/chip-platform";
import { holderOf, type PartKind } from "@/lib/market-share";
import { flagUrl } from "@/lib/country-flag";
import { expiryOf, type Expiry, type ExpiryState } from "@/lib/expiry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ShieldCheck,
  BarChart3,
  History,
  CalendarClock,
  Cpu,
  Layers,
  GitBranch,
} from "lucide-react";
import { PlatformTimelineView, type TimelineFocus } from "@/components/PlatformTimelineView";
import { parseCertificate } from "@/lib/cert-family";
import { CurrentStatusView } from "@/components/tacho/CurrentStatusView";
import { GenSplitBar, GenSplitLegend } from "@/components/tacho/GenSplit";
import { LabsCard } from "@/components/tacho/LabsCard";
import { MarketHistoryView } from "@/components/tacho/MarketHistoryView";
import { RecordDetailDialog } from "@/components/tacho/RecordDetailDialog";
import { DEVICE_TYPES, EXPIRY_DOT, EXPIRY_LABELS, uniq } from "@/components/tacho/constants";
import { ExpiryBadge } from "@/components/tacho/shared";
import { type TachoCard } from "@/components/tacho/types";

type Drill =
  | { kind: "generation"; value: string }
  | { kind: "activeGeneration"; value: string }
  | { kind: "manufacturer"; value: string }
  | { kind: "certificate"; value: string }
  | { kind: "device"; value: string }
  | { kind: "expiry"; value: ExpiryState };

export function AnalyticsView({
  cards,
  marketStatus,
  timelineFocus,
}: {
  cards: TachoCard[];
  marketStatus: { byId: Map<string, MarketStatusEntry>; groups: MarketGroup[] };
  /** v2.55: open the Platform Timeline at a certificate family (link from a record). */
  timelineFocus?: TimelineFocus;
}) {
  // One selection for every drill-down, so the same window serves generations,
  // manufacturers, security certificates and the validity buckets.
  const [drill, setDrill] = useState<Drill | null>(null);
  const [drillCard, setDrillCard] = useState<TachoCard | null>(null);
  const [subTab, setSubTab] = useState<"overview" | "longterm" | "history" | "timeline">(
    timelineFocus ? "timeline" : "overview",
  );
  // v2.55: links into the Platform Timeline (certificate table, record view).
  const [localFocus, setLocalFocus] = useState<TimelineFocus>(timelineFocus ?? null);
  useEffect(() => {
    if (timelineFocus) {
      setLocalFocus(timelineFocus);
      setSubTab("timeline");
    }
  }, [timelineFocus]);
  const openTimeline = (certificate: string) => {
    const ref = parseCertificate(certificate);
    setLocalFocus({ family: ref?.family, nonce: Date.now() });
    setSubTab("timeline");
  };
  const total = cards.length;

  // v2.57: one filter bar above the Overview (product group, group by,
  // history). By default every figure on the Overview counts the approvals in
  // force today (market status "current"); with "include history" it counts
  // every record, as the Overview did up to v2.56.
  const [ovDevice, setOvDevice] = useState("all");
  const [ovGroupBy, setOvGroupBy] = useState<"holder" | "platform">("holder");
  const [includeHistory, setIncludeHistory] = useState(false);
  const ovDeviceTypes = useMemo(
    () => uniq([...DEVICE_TYPES, ...cards.map((c) => c.device_type || "Card")]),
    [cards],
  );
  const ovScoped = useMemo(
    () => cards.filter((c) => ovDevice === "all" || (c.device_type || "Card") === ovDevice),
    [cards, ovDevice],
  );
  const ovCards = useMemo(
    () =>
      includeHistory
        ? ovScoped
        : ovScoped.filter((c) => marketStatus.byId.get(c.id)?.status === "current"),
    [ovScoped, includeHistory, marketStatus],
  );

  const genCounts = useMemo(() => {
    const m: Record<string, number> = {};
    cards.forEach((c) => {
      m[c.generation] = (m[c.generation] ?? 0) + 1;
    });
    return m;
  }, [cards]);
  const gens = ["G1", "G2.1", "G2.2"].filter((g) => genCounts[g]);

  // v2.58: the generation bars use exactly the records of the market share
  // table below (ovCards: product group + active / history), split by
  // generation — so G1 + G2.1 + G2.2 add up to the table's approvals.
  const activeGen = useMemo(() => {
    const ids: Record<string, Set<string>> = {};
    const counts: Record<string, number> = {};
    const countries: Record<string, Set<string>> = {};
    // v2.59: own approval of the chip platform vendor vs. via partner (another
    // card manufacturer on that platform) vs. platform unknown — per generation.
    const parts: Record<string, Record<PartKind, number>> = {};
    for (const c of ovCards) {
      const gen = c.generation || "—";
      (ids[gen] ??= new Set()).add(c.id);
      counts[gen] = (counts[gen] ?? 0) + 1;
      const vendor = chipPlatformOf(c).vendor;
      const kind: PartKind = !vendor ? "unknown" : isOwnApproval(c, vendor) ? "own" : "partner";
      const p = (parts[gen] ??= { own: 0, partner: 0, unknown: 0 });
      p[kind]++;
      if (String(c.country ?? "").trim()) (countries[gen] ??= new Set()).add(c.country);
    }
    const share: Record<string, number> = {};
    for (const [gen, n] of Object.entries(counts)) share[gen] = (n / (ovCards.length || 1)) * 100;
    const countryCounts: Record<string, number> = {};
    for (const [gen, set] of Object.entries(countries)) countryCounts[gen] = set.size;
    const otherGen = Object.entries(counts)
      .filter(([g]) => !["G1", "G2.1", "G2.2"].includes(g))
      .reduce((a, [, n]) => a + n, 0);
    // Countries whose newest approval in scope is not in force (delisted or
    // status unclear) — they do not appear in the active figures.
    const notActive: string[] = [];
    if (!includeHistory) {
      for (const g of marketStatus.groups) {
        if (ovDevice !== "all" && g.deviceType !== ovDevice) continue;
        if (!String(g.country ?? "").trim()) continue;
        const top = g.entries[0];
        if (top && top.status !== "current") notActive.push(g.country);
      }
    }
    return {
      ids,
      counts,
      countryCounts,
      share,
      parts,
      total: ovCards.length,
      otherGen,
      notActive: [...new Set(notActive)].sort(),
    };
  }, [ovCards, includeHistory, marketStatus, ovDevice]);
  const activeGens = ["G1", "G2.1", "G2.2"].filter((g) => activeGen.counts[g]);
  const activeMax = Math.max(1, ...activeGens.map((g) => activeGen.counts[g]));

  const mfgList = useMemo(() => {
    const map: Record<string, { approvals: number; countries: Set<string> }> = {};
    cards.forEach((c) => {
      const m = holderOf(c);
      if (!map[m]) map[m] = { approvals: 0, countries: new Set() };
      map[m].approvals++;
      map[m].countries.add(c.country);
    });
    return Object.entries(map)
      .map(([name, v]) => ({
        name,
        approvals: v.approvals,
        countries: v.countries.size,
        share: (v.approvals / (total || 1)) * 100,
      }))
      .sort((a, b) => b.approvals - a.approvals || b.countries - a.countries);
  }, [cards, total]);
  const mfgMax = mfgList[0]?.approvals || 1;

  // Device types. Cards, vehicle units and motion sensors all appear in the JRC
  // and Common Criteria sources; keeping them apart from the generation means a
  // vehicle unit can still carry its own generation.
  const deviceCounts = useMemo(() => {
    const m: Record<string, number> = Object.fromEntries(DEVICE_TYPES.map((d) => [d, 0]));
    for (const c of ovCards) {
      const d = c.device_type || "Card";
      m[d] = (m[d] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [ovCards]);

  // Security certificates, from the other direction: which type approvals rest
  // on a given certificate. The data carried the link all along, but only ever
  // card -> certificate; "what hangs on ANSSI-CC-2022/38?" had no answer here.
  const certList = useMemo(() => {
    const map = new Map<string, { approvals: number; countries: Set<string>; expiry: Expiry }>();
    for (const c of ovCards) {
      const name = String(c.security_certificate ?? "").trim();
      if (!name || name === "—") continue;
      let entry = map.get(name);
      if (!entry) {
        entry = { approvals: 0, countries: new Set(), expiry: expiryOf(c.certificate_expiry_date) };
        map.set(name, entry);
      }
      entry.approvals++;
      entry.countries.add(c.country);
      // Keep the earliest known expiry across the cards sharing the certificate.
      const e = expiryOf(c.certificate_expiry_date);
      if (e.date && (!entry.expiry.date || e.date < entry.expiry.date)) entry.expiry = e;
    }
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        approvals: v.approvals,
        countries: v.countries.size,
        expiry: v.expiry,
      }))
      .sort((a, b) => b.approvals - a.approvals || a.name.localeCompare(b.name));
  }, [ovCards]);

  // Validity buckets. The expiry dates were already stored but never evaluated.
  const expiryBuckets = useMemo(() => {
    const buckets: Record<ExpiryState, TachoCard[]> = {
      expired: [],
      critical: [],
      warning: [],
      ok: [],
      unknown: [],
    };
    for (const c of ovCards) buckets[expiryOf(c.certificate_expiry_date).state].push(c);
    return buckets;
  }, [ovCards]);

  // Drill-down opens as a window in the same style as the map view, instead of
  // pushing a list below the chart where it is easy to miss on a long page.
  const drillTitle = !drill
    ? ""
    : drill.kind === "generation"
      ? `Generation ${drill.value}`
      : drill.kind === "activeGeneration"
        ? `Generation ${drill.value} — active card approval per country`
        : drill.kind === "expiry"
          ? EXPIRY_LABELS[drill.value as ExpiryState]
          : drill.value;
  const drillRows = useMemo(() => {
    if (!drill) return [];
    const source =
      drill.kind === "activeGeneration"
        ? cards.filter((c) => activeGen.ids[drill.value]?.has(c.id))
        : drill.kind === "generation"
          ? ovCards.filter((c) => c.generation === drill.value)
          : drill.kind === "manufacturer"
            ? cards.filter((c) => holderOf(c) === drill.value)
            : drill.kind === "certificate"
              ? ovCards.filter((c) => String(c.security_certificate ?? "").trim() === drill.value)
              : drill.kind === "device"
                ? ovCards.filter((c) => (c.device_type || "Card") === drill.value)
                : ovCards.filter((c) => expiryOf(c.certificate_expiry_date).state === drill.value);
    return [...source].sort(
      (a, b) =>
        a.country.localeCompare(b.country) ||
        String(a.type_approval_number).localeCompare(String(b.type_approval_number)),
    );
  }, [cards, ovCards, drill, activeGen]);
  const closeDrill = () => {
    setDrill(null);
    setDrillCard(null);
  };
  const toggleDrill = (next: Drill) =>
    setDrill((cur) => (cur && cur.kind === next.kind && cur.value === next.value ? null : next));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Market Analytics</h2>
        <p className="text-sm text-muted-foreground">
          {total} records across {gens.length} generation(s)
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={subTab === "overview" ? "default" : "outline"}
          size="sm"
          onClick={() => setSubTab("overview")}
        >
          <BarChart3 className="mr-2 h-4 w-4" /> Overview
        </Button>
        <Button
          variant={subTab === "longterm" ? "default" : "outline"}
          size="sm"
          onClick={() => setSubTab("longterm")}
        >
          <Layers className="mr-2 h-4 w-4" /> Long Term History
        </Button>
        <Button
          variant={subTab === "history" ? "default" : "outline"}
          size="sm"
          onClick={() => setSubTab("history")}
        >
          <History className="mr-2 h-4 w-4" /> History
        </Button>
        <Button
          variant={subTab === "timeline" ? "default" : "outline"}
          size="sm"
          onClick={() => setSubTab("timeline")}
        >
          <GitBranch className="mr-2 h-4 w-4" /> Platform Timeline
        </Button>
      </div>

      {subTab === "timeline" && (
        <PlatformTimelineView
          cards={cards}
          statusById={marketStatus.byId}
          focus={localFocus}
          onOpenCard={(id) => setDrillCard(cards.find((c) => c.id === id) ?? null)}
        />
      )}

      {/* v2.47: all type approvals ever recorded per manufacturer (moved here
          from Overview, which now shows the current market share). */}
      {subTab === "longterm" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Manufacturers — Type Approvals &amp; Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Click a row to list its type approvals.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Manufacturer</th>
                    <th className="py-2 pr-3 text-right font-medium">Type Approvals</th>
                    <th className="py-2 pr-3 text-right font-medium">Countries</th>
                    <th className="py-2 pr-3 text-right font-medium">Market Share</th>
                    <th className="hidden py-2 pr-3 font-medium w-56 lg:table-cell"></th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {mfgList.map((m) => (
                    // The whole row opens the drill-down. The button alone sat in
                    // the last column of a six-column table and was scrolled out
                    // of sight on narrower screens — easy to conclude it is
                    // missing entirely.
                    <tr
                      key={m.name}
                      onClick={() => toggleDrill({ kind: "manufacturer", value: m.name })}
                      className="cursor-pointer border-b last:border-0 hover:bg-accent/60"
                      title="Click to list the type approvals"
                    >
                      <td className="py-2 pr-3 font-medium">{m.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.approvals}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.countries}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.share.toFixed(1)}%</td>
                      <td className="hidden py-2 pr-3 lg:table-cell">
                        <div className="h-3 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                            style={{ width: `${(m.approvals / mfgMax) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDrill({ kind: "manufacturer", value: m.name });
                          }}
                        >
                          {drill?.kind === "manufacturer" && drill.value === m.name
                            ? "Hide"
                            : "Show countries"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {subTab === "history" && <MarketHistoryView groups={marketStatus.groups} cards={cards} />}

      {subTab === "overview" && (
        <>
          <Card>
            <CardContent className="grid items-end gap-3 pt-6 sm:grid-cols-2 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Product group
                </label>
                <Select value={ovDevice} onValueChange={setOvDevice}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All product groups</SelectItem>
                    {ovDeviceTypes.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Group by
                </label>
                <Select
                  value={ovGroupBy}
                  onValueChange={(v) => setOvGroupBy(v as "holder" | "platform")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="holder">Approval holder</SelectItem>
                    <SelectItem value="platform">Chip platform</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label
                className="flex h-10 cursor-pointer items-center gap-2 text-sm"
                title="Off: only the approvals in force today (market status “current”). On: every record, including superseded and delisted approvals."
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={includeHistory}
                  onChange={(e) => setIncludeHistory(e.target.checked)}
                />
                Include history (long term, all approvals)
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2 md:col-span-3">
                {includeHistory
                  ? `Long term: all ${ovCards.length} record${ovCards.length === 1 ? "" : "s"} in scope, including superseded and delisted approvals.`
                  : `Active approvals only: ${ovCards.length} of ${ovScoped.length} record${ovScoped.length === 1 ? "" : "s"} in scope are in force today (newest in their lane, still listed on JRC).`}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {includeHistory ? "Approvals per Generation" : "Active approvals per Generation"}
                  {ovDevice !== "all" ? ` — ${ovDevice}` : ""}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {includeHistory
                    ? `All ${activeGen.total} approvals in scope, including superseded and delisted ones`
                    : `The ${activeGen.total} approvals in force today (newest in their lane, still listed on JRC) — same records as the market share table below`}
                </p>
                <GenSplitLegend tone="dark" />
              </CardHeader>
              <CardContent className="space-y-2">
                {activeGens.map((g) => (
                  <button
                    key={g}
                    onClick={() => toggleDrill({ kind: "activeGeneration", value: g })}
                    className="grid w-full grid-cols-[60px_1fr_170px] items-center gap-3 rounded p-1 text-left hover:bg-accent"
                    title={`${activeGen.counts[g]} approval(s) in ${activeGen.countryCounts[g] ?? 0} country(ies): own ${activeGen.parts[g]?.own ?? 0} · via partner ${activeGen.parts[g]?.partner ?? 0} · platform unknown ${activeGen.parts[g]?.unknown ?? 0} — click to list them`}
                  >
                    <span className="font-semibold">{g}</span>
                    <div className="h-5 overflow-hidden rounded bg-muted">
                      <GenSplitBar
                        parts={activeGen.parts[g]}
                        width={(activeGen.counts[g] / activeMax) * 100}
                        tone="dark"
                      />
                    </div>
                    <span className="text-right text-xs text-muted-foreground tabular-nums">
                      {activeGen.counts[g]} approval{activeGen.counts[g] === 1 ? "" : "s"} ·{" "}
                      {activeGen.countryCounts[g] ?? 0} countr
                      {(activeGen.countryCounts[g] ?? 0) === 1 ? "y" : "ies"}
                    </span>
                  </button>
                ))}
                {activeGens.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">No approvals in scope.</p>
                )}
                {activeGen.otherGen > 0 && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {activeGen.otherGen} approval{activeGen.otherGen === 1 ? "" : "s"} without a G1
                    / G2.1 / G2.2 generation.
                  </p>
                )}
                {activeGen.notActive.length > 0 && (
                  <p
                    className="pt-1 text-xs text-muted-foreground"
                    title={activeGen.notActive.join(", ")}
                  >
                    Not in the figures (newest approval delisted or status unclear):{" "}
                    {activeGen.notActive.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Market Share by Generation</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {includeHistory
                    ? `Share of all ${activeGen.total} approvals in scope (incl. history)`
                    : `Share of the ${activeGen.total} approvals in force today`}
                </p>
                <GenSplitLegend tone="purple" />
              </CardHeader>
              <CardContent className="space-y-2">
                {activeGens.map((g) => {
                  // Same records as the market share table (v2.58).
                  const pct = activeGen.share[g] ?? 0;
                  return (
                    <button
                      key={g}
                      onClick={() => toggleDrill({ kind: "activeGeneration", value: g })}
                      className="grid w-full grid-cols-[60px_1fr_60px] items-center gap-3 rounded p-1 text-left hover:bg-accent"
                    >
                      <span className="font-semibold">{g}</span>
                      <div className="h-5 overflow-hidden rounded bg-muted">
                        <GenSplitBar parts={activeGen.parts[g]} width={pct} tone="purple" />
                      </div>
                      <span className="text-right text-xs text-muted-foreground tabular-nums">
                        {pct.toFixed(1)}%
                      </span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* v2.47: current market share (formerly the Current Status tab) */}
          <CurrentStatusView
            cards={cards}
            marketStatus={marketStatus}
            deviceType={ovDevice}
            groupBy={ovGroupBy}
            includeHistory={includeHistory}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                Device types
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Cards, vehicle units and motion sensors are counted separately from the generation —
                a vehicle unit has a generation of its own.
              </p>
              <div className="flex flex-wrap gap-2">
                {deviceCounts.map(([name, count]) => (
                  <button
                    key={name}
                    type="button"
                    disabled={count === 0}
                    onClick={() => toggleDrill({ kind: "device", value: name })}
                    className={
                      "rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 " +
                      (count > 0 ? "hover:bg-accent" : "") +
                      (drill?.kind === "device" && drill.value === name ? " bg-accent" : "")
                    }
                  >
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-lg font-semibold tabular-nums">{count}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                Certificate validity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Based on the stored expiry date. &ldquo;Not dated&rdquo; means no readable date is
                on file — those are not safe to treat as valid.
              </p>
              <div className="flex flex-wrap gap-2">
                {(["expired", "critical", "warning", "ok", "unknown"] as ExpiryState[]).map(
                  (state) => (
                    <button
                      key={state}
                      type="button"
                      disabled={expiryBuckets[state].length === 0}
                      onClick={() => toggleDrill({ kind: "expiry", value: state })}
                      className={
                        "rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 " +
                        (expiryBuckets[state].length > 0 ? "hover:bg-accent" : "") +
                        (drill?.kind === "expiry" && drill.value === state ? " bg-accent" : "")
                      }
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className={`h-2 w-2 rounded-full ${EXPIRY_DOT[state]}`} />
                        {EXPIRY_LABELS[state]}
                      </div>
                      <div className="text-lg font-semibold tabular-nums">
                        {expiryBuckets[state].length}
                      </div>
                    </button>
                  ),
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Security certificates — type approvals &amp; countries
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                The reverse view: which type approvals rest on a given certificate. Click a row to
                list them.
              </p>
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Certificate</th>
                      <th className="py-2 pr-4 text-right font-medium">Type Approvals</th>
                      <th className="py-2 pr-4 text-right font-medium">Countries</th>
                      <th className="py-2 pr-4 font-medium">Validity</th>
                      <th className="py-2 pr-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {certList.map((c) => (
                      <tr
                        key={c.name}
                        onClick={() => toggleDrill({ kind: "certificate", value: c.name })}
                        className="cursor-pointer border-b align-top last:border-0 hover:bg-accent/60"
                        title="Click to list the type approvals"
                      >
                        <td className="py-2 pr-4 font-medium">{c.name}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{c.approvals}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{c.countries}</td>
                        <td className="py-2 pr-4">
                          <ExpiryBadge expiry={c.expiry} />
                        </td>
                        <td className="py-2 pr-1 text-right">
                          {parseCertificate(c.name) && (
                            <button
                              type="button"
                              className="text-xs text-primary underline-offset-2 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTimeline(c.name);
                              }}
                              title="Show this certificate in the Platform Timeline"
                            >
                              Timeline →
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {certList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          No security certificates recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <LabsCard cards={ovCards} />
        </>
      )}

      {/* Drill-down window — same style as the country window in the map view */}
      <Dialog open={!!drill} onOpenChange={(o) => !o && closeDrill()}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {drillTitle} · {drillRows.length} type approval
              {drillRows.length === 1 ? "" : "s"} in {new Set(drillRows.map((c) => c.country)).size}{" "}
              countr
              {new Set(drillRows.map((c) => c.country)).size === 1 ? "y" : "ies"}
            </DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 pr-4 font-medium">Type Approval</th>
                <th className="py-2 pr-4 font-medium">Generation</th>
                <th className="py-2 pr-4 font-medium">
                  {drill?.kind === "generation" ? "Manufacturer" : "Date / Status"}
                </th>
              </tr>
            </thead>
            <tbody>
              {drillRows.map((c) => {
                const fUrl = flagUrl(c.country, 40);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setDrillCard(c)}
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
                    <td className="py-2 pr-4">
                      {(drill?.kind === "generation"
                        ? c.current_manufacturer_normalized || c.current_manufacturer
                        : c.date_status) || "—"}
                    </td>
                  </tr>
                );
              })}
              {drillRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>

      {/* Record window, opened from a drill-down row. It stacks on top of the
          list, so "Back" simply closes it and the list is still there. Shared
          with Current Status / History so every drill-down surface opens the
          same record window. */}
      <RecordDetailDialog card={drillCard} onClose={() => setDrillCard(null)} />
    </div>
  );
}
