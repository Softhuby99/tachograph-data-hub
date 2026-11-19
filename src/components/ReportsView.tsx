import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  GitCompareArrows,
  Layers,
  PieChart,
  Printer,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { getPlatformLines } from "@/lib/platform.functions";
import type { MarketGroup, MarketStatusEntry } from "@/lib/market-status";
import {
  computeShareList,
  notInForce,
  shareScope,
  SHARE_GENERATIONS,
  UNKNOWN_PLATFORM,
  type ShareGroupBy,
  type ShareListRow,
} from "@/lib/market-share";
import {
  dependencyReport,
  movesReport,
  pipelineReport,
  RECENT_DAYS,
  UNKNOWN,
  type ExpiryBucket,
  type ReportCard,
  type ReportLine,
} from "@/lib/reports";

// v2.83: menu "Reports" — four product-marketing reports over the card data.
// Each one answers a question, shows the figures behind the answer, and can
// be printed (or saved as PDF) and exported as CSV.

export type ReportKey = "share" | "moves" | "pipeline" | "deps";

const REPORTS: { key: ReportKey; label: string; icon: typeof PieChart; question: string }[] = [
  {
    key: "share",
    label: "Market share",
    icon: PieChart,
    question:
      "Whose chip platform, and which supplier, is behind the card approvals in force today?",
  },
  {
    key: "moves",
    label: "Competitive moves",
    icon: GitCompareArrows,
    question: "What was approved in the last 12 months, and where did the supplier change?",
  },
  {
    key: "pipeline",
    label: "Opportunity pipeline",
    icon: Target,
    question:
      "Where is a decision coming up: no G2.2 card yet, a certificate running out, a tender?",
  },
  {
    key: "deps",
    label: "Platform dependencies",
    icon: Layers,
    question:
      "Which security certificate do the approvals of which countries rest on, and when does it expire?",
  },
];

const fmtDate = (isoDate: string) =>
  isoDate ? `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}` : "—";
const pct = (share: number) => `${Math.round(share * 100)} %`;
/** Share in per cent with one decimal — the way Market Analytics shows it. */
const pct1 = (percent: number) => `${percent.toFixed(1)} %`;
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const text = [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `tdh-report-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- small parts

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold leading-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="break-inside-avoid space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <p className="max-w-3xl text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({
  head,
  children,
  minWidth = 640,
}: {
  head: ReactNode[];
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-md border print:overflow-visible">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <td className={`px-3 py-1.5 align-top ${className}`}>{children}</td>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
    {children}
  </p>
);

/** One hue, thin, anchored left: the bar shows magnitude, the number beside it says it. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-full min-w-16" aria-hidden>
      <div
        className="h-2 rounded-r bg-primary/80 print:bg-neutral-700"
        style={{ width: `${max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0}%` }}
      />
    </div>
  );
}

function ShareListTable({
  rows,
  groupBy,
  detailed,
}: {
  rows: ShareListRow[];
  groupBy: ShareGroupBy;
  /** Full table (generation split, own / via partner, who is behind the row). */
  detailed: boolean;
}) {
  if (rows.length === 0) return <Empty>No approval in this scope.</Empty>;
  const max = Math.max(...rows.map((r) => r.holders));
  const nameLabel = groupBy === "platform" ? "Chip platform" : "Approval holder";
  return (
    <Table
      head={[
        nameLabel,
        "Approvals",
        ...(detailed ? ["G1 / G2.1 / G2.2"] : []),
        ...(detailed && groupBy === "platform" ? ["Own / via partner"] : []),
        ...(detailed ? ["Countries"] : []),
        "Share",
        "",
      ]}
      minWidth={detailed ? 760 : 280}
    >
      {rows.map((r) => (
        <tr key={r.name} className="border-b last:border-0">
          <Td>
            <div className={r.name === UNKNOWN_PLATFORM ? "text-muted-foreground" : "font-medium"}>
              {r.name}
            </div>
            {detailed && r.parts.length > 0 && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {groupBy === "platform" ? "Approval held by: " : "Chip platform: "}
                {r.parts.map((p) => `${p.label} ${p.n}`).join(" · ")}
              </div>
            )}
          </Td>
          <Td className="w-20 whitespace-nowrap tabular-nums">{r.holders}</Td>
          {detailed && (
            <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
              {r.gens["G1"] ?? 0} / {r.gens["G2.1"] ?? 0} / {r.gens["G2.2"] ?? 0}
            </Td>
          )}
          {detailed && groupBy === "platform" && (
            <Td className="whitespace-nowrap tabular-nums">
              {r.name === UNKNOWN_PLATFORM ? "—" : `${r.own} / ${r.partner}`}
            </Td>
          )}
          {detailed && <Td className="w-20 tabular-nums">{r.countries}</Td>}
          <Td className="w-20 whitespace-nowrap font-medium tabular-nums">{pct1(r.share)}</Td>
          <Td className={`align-middle ${detailed ? "w-[22%]" : "w-[30%]"}`}>
            <Bar value={r.holders} max={max} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const BUCKET: Record<ExpiryBucket, { label: string; icon: typeof XCircle; cls: string }> = {
  expired: { label: "Expired", icon: XCircle, cls: "text-red-700 dark:text-red-400" },
  "0-6": {
    label: "Within 6 months",
    icon: AlertTriangle,
    cls: "text-amber-700 dark:text-amber-400",
  },
  "6-12": { label: "In 6 to 12 months", icon: Clock, cls: "text-amber-700 dark:text-amber-400" },
  "12-18": { label: "In 12 to 18 months", icon: Clock, cls: "text-muted-foreground" },
};

function Status({
  icon: Icon,
  cls,
  children,
}: {
  icon: typeof XCircle;
  cls: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${cls}`} />
      {children}
    </span>
  );
}

