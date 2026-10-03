import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Download,
  FileQuestion,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { getDataQuality } from "@/lib/quality.functions";
import { RULE_LABELS, type QualityIssue, type QualityRule } from "@/lib/data-quality";

// v2.53: Tools → Data quality. Admin only (the server refuses without a valid
// admin token). Computed live on every load — nothing is stored per record;
// the log only gets a summary after the daily run when the numbers change.

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /unauthori[sz]ed|401/i.test(msg);
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function DataQualityView({ onOpenCard }: { onOpenCard?: (cardId: string) => void }) {
  const fetchQuality = useServerFn(getDataQuality);
  const q = useQuery({
    queryKey: ["data_quality"],
    queryFn: () => fetchQuality(),
    retry: false,
  });

  // v2.55: "info" = certificate maintenance list; hidden unless chosen.
  const [level, setLevel] = useState<"all" | "error" | "warning" | "info">("all");
  const [rule, setRule] = useState<"" | QualityRule>("");
  const [device, setDevice] = useState("");
  const [search, setSearch] = useState("");

  const issues = q.data?.issues ?? [];
  const devices = useMemo(() => [...new Set(issues.map((i) => i.deviceType))].sort(), [issues]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return issues.filter(
      (i) =>
        (level === "all" ? i.level !== "info" : i.level === level) &&
        (!rule || i.rule === rule) &&
        (!device || i.deviceType === device) &&
        (!s ||
          [i.country, i.typeApproval, i.manufacturer, i.fieldLabel, i.value, i.message]
            .join(" ")
            .toLowerCase()
            .includes(s)),
    );
  }, [issues, level, rule, device, search]);

  const exportCsv = () => {
    const head = [
      "Level",
      "Rule",
      "Field",
      "Value",
      "Message",
      "Country",
      "Device type",
      "Type approval",
      "Manufacturer",
      "Record id",
    ];
    const lines = shown.map((i: QualityIssue) =>
      [
        i.level,
        RULE_LABELS[i.rule],
        i.fieldLabel,
        i.value,
        i.message,
        i.country,
        i.deviceType,
        i.typeApproval,
        i.manufacturer,
        i.cardId,
      ]
        .map(csvCell)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.map(csvCell).join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tdh-data-quality-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isUnauthorized(q.error)) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Data quality is only available with a valid admin login.
        </CardContent>
      </Card>
    );
  }

  const sum = q.data?.summary;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-primary" /> Data quality
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Errors: mandatory fields empty (cards: country, generation, type approval number,
          manufacturer, application, date/status, JRC interoperability status; vehicle units and
          motion sensors: country, type approval number, manufacturer). Warnings: dates not readable
          as day/month/year, certificate expiry not after issue, card generation not G1/G2.1/G2.2,
          country not in the country list. Manual edits are taken into account.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setLevel(level === "error" ? "all" : "error")}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${level === "error" ? "border-red-400 bg-red-50 dark:bg-red-950" : ""}`}
          >
            <XCircle className="h-4 w-4 text-red-600" />
            <strong>{sum?.errors ?? "…"}</strong> error(s) in {sum?.recordsWithErrors ?? "…"}{" "}
            record(s)
          </button>
          <button
            type="button"
            onClick={() => setLevel(level === "warning" ? "all" : "warning")}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${level === "warning" ? "border-amber-400 bg-amber-50 dark:bg-amber-950" : ""}`}
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <strong>{sum?.warnings ?? "…"}</strong> warning(s) in {sum?.recordsWithWarnings ?? "…"}{" "}
            record(s)
          </button>
          <button
            type="button"
            onClick={() => setLevel(level === "info" ? "all" : "info")}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${level === "info" ? "border-sky-400 bg-sky-50 dark:bg-sky-950" : ""}`}
            title="Card approvals without a usable security certificate, or with a certificate family outside every platform line (Platform Timeline)"
          >
            <FileQuestion className="h-4 w-4 text-sky-600" />
            <strong>{sum?.infos ?? "…"}</strong> on the certificate maintenance list
          </button>
          <span className="text-muted-foreground">
            {sum ? `${sum.records} records checked` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={rule}
            onChange={(e) => setRule(e.target.value as QualityRule | "")}
          >
            <option value="">All rules</option>
            {(Object.keys(RULE_LABELS) as QualityRule[]).map((r) => (
              <option key={r} value={r}>
                {RULE_LABELS[r]} ({sum?.byRule[r] ?? 0})
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="">All device types</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <Input
            placeholder="Search country, approval, manufacturer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64"
          />
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              {q.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Recheck
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
              <Download className="mr-2 h-4 w-4" /> CSV ({shown.length})
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Level</th>
                <th className="px-2 py-1.5 font-medium">Record</th>
                <th className="px-2 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 font-medium">Finding</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Checking…
                  </td>
                </tr>
              )}
              {!q.isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    No findings for this filter.
                  </td>
                </tr>
              )}
              {shown.map((i, n) => (
                <tr
                  key={`${i.cardId}-${i.rule}-${i.field}-${n}`}
                  className={`border-t align-top ${onOpenCard ? "cursor-pointer hover:bg-muted/40" : ""}`}
                  onClick={() => onOpenCard?.(i.cardId)}
                  title={onOpenCard ? "Open the record" : undefined}
                >
                  <td className="px-2 py-1.5">
                    {i.level === "error" ? (
                      <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                        <XCircle className="h-3 w-3" /> ERROR
                      </span>
                    ) : i.level === "info" ? (
                      <span className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
                        <FileQuestion className="h-3 w-3" /> TODO
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        <AlertTriangle className="h-3 w-3" /> WARN
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">
                      {i.country || "—"} · {i.typeApproval || "no approval number"}
                    </div>
                    <div className="text-muted-foreground">
                      {i.deviceType} · {i.manufacturer || "—"}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">{i.fieldLabel}</td>
                  <td className="px-2 py-1.5">
                    <div>{i.message}</div>
                    <div className="text-muted-foreground">{RULE_LABELS[i.rule]}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {q.data?.computedAt && (
          <p className="text-[11px] text-muted-foreground">
            Checked {new Date(q.data.computedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
