import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, CheckCircle2, FilePlus2, Loader2, RefreshCw, Wrench } from "lucide-react";
import {
  applyConsistencyFixesFn,
  getConsistency,
  proposeMissingJrcEntriesFn,
} from "@/lib/consistency.functions";
import {
  CONSISTENCY_RULE_LABELS,
  type ConsistencyIssue,
  type ConsistencyRule,
} from "@/lib/consistency";

// v2.77: Tools → Consistency. Records compared with each other and with the
// JRC listing; where the right value is known it is offered as a repair.

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /unauthori[sz]ed|401/i.test(msg);
}

const RULE_ORDER: ConsistencyRule[] = [
  "generation_vs_jrc",
  "date_vs_jrc",
  "duplicate",
  "country_spelling",
  "flag_mismatch",
  "date_missing",
  "status_missing",
  "override_noop",
  "placeholder_approval",
  "jrc_without_record",
];

const LEVEL_CLASS: Record<string, string> = {
  error:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
};

export function ConsistencyView({ onOpenCard }: { onOpenCard?: (cardId: string) => void }) {
  const qc = useQueryClient();
  const fetchConsistency = useServerFn(getConsistency);
  const applyFixes = useServerFn(applyConsistencyFixesFn);
  const proposeMissing = useServerFn(proposeMissingJrcEntriesFn);
  const q = useQuery({
    queryKey: ["consistency"],
    queryFn: () => fetchConsistency(),
    retry: false,
  });

  const [rule, setRule] = useState<"" | ConsistencyRule>("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const issues = useMemo(() => (q.data?.issues ?? []) as ConsistencyIssue[], [q.data]);
  const sum = q.data?.summary;
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return issues
      .filter((i) => (rule ? i.rule === rule : i.rule !== "jrc_without_record"))
      .filter(
        (i) =>
          !s ||
          [i.country, i.typeApproval, i.manufacturer, i.deviceType, i.message]
            .join(" ")
            .toLowerCase()
            .includes(s),
      )
      .sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
  }, [issues, rule, search]);

  const refreshAll = async () => {
    await Promise.all(
      [
        "consistency",
        "tachograph_cards",
        "tachograph_card_overrides",
        "data_quality",
        "card_field_history",
        "jrc_proposals",
      ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
  };

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.success(await fn());
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const applyOne = (i: ConsistencyIssue) =>
    run(i.id, async () => {
      const r = await applyFixes({ data: { ids: [i.id] } });
      return r.applied > 0
        ? "Repair applied"
        : "Nothing to repair any more — the list was refreshed";
    });

  const applySafe = () => {
    const n = sum?.safe ?? 0;
    if (!window.confirm(`Apply all ${n} safe repair(s)? Each one is recorded; nothing is deleted.`))
      return;
    void run("safe", async () => {
      const r = await applyFixes({ data: { allSafe: true } });
      return `${r.applied} repair(s) applied to ${r.records} record(s)`;
    });
  };

  const missing = sum?.byRule["jrc_without_record"] ?? 0;
  const propose = () => {
    if (
      !window.confirm(
        `Create ${missing} proposal(s) in the Update Monitor for JRC entries without a record? ` +
          "Nothing is written to Data until you approve them there.",
      )
    )
      return;
    void run("propose", async () => {
      const r = await proposeMissing({ data: {} });
      return r.created > 0
        ? `${r.created} proposal(s) created — see Update Monitor`
        : "No new proposals — they already exist in the Update Monitor";
    });
  };

  if (isUnauthorized(q.error)) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          The consistency check is only available with a valid admin login.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" /> Consistency check and repair
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Compares the records with each other and with the JRC listing of the last update run
          {q.data?.listingUpdatedAt
            ? ` (${new Date(q.data.listingUpdatedAt).toLocaleString()})`
            : ""}
          . Safe repairs follow from the data itself (a flag from its country, an empty field from
          the JRC entry, a manual edit that repeats the stored value) and can be applied together.
          The others change a stored value and are applied one by one. Every repair is recorded in
          the change history of its record.
        </p>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setRule("")}
            className={`rounded-md border px-2.5 py-1 ${rule === "" ? "border-primary bg-primary/10" : ""}`}
          >
            <strong>{sum ? sum.issues - missing : "…"}</strong> finding(s) in {sum?.records ?? "…"}{" "}
            records
          </button>
          {RULE_ORDER.filter((r) => (sum?.byRule[r] ?? 0) > 0).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRule(rule === r ? "" : r)}
              className={`rounded-md border px-2.5 py-1 ${rule === r ? "border-primary bg-primary/10" : ""}`}
            >
              {CONSISTENCY_RULE_LABELS[r]} <strong>{sum?.byRule[r]}</strong>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country, approval, manufacturer…"
            className="h-8 w-64"
          />
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Check again
          </Button>
          <Button size="sm" onClick={applySafe} disabled={!sum?.safe || busy !== null}>
            {busy === "safe" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Apply {sum?.safe ?? 0} safe repair(s)
          </Button>
          {missing > 0 && (
            <Button size="sm" variant="outline" onClick={propose} disabled={busy !== null}>
              {busy === "propose" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FilePlus2 className="mr-2 h-4 w-4" />
              )}
              Propose {missing} JRC entr{missing === 1 ? "y" : "ies"} without a record
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{shown.length} shown</span>
        </div>

        {q.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        ) : q.error ? (
          <p className="py-4 text-sm text-red-600">
            {q.error instanceof Error ? q.error.message : "The check failed."}
          </p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {issues.length === 0 ? "No contradictions found." : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Finding</th>
                  <th className="px-3 py-2 font-medium">Record</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                  <th className="px-3 py-2 font-medium">Repair</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((i) => (
                  <tr key={i.id} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-md border px-1.5 py-0.5 text-xs ${LEVEL_CLASS[i.level]}`}
                      >
                        {CONSISTENCY_RULE_LABELS[i.rule]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {i.cardId && onOpenCard ? (
                        <button
                          type="button"
                          className="text-left text-primary underline-offset-2 hover:underline"
                          onClick={() => onOpenCard(i.cardId!)}
                        >
                          {i.country || "—"} · {i.typeApproval || "—"}
                        </button>
                      ) : (
                        <span>{i.typeApproval || "—"}</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {[i.deviceType, i.generation, i.manufacturer].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{i.message}</td>
                    <td className="px-3 py-2">
                      {i.fix ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {i.fix.kind === "set" ? (
                            <span className="text-xs">
                              {i.fix.label}:{" "}
                              <span className="text-muted-foreground line-through">
                                {i.fix.old || "—"}
                              </span>{" "}
                              <ArrowRight className="inline h-3 w-3" /> <strong>{i.fix.new}</strong>
                            </span>
                          ) : (
                            <span className="text-xs">Remove the manual edit</span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={busy !== null}
                            onClick={() => applyOne(i)}
                          >
                            {busy === i.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Apply"
                            )}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {i.rule === "jrc_without_record"
                            ? "Create via proposal"
                            : "Decide by hand"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 400 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Showing the first 400 of {shown.length} — narrow the list with a filter.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