// -------------------------------------------------------------------- reports

type Props = {
  cards: ReportCard[];
  marketStatus: { byId: Map<string, MarketStatusEntry>; groups: MarketGroup[] };
  onOpenCard?: (cardId: string) => void;
  /** Report shown first (default: market share). */
  initialReport?: ReportKey;
};

export function ReportsView({ cards, marketStatus, onOpenCard, initialReport = "share" }: Props) {
  const [active, setActive] = useState<ReportKey>(initialReport);
  const fetchLines = useServerFn(getPlatformLines);
  const linesQuery = useQuery({
    queryKey: ["platform_lines"],
    queryFn: async () => (await fetchLines()) as ReportLine[],
    staleTime: 5 * 60_000,
  });
  const lines = linesQuery.data;

  const today = useMemo(() => new Date(), []);
  // Market share: the same computation and the same settings as Market
  // Analytics → Overview (product group Card), so the figures are identical.
  const [groupBy, setGroupBy] = useState<ShareGroupBy>("platform");
  const [includeHistory, setIncludeHistory] = useState(false);
  const share = useMemo(() => {
    const { scoped, current } = shareScope(cards, marketStatus.byId, {
      deviceType: "Card",
      includeHistory,
    });
    return {
      records: scoped.length,
      total: current.length,
      countries: new Set(current.map((c) => String(c.country ?? "")).filter(Boolean)).size,
      rows: computeShareList(current, groupBy),
      generations: SHARE_GENERATIONS.map((generation) => {
        const list = current.filter((c) => c.generation === generation);
        return {
          generation,
          total: list.length,
          share: current.length ? (list.length / current.length) * 100 : 0,
          rows: computeShareList(list, groupBy),
        };
      }),
      notInForce: includeHistory ? [] : notInForce(marketStatus.groups, "Card"),
    };
  }, [cards, marketStatus, groupBy, includeHistory]);
  const moves = useMemo(
    () => movesReport(marketStatus.groups, today),
    [marketStatus.groups, today],
  );
  const pipeline = useMemo(
    () => pipelineReport(cards, marketStatus.groups, marketStatus.byId, today),
    [cards, marketStatus, today],
  );
  const deps = useMemo(
    () => dependencyReport(cards, marketStatus.byId, lines ?? [], today),
    [cards, marketStatus.byId, lines, today],
  );

  const meta = REPORTS.find((r) => r.key === active)!;

  const open = (cardId: string, label: ReactNode) =>
    onOpenCard ? (
      <button
        type="button"
        className="text-left text-primary underline-offset-2 hover:underline print:text-inherit"
        onClick={() => onOpenCard(cardId)}
      >
        {label}
      </button>
    ) : (
      label
    );

  const print = () => {
    // Paper is white: print in the light theme, then switch back.
    const root = document.documentElement;
    const dark = root.classList.contains("dark");
    if (dark) {
      root.classList.remove("dark");
      window.addEventListener("afterprint", () => root.classList.add("dark"), { once: true });
    }
    window.print();
  };

  const exportCsv = () => {
    if (active === "share") {
      const line = (scope: string, r: ShareListRow) => [
        scope,
        r.name,
        r.holders,
        r.gens["G1"] ?? 0,
        r.gens["G2.1"] ?? 0,
        r.gens["G2.2"] ?? 0,
        groupBy === "platform" ? r.own : "",
        groupBy === "platform" ? r.partner : "",
        r.countries,
        pct1(r.share),
        r.parts.map((p) => `${p.label} ${p.n}`).join(", "),
      ];
      downloadCsv(
        `market-share-by-${groupBy}`,
        [
          "Scope",
          groupBy === "platform" ? "Chip platform" : "Approval holder",
          "Approvals",
          "G1",
          "G2.1",
          "G2.2",
          "Own approval",
          "Via partner",
          "Countries",
          "Share",
          groupBy === "platform" ? "Approval held by" : "Chip platform",
        ],
        [
          ...share.rows.map((r) => line(includeHistory ? "All approvals" : "In force today", r)),
          ...share.generations.flatMap((g) => g.rows.map((r) => line(g.generation, r))),
        ],
      );
    } else if (active === "moves") {
      downloadCsv(
        "competitive-moves",
        ["Section", "Date", "Country", "Generation", "Supplier", "Type approval", "Before", "Kind"],
        [
          ...moves.recent.map((r) => [
            "New approval",
            r.date,
            r.country,
            r.generation,
            r.supplier,
            r.typeApproval,
            r.previousSupplier,
            r.kind,
          ]),
          ...moves.switches.map((s) => [
            "Supplier change",
            s.date,
            s.country,
            `${s.fromGeneration} → ${s.toGeneration}`,
            s.toSupplier,
            "",
            s.fromSupplier,
            "switch",
          ]),
        ],
      );
    } else if (active === "pipeline") {
      downloadCsv(
        "opportunity-pipeline",
        ["Section", "Country", "Generation", "Supplier", "Type approval", "Date", "Detail"],
        [
          ...pipeline.withoutG22.map((c) => [
            "No G2.2 approval",
            c.country,
            c.generation,
            c.supplier,
            c.typeApproval,
            c.date,
            c.g22Area ? "EU / EEA / CH / UK" : "AETR and other",
          ]),
          ...pipeline.expiring.map((e) => [
            "Certificate expiry",
            e.country,
            e.generation,
            e.supplier,
            e.typeApproval,
            e.expiry,
            `${e.certificate} (${BUCKET[e.bucket].label})`,
          ]),
          ...pipeline.tenders.map((t) => [
            "Tender",
            t.country,
            t.generation,
            t.supplier,
            "",
            "",
            [t.tender, t.winner, t.status].filter(Boolean).join(" | "),
          ]),
        ],
      );
    } else {
      downloadCsv(
        "platform-dependencies",
        [
          "Certificate family",
          "Platform line",
          "Vendor",
          "Current approvals",
          "All approvals",
          "Countries",
          "Suppliers",
          "Generations",
          "Expiry from",
          "Expiry to",
        ],
        deps.families.map((f) => [
          f.family,
          f.line,
          f.vendor,
          f.current,
          f.approvals,
          f.countries.join(", "),
          f.suppliers.join(", "),
          f.generations.join(", "),
          f.expiryFrom,
          f.expiryTo,
        ]),
      );
    }
  };

  const leader = share.rows.find((r) => r.name !== UNKNOWN_PLATFORM && r.name !== UNKNOWN);
  const steps = moves.kept + moves.switches.length;
  const expired = pipeline.expiring.filter((e) => e.bucket === "expired").length;
  const within12 = pipeline.expiring.filter(
    (e) => e.bucket === "0-6" || e.bucket === "6-12",
  ).length;
  const biggest = deps.families[0];

  return (
    <div className="space-y-4">
      <style>{`@media print {
  body * { visibility: hidden !important; }
  .report-print, .report-print * { visibility: visible !important; }
  .report-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
  .report-no-print { display: none !important; }
  @page { margin: 14mm; }
}`}</style>

      <div className="report-no-print flex flex-wrap items-center gap-2">
        {REPORTS.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={active === r.key ? "default" : "outline"}
            onClick={() => setActive(r.key)}
          >
            <r.icon className="mr-2 h-4 w-4" /> {r.label}
          </Button>
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={print}>
          <Printer className="mr-2 h-4 w-4" /> Print / PDF
        </Button>
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" /> CSV
        </Button>
      </div>

      <div className="report-print space-y-5 rounded-xl border bg-background p-4 md:p-5">
        <header>
          <h2 className="text-xl font-semibold tracking-tight">{meta.label}</h2>
          <p className="text-sm text-muted-foreground">{meta.question}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tachograph cards only · as of {fmtDate(today.toISOString().slice(0, 10))} · Tachograph
            Data Hub
          </p>
        </header>

        {active === "share" && (
          <>
            <div className="report-no-print flex flex-wrap items-center gap-4 rounded-md border bg-muted/40 px-3 py-2">
              <Choice
                label="Group by"
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: "platform", label: "Chip platform" },
                  { value: "holder", label: "Approval holder" },
                ]}
              />
              <Choice
                label="Basis"
                value={includeHistory ? "all" : "current"}
                onChange={(v) => setIncludeHistory(v === "all")}
                options={[
                  { value: "current", label: "Approvals in force today" },
                  { value: "all", label: "All approvals (including history)" },
                ]}
              />
              <span className="text-xs text-muted-foreground">
                Same figures as Market Analytics → Overview with product group “Card”.
              </span>
            </div>
            <p className="text-sm">
              <strong>
                {groupBy === "platform" ? "By chip platform" : "By approval holder"} ·{" "}
                {includeHistory ? "all approvals including history" : "approvals in force today"}
              </strong>
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label={includeHistory ? "Approvals on record" : "Approvals in force today"}
                value={share.total}
                hint={includeHistory ? "all card records" : `of ${share.records} card records`}
              />
              <Tile
                label={groupBy === "platform" ? "Largest chip platform" : "Largest approval holder"}
                value={leader?.name ?? "—"}
                hint={leader ? `${leader.holders} approvals · ${pct1(leader.share)}` : undefined}
              />
              {groupBy === "platform" ? (
                <Tile
                  label={`${leader?.name ?? "Leader"}: own / via partner`}
                  value={leader ? `${leader.own} / ${leader.partner}` : "—"}
                  hint="approval held by the platform vendor / by another card manufacturer"
                />
              ) : (
                <Tile
                  label="Approval holders"
                  value={share.rows.filter((r) => r.name !== UNKNOWN).length}
                />
              )}
              <Tile label="Countries" value={share.countries} />
            </div>

            <Section
              title={
                (includeHistory ? "Long-term share" : "Current market share") +
                (groupBy === "platform" ? " by chip platform" : " by approval holder")
              }
              note={
                (includeHistory
                  ? "Every type approval on record, including superseded and delisted ones. "
                  : "One type approval per country: the newest generation, within it the most recent approval, still listed on JRC today. ") +
                (groupBy === "platform"
                  ? "Grouped by the vendor of the chip platform, taken from the security certificate — whoever holds the approval. “Own” means the platform vendor holds the approval itself, “via partner” means another card manufacturer does."
                  : "Grouped by the company that holds the type approval; below each name the chip platforms its cards are built on.")
              }
            >
              <ShareListTable rows={share.rows} groupBy={groupBy} detailed />
              {share.notInForce.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Not in the figures (newest approval delisted or status unclear):{" "}
                  {share.notInForce.join(", ")}
                </p>
              )}
            </Section>

            <Section
              title="Within each generation"
              note="The same approvals split by card generation. The percentage in a table is the share within that generation; the heading gives the generation’s part of all approvals."
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-3">
                {share.generations.map((g) => (
                  <div key={g.generation} className="space-y-1.5">
                    <div className="text-sm font-medium">
                      {g.generation}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {g.total} approval{g.total === 1 ? "" : "s"} · {pct1(g.share)} of all
                      </span>
                    </div>
                    <ShareListTable rows={g.rows} groupBy={groupBy} detailed={false} />
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {active === "moves" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="New approvals, last 12 months" value={moves.recent.length} />
              <Tile
                label="…of which another supplier"
                value={moves.recent.filter((r) => r.kind === "switch").length}
                hint={`${moves.recent.filter((r) => r.kind === "first").length} first approval(s) in a country`}
              />
              <Tile
                label="Supplier changes between generations"
                value={moves.switches.length}
                hint={`of ${steps} generation steps`}
              />
              <Tile
                label="Supplier kept at a generation step"
                value={steps ? pct(moves.kept / steps) : "—"}
                hint={`${moves.kept} of ${steps}`}
              />
            </div>

            <Section
              title={`New approvals in the last ${Math.round(RECENT_DAYS / 30.4)} months`}
              note="Approvals whose date lies within the last year, newest first, compared with the approval they follow in the same country."
            >
              {moves.recent.length === 0 ? (
                <Empty>No approval dated within the last 12 months.</Empty>
              ) : (
                <Table
                  head={[
                    "Date",
                    "Country",
                    "Generation",
                    "Supplier",
                    "Type approval",
                    "Compared with before",
                  ]}
                >
                  {moves.recent.map((r) => (
                    <tr key={r.cardId} className="border-b last:border-0">
                      <Td className="whitespace-nowrap tabular-nums">{fmtDate(r.date)}</Td>
                      <Td className="font-medium">{r.country}</Td>
                      <Td>{r.generation}</Td>
                      <Td>{r.supplier}</Td>
                      <Td>{open(r.cardId, r.typeApproval || "—")}</Td>
                      <Td>
                        {r.kind === "switch" ? (
                          <Status icon={GitCompareArrows} cls="text-amber-700 dark:text-amber-400">
                            Replaces {r.previousSupplier}
                          </Status>
                        ) : r.kind === "first" ? (
                          <Status icon={Sparkles} cls="text-sky-700 dark:text-sky-400">
                            First approval in the country
                          </Status>
                        ) : (
                          <Status icon={CheckCircle2} cls="text-muted-foreground">
                            Same supplier
                          </Status>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section
              title="Supplier changes from one generation to the next"
              note="Countries where the newest approval of a generation went to another supplier than the generation before. Newest change first."
            >
              {moves.switches.length === 0 ? (
                <Empty>No supplier change between generations.</Empty>
              ) : (
                <Table head={["Country", "Before", "", "After", "Approved"]}>
                  {moves.switches.map((s) => (
                    <tr key={`${s.country}-${s.toGeneration}`} className="border-b last:border-0">
                      <Td className="font-medium">{s.country}</Td>
                      <Td>
                        {s.fromSupplier}{" "}
                        <span className="text-xs text-muted-foreground">{s.fromGeneration}</span>
                      </Td>
                      <Td className="w-6 text-muted-foreground">
                        <ArrowRight className="h-4 w-4" />
                      </Td>
                      <Td>
                        <strong>{s.toSupplier}</strong>{" "}
                        <span className="text-xs text-muted-foreground">{s.toGeneration}</span>
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{fmtDate(s.date)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section
              title="Won and lost at generation steps"
              note="Per supplier: countries taken over from another supplier, and countries handed to another supplier."
            >
              <Table head={["Supplier", "Won", "Lost", "Net"]} minWidth={360}>
                {moves.balance.map((b) => (
                  <tr key={b.supplier} className="border-b last:border-0">
                    <Td className="font-medium">{b.supplier}</Td>
                    <Td className="w-16 tabular-nums">{b.won}</Td>
                    <Td className="w-16 tabular-nums">{b.lost}</Td>
                    <Td className="w-16 font-medium tabular-nums">
                      {b.net > 0 ? `+${b.net}` : b.net < 0 ? `−${-b.net}` : "0"}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Section>
          </>
        )}

        {active === "pipeline" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label="Countries without a G2.2 card"
                value={pipeline.withoutG22.length}
                hint={`${pipeline.withoutG22.filter((c) => c.g22Area).length} in the EU / EEA / CH / UK`}
              />
              <Tile label="Current approvals on an expired certificate" value={expired} />
              <Tile label="Certificate expires within 12 months" value={within12} />
              <Tile
                label="Expiry date known"
                value={`${pipeline.coverage.withExpiry} of ${pipeline.coverage.current}`}
                hint="current card approvals"
              />
            </div>

            <Section
              title="Countries without a G2.2 card approval"
              note="The smart tachograph 2 is mandatory in new vehicles in the EU, the EEA, Switzerland and the United Kingdom. A country there without a G2.2 approval of its own is the clearest opening; the AETR countries follow their own timetable."
            >
              {pipeline.withoutG22.length === 0 ? (
                <Empty>Every country has a G2.2 approval.</Empty>
              ) : (
                <Table
                  head={[
                    "Country",
                    "Area",
                    "Newest generation",
                    "Supplier today",
                    "Type approval",
                    "Approved",
                  ]}
                >
                  {pipeline.withoutG22.map((c) => (
                    <tr key={c.country} className="border-b last:border-0">
                      <Td className="font-medium">{c.country}</Td>
                      <Td className="text-muted-foreground">
                        {c.g22Area ? "EU / EEA / CH / UK" : "AETR and other"}
                      </Td>
                      <Td>{c.generation}</Td>
                      <Td>{c.supplier}</Td>
                      <Td>{c.typeApproval || "—"}</Td>
                      <Td className="whitespace-nowrap tabular-nums">{fmtDate(c.date)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>

            <Section
              title="Security certificates running out"
              note="Current card approvals whose security certificate has expired or expires within 18 months. A card needs a valid certificate to stay approvable — a renewal or a new platform is due."
            >
              {pipeline.expiring.length === 0 ? (
                <Empty>No certificate of a current approval expires within 18 months.</Empty>
              ) : (
                <Table
                  head={[
                    "Expiry",
                    "When",
                    "Country",
                    "Generation",
                    "Supplier",
                    "Certificate",
                    "Type approval",
                  ]}
                  minWidth={860}
                >
                  {pipeline.expiring.map((e) => {
                    const b = BUCKET[e.bucket];
                    return (
                      <tr key={e.cardId} className="border-b last:border-0">
                        <Td className="whitespace-nowrap tabular-nums">{fmtDate(e.expiry)}</Td>
                        <Td>
                          <Status icon={b.icon} cls={b.cls}>
                            {b.label}
                          </Status>
                        </Td>
                        <Td className="font-medium">{e.country}</Td>
                        <Td>{e.generation}</Td>
                        <Td>{e.supplier}</Td>
                        <Td className="text-xs">{e.certificate.slice(0, 60)}</Td>
                        <Td>{open(e.cardId, e.typeApproval || "—")}</Td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Section>

            <Section
              title="Documented procurement"
              note="What is recorded about tenders and awards for the country’s newest card. Records marked “not researched” are left out."
            >
              {pipeline.tenders.length === 0 ? (
                <Empty>No procurement information recorded.</Empty>
              ) : (
                <Table
                  head={["Country", "Supplier today", "Tender / award", "Winner", "Status"]}
                  minWidth={860}
                >
                  {pipeline.tenders.map((t) => (
                    <tr key={t.country} className="border-b last:border-0">
                      <Td className="font-medium">{t.country}</Td>
                      <Td>
                        {t.supplier}{" "}
                        <span className="text-xs text-muted-foreground">{t.generation}</span>
                      </Td>
                      <Td className="text-xs">{t.tender}</Td>
                      <Td className="text-xs">{t.winner || "—"}</Td>
                      <Td className="text-xs text-muted-foreground">{t.status || "—"}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </>
        )}

        {active === "deps" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label="Card approvals with a security certificate"
                value={`${deps.withCertificate} of ${deps.cards}`}
              />
              <Tile label="Certificate families in use" value={deps.families.length} />
              <Tile
                label="Largest dependency"
                value={biggest ? biggest.family : "—"}
                hint={
                  biggest
                    ? `${biggest.current} current approvals in ${biggest.countries.length} countries`
                    : undefined
                }
              />
              <Tile
                label="…its certificate expires"
                value={biggest?.expiryFrom ? fmtDate(biggest.expiryFrom) : "—"}
                hint={
                  biggest?.days != null
                    ? biggest.days < 0
                      ? `${-biggest.days} days ago`
                      : `in ${biggest.days} days`
                    : undefined
                }
              />
            </div>

            <Section
              title="Approvals per security certificate family"
              note="A certificate family is one certified chip-and-software platform with its maintenance versions. Every approval that names it depends on it: when the certificate expires, all of them need a renewal. The bar counts the approvals in force today; families without one (grey) are history."
            >
              {deps.families.length === 0 ? (
                <Empty>No security certificate recorded.</Empty>
              ) : (
                <Table
                  head={[
                    "Certificate family",
                    "Platform",
                    "Current",
                    "",
                    "Countries (current approvals)",
                    "Card suppliers",
                    "Expiry",
                  ]}
                  minWidth={980}
                >
                  {deps.families.map((f) => (
                    <tr
                      key={f.family}
                      className={`border-b last:border-0 ${f.current === 0 ? "text-muted-foreground" : ""}`}
                    >
                      <Td className="whitespace-nowrap font-medium">{f.family}</Td>
                      <Td className="text-xs">
                        {f.line || f.vendor || "—"}
                        <div className="text-muted-foreground">{f.generations.join(", ")}</div>
                      </Td>
                      <Td className="w-16 whitespace-nowrap tabular-nums">
                        {f.current}
                        <span className="text-xs text-muted-foreground"> / {f.approvals}</span>
                      </Td>
                      <Td className="w-28 align-middle">
                        <Bar value={f.current} max={deps.families[0]!.current} />
                      </Td>
                      <Td className="text-xs">{f.countries.join(", ") || "—"}</Td>
                      <Td className="text-xs">{f.suppliers.join(", ") || "—"}</Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums">
                        {f.expiryFrom ? (
                          <>
                            {f.days != null && f.days < 0 ? (
                              <Status icon={XCircle} cls="text-red-700 dark:text-red-400">
                                {fmtDate(f.expiryFrom)}
                              </Status>
                            ) : f.days != null && f.days <= 365 ? (
                              <Status icon={AlertTriangle} cls="text-amber-700 dark:text-amber-400">
                                {fmtDate(f.expiryFrom)}
                              </Status>
                            ) : (
                              fmtDate(f.expiryFrom)
                            )}
                            {f.expiryTo && f.expiryTo !== f.expiryFrom && (
                              <div className="text-muted-foreground">to {fmtDate(f.expiryTo)}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">not recorded</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">
          How this is counted:{" "}
          {active === "share"
            ? "the market share uses the same computation as Market Analytics → Overview (product group Card), so both show the same figures. "
            : "one approval per country and generation (the newest); a record that names two countries counts for both. "}
          Spellings of the same company are counted as one supplier (for example “AKD d.o.o.” and
          “AKD”); placeholders such as “to be verified” appear as “{UNKNOWN}”. The figures are as
          good as the records: check Tools → Data quality and Tools → Consistency before quoting
          them.
        </p>
      </div>
    </div>
  );
}
