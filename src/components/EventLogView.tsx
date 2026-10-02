import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Loader2,
  RefreshCw,
  ScrollText,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ackEventLog, exportEventLog, getEventLog, getEventOverview } from "@/lib/events.functions";

// v2.52: Tools → Log (operations log). Admin only — the server refuses every
// call without a valid admin token; this component is only rendered for admins.
// Everything is rendered as text (React escaping), never as HTML.

const PAGE = 100;

const LEVELS = ["ERROR", "WARN", "INFO"] as const;
const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All areas" },
  { value: "update", label: "Update" },
  { value: "auth", label: "Admin access" },
  { value: "action", label: "App actions" },
  { value: "proxy", label: "Fetch proxy" },
  { value: "system", label: "System" },
  { value: "log", label: "Log" },
];
const PERIODS: { value: string; label: string; days: number | null }[] = [
  { value: "1", label: "Last 24 h", days: 1 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "365", label: "Last 365 days", days: 365 },
  { value: "all", label: "Everything", days: null },
];
const SOURCE_LABEL: Record<string, string> = {
  card_status: "JRC Card Status",
  other_certificates: "JRC Other Certificates",
  security_updates: "JRC Security Updates",
  key_management: "JRC Key Management",
  public_key_certificates: "JRC Public Key Certificates",
  manufacturer_codes: "JRC Manufacturer Codes",
  cc_certificates: "Common Criteria Portal",
  ted_procurement: "TED Procurement",
};

const berlin = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "short",
  timeStyle: "medium",
});
function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : berlin.format(d);
}
function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function LevelBadge({ level }: { level: string }) {
  const cls =
    level === "ERROR"
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
      : level === "WARN"
        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300";
  const Icon = level === "ERROR" ? XCircle : level === "WARN" ? AlertTriangle : Info;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      <Icon className="h-3 w-3" /> {level}
    </span>
  );
}

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /unauthori[sz]ed|401/i.test(msg);
}

type Filter = {
  levels: string[];
  category: string;
  period: string;
  q: string;
  includeAcked: boolean;
  offset: number;
};

function toServerFilter(f: Filter) {
  const days = PERIODS.find((p) => p.value === f.period)?.days ?? null;
  return {
    levels: f.levels,
    categories: f.category ? [f.category] : [],
    from: days ? new Date(Date.now() - days * 86400000).toISOString() : undefined,
    includeAcked: f.includeAcked,
    q: f.q.trim() || undefined,
    limit: PAGE,
    offset: f.offset,
  };
}

export function EventLogView() {
  const qc = useQueryClient();
  const fetchLog = useServerFn(getEventLog);
  const fetchOverview = useServerFn(getEventOverview);
  const ackFn = useServerFn(ackEventLog);
  const exportFn = useServerFn(exportEventLog);

  const [filter, setFilter] = useState<Filter>({
    levels: ["ERROR", "WARN"],
    category: "",
    period: "30",
    q: "",
    includeAcked: false,
    offset: 0,
  });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [exporting, setExporting] = useState(false);

  const serverFilter = useMemo(() => toServerFilter(filter), [filter]);

  const overview = useQuery({
    queryKey: ["event_overview"],
    queryFn: () => fetchOverview(),
    refetchInterval: 60_000,
    retry: false,
  });
  const log = useQuery({
    queryKey: ["event_log", serverFilter],
    queryFn: () => fetchLog({ data: serverFilter }),
    refetchInterval: 60_000,
    retry: false,
  });

  const ack = useMutation({
    mutationFn: (ids: string[]) => ackFn({ data: { ids, note } }),
    onSuccess: (res) => {
      toast.success(`${res.count} entr${res.count === 1 ? "y" : "ies"} acknowledged.`);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["event_log"] });
      void qc.invalidateQueries({ queryKey: ["event_overview"] });
    },
    onError: (e: Error) => toast.error(`Acknowledge failed: ${e.message}`),
  });

  const set = (patch: Partial<Filter>) => setFilter((f) => ({ ...f, offset: 0, ...patch }));
  const toggleLevel = (lvl: string) =>
    set({
      levels: filter.levels.includes(lvl)
        ? filter.levels.filter((l) => l !== lvl)
        : [...filter.levels, lvl],
    });

  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const ackable = rows.filter((r) => !r.ack_at && r.level !== "INFO").map((r) => r.id);

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await exportFn({ data: { ...serverFilter, offset: 0 } });
      const blob = new Blob([JSON.stringify(res, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tdh-operations-log-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${res.count} entr${res.count === 1 ? "y" : "ies"} exported.`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  if (isUnauthorized(overview.error) || isUnauthorized(log.error)) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          The operations log is only available with a valid admin login. Sign out and sign in again
          with the current admin token.
        </CardContent>
      </Card>
    );
  }

  const ov = overview.data;
  const sources = ov?.sources ?? [];
  const failing = sources.filter((s) => s.lastStatus !== "ok");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-primary" /> Operations log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1">
              <XCircle className="h-4 w-4 text-red-600" />
              <strong>{ov?.openErrors ?? "…"}</strong> open error(s)
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <strong>{ov?.openWarnings ?? "…"}</strong> open warning(s)
            </span>
            <span
              className={`rounded-md border px-2.5 py-1 ${
                ov?.schedule.configured ? "" : "border-amber-300 text-amber-800 dark:text-amber-300"
              }`}
              title={ov?.schedule.note}
            >
              Schedule: {ov ? (ov.schedule.configured ? "active" : "not set up") : "…"}
            </span>
            <span className="text-muted-foreground">
              {sources.length === 0
                ? "No update runs recorded yet."
                : failing.length === 0
                  ? `Last run of all ${sources.length} sources ok.`
                  : `${failing.length} of ${sources.length} sources failed in their last run.`}
            </span>
          </div>

          {sources.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Source</th>
                    <th className="px-2 py-1.5 font-medium">Last run</th>
                    <th className="px-2 py-1.5 font-medium">Result</th>
                    <th className="px-2 py-1.5 font-medium">Last successful</th>
                    <th className="px-2 py-1.5 font-medium">Last successful automatic</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source} className="border-t align-top">
                      <td className="px-2 py-1.5 font-medium">
                        {SOURCE_LABEL[s.source] ?? s.source}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.lastAt)}</td>
                      <td className="px-2 py-1.5">
                        {s.lastStatus === "ok" ? (
                          <span className="text-emerald-700 dark:text-emerald-400">ok</span>
                        ) : (
                          <span className="text-red-700 dark:text-red-400" title={s.lastMessage}>
                            error — {s.lastMessage}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.lastOkAt)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {s.lastAutoOkAt ? (
                          fmt(s.lastAutoOkAt)
                        ) : (
                          <span className="text-muted-foreground">never</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            {LEVELS.map((lvl) => (
              <Button
                key={lvl}
                size="sm"
                variant={filter.levels.includes(lvl) ? "default" : "outline"}
                onClick={() => toggleLevel(lvl)}
              >
                {lvl}
              </Button>
            ))}
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={filter.category}
              onChange={(e) => set({ category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={filter.period}
              onChange={(e) => set({ period: e.target.value })}
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <Input
              className="h-8 w-56"
              placeholder="Search message, code, run id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") set({ q: search });
              }}
              onBlur={() => search !== filter.q && set({ q: search })}
            />
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={filter.includeAcked}
                onChange={(e) => set({ includeAcked: e.target.checked })}
              />
              also acknowledged
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void log.refetch();
                  void overview.refetch();
                }}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${log.isFetching ? "animate-spin" : ""}`} />{" "}
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void doExport()}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export JSON
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-80"
              placeholder="Note for acknowledging (optional)"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={ackable.length === 0 || ack.isPending}
              onClick={() => ack.mutate(ackable)}
              title="Marks the open errors and warnings shown on this page as seen — not as fixed"
            >
              <CheckCheck className="mr-2 h-4 w-4" /> Acknowledge all shown ({ackable.length})
            </Button>
            <span className="text-xs text-muted-foreground">
              {log.isLoading ? "Loading…" : `${total} entr${total === 1 ? "y" : "ies"}`}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-6 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium">Level</th>
                  <th className="px-2 py-1.5 font-medium">Area</th>
                  <th className="px-2 py-1.5 font-medium">Message</th>
                  <th className="px-2 py-1.5 font-medium">Result</th>
                  <th className="px-2 py-1.5 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !log.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                      Nothing logged for this filter.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const expanded = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        className={`cursor-pointer border-t align-top hover:bg-muted/40 ${r.ack_at ? "opacity-60" : ""}`}
                        onClick={() => setOpen(expanded ? null : r.id)}
                      >
                        <td className="px-2 py-1.5">
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {fmt(r.last_seen_at)}
                          {r.repeat_count > 1 && (
                            <div className="text-muted-foreground">
                              ×{r.repeat_count} since {fmt(r.created_at)}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <LevelBadge level={r.level} />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {r.category}
                          {r.source_type && (
                            <div className="text-muted-foreground">
                              {SOURCE_LABEL[r.source_type] ?? r.source_type}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 break-words">{r.message}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {r.status}
                          {r.ack_at && <div className="text-muted-foreground">acknowledged</div>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                          {fmtMs(r.duration_ms)}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t bg-muted/20">
                          <td />
                          <td colSpan={6} className="px-2 py-3">
                            <EventDetails row={r} />
                            {!r.ack_at && r.level !== "INFO" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-3"
                                disabled={ack.isPending}
                                onClick={() => ack.mutate([r.id])}
                              >
                                <CheckCheck className="mr-2 h-4 w-4" /> Acknowledge
                                {note ? " with note" : ""}
                              </Button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {total > PAGE && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                size="sm"
                variant="outline"
                disabled={filter.offset === 0}
                onClick={() => setFilter((f) => ({ ...f, offset: Math.max(0, f.offset - PAGE) }))}
              >
                Newer
              </Button>
              <span className="text-muted-foreground">
                {filter.offset + 1}–{Math.min(filter.offset + PAGE, total)} of {total}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={filter.offset + PAGE >= total}
                onClick={() => setFilter((f) => ({ ...f, offset: f.offset + PAGE }))}
              >
                Older
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Row = NonNullable<Awaited<ReturnType<typeof getEventLog>>>["rows"][number];

function EventDetails({ row }: { row: Row }) {
  const facts: [string, string][] = [
    ["Code", row.code],
    ["Trigger", row.trigger],
    ["Actor", row.actor],
    ["App version", row.app_version],
    ["First seen", fmt(row.created_at)],
    ["HTTP status", row.http_status != null ? String(row.http_status) : ""],
    ["Run id", row.run_id ?? ""],
    ["Check run id", row.check_run_id ?? ""],
    ["Proposal id", row.proposal_id ?? ""],
    ["Card id", row.card_id ?? ""],
    ["Request id", row.request_id],
    ["Server start (boot id)", row.boot_id ?? ""],
    ["Client IP", row.client_ip],
    ["Browser", row.user_agent],
    [
      "Acknowledged",
      row.ack_at ? `${fmt(row.ack_at)}${row.ack_note ? ` — ${row.ack_note}` : ""}` : "",
    ],
  ].filter(([, v]) => v) as [string, string][];
  const details =
    row.details && Object.keys(row.details).length ? JSON.stringify(row.details, null, 2) : "";
  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {facts.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono">{v}</dd>
          </Fragment>
        ))}
      </dl>
      {details && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border bg-background p-2 font-mono text-[11px]">
          {details}
        </pre>
      )}
    </div>
  );
}
