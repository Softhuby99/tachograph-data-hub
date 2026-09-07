import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  checkUpdates,
  checkUpdateSource,
  approveJrcProposal,
  rejectJrcProposal,
  reopenJrcProposal,
  markJrcProposalsReviewed,
  getProposals,
  getCheckRuns,
} from "@/lib/jrc.functions";
import { getAuthMode } from "@/lib/auth-mode.functions";
import { documentedCountry, resolveTaCountry, taPrefix } from "@/lib/ta-country";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Check, X, ExternalLink, ListChecks, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

type FieldChange = { field: string; label: string; old: string; new: string };

const SOURCE_LABELS: Record<string, string> = {
  card_status: "Card status",
  other_certificates: "Other certificates",
  public_key_certificates: "Public key certificates",
  key_management: "Key management",
  security_updates: "Security updates",
  manufacturer_codes: "Manufacturer codes",
  cc_certificates: "Common Criteria certificates",
  ted_procurement: "TED procurement",
};

const SOURCE_URLS: Record<string, string> = {
  card_status: "https://dtc.jrc.ec.europa.eu/dtc_card_status.php.html",
  other_certificates: "https://dtc.jrc.ec.europa.eu/dtc_other_certificates.php.html",
  public_key_certificates: "https://dtc.jrc.ec.europa.eu/dtc_public_key_certificates_dt.php.html",
  key_management: "https://dtc.jrc.ec.europa.eu/dtc_key_management_status_dt.php.html",
  security_updates: "https://dtc.jrc.ec.europa.eu/dtc_mandatory_security_software_updates.php.html",
  manufacturer_codes: "https://dtc.jrc.ec.europa.eu/dtc_manufacturer_code.php.html",
  cc_certificates: "https://www.commoncriteriaportal.org/products/index.cfm",
  ted_procurement: "https://ted.europa.eu/en/search/result",
};

type Proposal = {
  id: string;
  kind: string;
  card_id: string | null;
  country: string;
  generation: string;
  jrc_manufacturer: string;
  jrc_card_name: string;
  jrc_certificate: string;
  jrc_date: string;
  jrc_eov: string;
  jrc_type_approval: string;
  source_url: string;
  source_type: string | null;
  source_label: string | null;
  title: string | null;
  payload: Record<string, string> | null;
  changes: { fields?: FieldChange[] } | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
};

type CheckRun = {
  id: string;
  created_at: string;
  source_type: string | null;
  source_url: string;
  rows_parsed: number;
  proposals_created: number;
  status: string;
  message: string;
};

export function UpdatesView() {
  const qc = useQueryClient();
  const { session, loading: authLoading } = useAuth();
  const fetchAuthMode = useServerFn(getAuthMode);
  const authMode = useQuery({
    queryKey: ["auth_mode"],
    queryFn: () => fetchAuthMode(),
  });
  const authEnabled = authMode.data?.enabled ?? true;
  const signedIn = !authEnabled || !!session;
  const [showHandled, setShowHandled] = useState(false);
  // Working through dozens of handled entries needs a way to hide the ones
  // already gone through; without it every pass starts at the top again.
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [newCountry, setNewCountry] = useState<Record<string, string>>({});

  const fetchProposals = useServerFn(getProposals);
  const proposals = useQuery({
    queryKey: ["jrc_proposals"],
    queryFn: async (): Promise<Proposal[]> => (await fetchProposals()) as Proposal[],
  });

  const fetchCheckRuns = useServerFn(getCheckRuns);
  const lastRuns = useQuery({
    queryKey: ["jrc_last_run"],
    queryFn: async (): Promise<CheckRun[]> => (await fetchCheckRuns()) as CheckRun[],
  });

  const check = useServerFn(checkUpdates);
  const checkOne = useServerFn(checkUpdateSource);
  const approve = useServerFn(approveJrcProposal);
  const reopen = useServerFn(reopenJrcProposal);
  const reject = useServerFn(rejectJrcProposal);
  const markReviewed = useServerFn(markJrcProposalsReviewed);

  const [running, setRunning] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [sourceState, setSourceState] = useState<
    Record<string, "running" | "updated" | "clean" | "error">
  >({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["jrc_proposals"] });
    qc.invalidateQueries({ queryKey: ["jrc_last_run"] });
    qc.invalidateQueries({ queryKey: ["tachograph_cards"] });
    qc.invalidateQueries({ queryKey: ["card_field_history"] });
  };

  const runCheck = async () => {
    setRunning(true);
    setSourceState({});
    let created = 0;
    let rows = 0;
    try {
      for (const key of Object.keys(SOURCE_LABELS)) {
        setActiveSource(key);
        setSourceState((s) => ({ ...s, [key]: "running" }));
        try {
          const res = await checkOne({ data: { source: key } });
          rows += res.rowsParsed ?? 0;
          created += res.created ?? 0;
          setSourceState((s) => ({
            ...s,
            [key]: res.error ? "error" : res.created > 0 ? "updated" : "clean",
          }));
        } catch (e) {
          setSourceState((s) => ({ ...s, [key]: "error" }));
          toast.error(
            `${SOURCE_LABELS[key]} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      toast.success(`Check finished — ${rows} rows read, ${created} new proposal(s).`);
    } finally {
      setActiveSource(null);
      setRunning(false);
      // Only sources with new findings stay highlighted; the rest go back to normal.
      setSourceState((s) =>
        Object.fromEntries(Object.entries(s).filter(([, v]) => v === "updated" || v === "error")),
      );
      invalidate();
    }
  };

  void check;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const approveMutation = useMutation({
    mutationFn: (vars: { id: string; country: string }) => approve({ data: vars }),
    onSuccess: () => {
      toast.success("Update applied to the database.");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Apply failed: ${e.message}`),
  });

  // A handled proposal used to be a dead end: dismissed by accident, or applied
  // against the wrong card, and there was no way back — re-running the check
  // does not resurface it, because its fingerprint is remembered on purpose.
  const reopenMutation = useMutation({
    mutationFn: (id: string) => reopen({ data: { id } }),
    onSuccess: () => {
      toast.success("Proposal moved back to pending.");
      setShowHandled(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(`Reopen failed: ${e.message}`),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => reject({ data: { id } }),
    onSuccess: () => {
      toast.success("Proposal dismissed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Dismiss failed: ${e.message}`),
  });

  const reviewMutation = useMutation({
    mutationFn: (vars: { ids: string[]; reviewed: boolean }) => markReviewed({ data: vars }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.reviewed
          ? `${vars.ids.length} entr${vars.ids.length === 1 ? "y" : "ies"} marked as checked.`
          : "Check mark removed.",
      );
      setSelected(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(`Could not save the check mark: ${e.message}`),
  });

  const all = proposals.data ?? [];
  const bySource = (p: Proposal) =>
    sourceFilter === "all" || (p.source_type ?? "card_status") === sourceFilter;
  const pending = all.filter((p) => p.status === "pending" && bySource(p));

  // ---- bulk approval ----------------------------------------------------
  //
  // With 21 country conflicts plus a steady trickle of new entries, approving
  // one at a time is a lot of clicking. Selection is deliberately restricted to
  // proposals that need no judgement call: a field change on an existing card,
  // or a new entry whose country is documented. Anything that would need a
  // country typed in stays a single, deliberate approval.

  /** Country that would be applied — empty when none is documented. */
  const countryFor = (p: Proposal) =>
    newCountry[p.id] ?? p.country ?? documentedCountry(p.jrc_type_approval ?? "")?.country ?? "";

  /** Device type the source reported for a proposal; cards are the default. */
  const deviceOf = (p: Proposal) => {
    const d = (p.payload ?? {})["Device type"] ?? "";
    return d === "Vehicle Unit" || d === "Motion Sensor" ? d : "Card";
  };

  const isChangeProposal = (p: Proposal) =>
    !!p.card_id && (p.changes?.fields?.length ?? 0) > 0 && p.kind !== "info";

  const bulkEligible = pending.filter(
    (p) => isChangeProposal(p) || countryFor(p).trim() !== "" || deviceOf(p) !== "Card",
  );

  const handledAll = all.filter((p) => p.status !== "pending" && bySource(p));
  const isReviewed = (p: Proposal) => !!p.reviewed_at;
  const handledUnreviewed = handledAll.filter((p) => !isReviewed(p));
  const handled = onlyUnreviewed ? handledUnreviewed : handledAll;
  const list = showHandled ? handled : pending;

  // What may be ticked. On the pending list only the proposals that need no
  // judgement call; in the handled list every entry, because the point there is
  // to work through a backlog — read a batch, then decide on it in one go.
  const selectable = showHandled ? handled : bulkEligible;
  const selectedProposals = selectable.filter((p) => selected.has(p.id));
  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const switchTab = (toHandled: boolean) => {
    // A selection made in one list must not carry over into the other; the
    // bulk action there would mean something different.
    setSelected(new Set());
    setShowHandled(toHandled);
  };

  const runBulkApprove = async () => {
    setBulkRunning(true);
    let done = 0;
    const failed: string[] = [];
    for (const p of selectedProposals) {
      try {
        // A handled proposal has to go back to pending before it can be
        // applied — approveProposal refuses anything else on purpose, so that
        // an already applied change is never written a second time by accident.
        if (p.status !== "pending") await reopen({ data: { id: p.id } });
        await approve({ data: { id: p.id, country: countryFor(p) } });
        done++;
      } catch (e) {
        failed.push(`${p.title || p.jrc_type_approval || p.id}: ${(e as Error).message}`);
      }
    }
    setBulkRunning(false);
    setBulkOpen(false);
    setSelected(new Set());
    invalidate();
    if (failed.length === 0) {
      toast.success(`${done} proposal(s) applied.`);
    } else {
      // Reopening happens before applying, so a failure leaves that entry on
      // the pending list. Say so — otherwise it looks like it vanished.
      toast.error(
        `${done} applied, ${failed.length} failed and are now pending. First: ${failed[0]}`,
      );
    }
  };

  // One row per source: the newest run recorded for it.
  const latestBySource = new Map<string, CheckRun>();
  for (const run of lastRuns.data ?? []) {
    const key = run.source_type ?? "card_status";
    if (!latestBySource.has(key)) latestBySource.set(key, run);
  }
  const lastCheckAt = (lastRuns.data ?? [])[0]?.created_at;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Update Monitor</h2>
          <p className="text-sm text-muted-foreground">
            Monitors all JRC digital tachograph sources — card status, other certificates, public
            key certificates, key management and security updates. Nothing is written to the
            database until you approve it.
          </p>
        </div>
        <Button onClick={() => void runCheck()} disabled={running || !signedIn}>
          <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running
            ? `Checking ${activeSource ? SOURCE_LABELS[activeSource] : ""}…`
            : "Check for updates"}
        </Button>
      </div>

      {!authLoading && !signedIn && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Sign in to run update checks and approve or dismiss proposals. The list below stays
            readable without signing in.
          </span>
          <Button size="sm" asChild>
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2 text-xs font-medium">
          <span>Monitored sources</span>
          <span className="text-muted-foreground">
            Auto-check daily 03:00 UTC · Last check:{" "}
            {lastCheckAt ? new Date(lastCheckAt).toLocaleString() : "never"}
          </span>
        </div>
        {Object.keys(SOURCE_LABELS).map((key) => {
          const run = latestBySource.get(key);
          const state = sourceState[key];
          const rowClass =
            state === "running"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : state === "updated"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : state === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "";
          return (
            <div
              key={key}
              className={`grid gap-1 border-b px-3 py-2 text-xs transition-colors last:border-b-0 sm:grid-cols-[200px_1fr_auto] sm:items-center ${rowClass}`}
            >
              <span className="flex items-center gap-2 font-medium">
                {state === "running" && <RefreshCw className="h-3 w-3 animate-spin" />}
                {state === "updated" && <Check className="h-3 w-3" />}
                {SOURCE_LABELS[key]}
              </span>
              <span className={state ? "" : "text-muted-foreground"}>
                {state === "running" ? "Checking…" : run ? run.message : "not checked yet"}
              </span>
              <a
                className="inline-flex items-center gap-1 text-primary hover:underline"
                href={SOURCE_URLS[key]}
                target="_blank"
                rel="noreferrer"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={showHandled ? "outline" : "default"}
          onClick={() => switchTab(false)}
        >
          Pending ({pending.length})
        </Button>
        <Button
          size="sm"
          variant={showHandled ? "default" : "outline"}
          onClick={() => switchTab(true)}
        >
          Handled ({handledAll.length})
        </Button>
        {showHandled && (
          <Button
            size="sm"
            variant={onlyUnreviewed ? "secondary" : "ghost"}
            onClick={() => {
              setSelected(new Set());
              setOnlyUnreviewed((v) => !v);
            }}
            title="Show only entries nobody has marked as checked yet"
          >
            <EyeOff className="mr-2 h-4 w-4" />
            Not checked yet ({handledUnreviewed.length})
          </Button>
        )}
        <span className="mx-1 h-8 w-px bg-border" />
        <Button
          size="sm"
          variant={sourceFilter === "all" ? "secondary" : "ghost"}
          onClick={() => setSourceFilter("all")}
        >
          All sources
        </Button>
        {Object.entries(SOURCE_LABELS).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={sourceFilter === key ? "secondary" : "ghost"}
            onClick={() => setSourceFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {selectable.length > 0 && signedIn && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">
            {selected.size > 0
              ? `${selected.size} of ${selectable.length} selected`
              : showHandled
                ? `${selectable.length} handled entr${selectable.length === 1 ? "y" : "ies"} — tick what you go through, decide at the end`
                : `${selectable.length} proposal(s) can be applied without typing a country`}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set(selectable.map((p) => p.id)))}
          >
            Select all
          </Button>
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              {showHandled && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      reviewMutation.mutate({
                        ids: selectedProposals.map((p) => p.id),
                        reviewed: true,
                      })
                    }
                    disabled={reviewMutation.isPending}
                  >
                    <Eye className="mr-2 h-4 w-4" /> Mark checked ({selected.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      reviewMutation.mutate({
                        ids: selectedProposals.map((p) => p.id),
                        reviewed: false,
                      })
                    }
                    disabled={reviewMutation.isPending}
                  >
                    <EyeOff className="mr-2 h-4 w-4" /> Unmark
                  </Button>
                </>
              )}
              <Button size="sm" onClick={() => setBulkOpen(true)}>
                <Check className="mr-2 h-4 w-4" /> Review &amp; apply ({selected.size})
              </Button>
            </>
          )}
          <span className="text-xs text-muted-foreground">
            {showHandled
              ? "Applying a handled entry puts it back on the list first and then writes it — an entry that cannot be applied stays pending."
              : "Only field changes and new entries with a documented country are selectable — the rest stay a deliberate single approval."}
          </span>
        </div>
      )}

      <Dialog open={bulkOpen} onOpenChange={(o) => !bulkRunning && setBulkOpen(o)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply {selectedProposals.length} proposal(s)</DialogTitle>
            <DialogDescription>
              Everything below is written to the database and recorded in each card&apos;s change
              history. Check the countries before confirming.
              {selectedProposals.some((p) => p.status === "approved") && (
                <span className="mt-2 block text-amber-600 dark:text-amber-400">
                  {selectedProposals.filter((p) => p.status === "approved").length} of these were
                  already applied once. Applying again writes the same values a second time — for a
                  new entry that means a second record.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Type Approval</th>
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">What changes</th>
              </tr>
            </thead>
            <tbody>
              {selectedProposals.map((p) => (
                <tr key={p.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.jrc_type_approval || "—"}</td>
                  <td className="py-2 pr-4">{countryFor(p) || "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{p.source_label}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {p.status === "pending"
                      ? "pending"
                      : p.status === "approved"
                        ? "already applied"
                        : "dismissed"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {(p.changes?.fields ?? []).length > 0
                      ? (p.changes?.fields ?? []).map((f) => f.label).join(", ")
                      : "New entry"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>
              Cancel
            </Button>
            <Button onClick={runBulkApprove} disabled={bulkRunning}>
              {bulkRunning ? "Applying…" : `Apply ${selectedProposals.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {proposals.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!proposals.isLoading && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {showHandled
            ? onlyUnreviewed
              ? "Everything handled has been checked off."
              : "No handled proposals yet."
            : "No pending updates. Run a check to look for new JRC entries."}
        </p>
      )}

      <div className="space-y-4">
        {list.map((p) => {
          const fields = p.changes?.fields ?? [];
          const isInfo = p.kind === "info";
          const payload = p.payload ?? {};
          return (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {signedIn && selectable.some((e) => e.id === p.id) && (
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleSelected(p.id)}
                        aria-label="Select for bulk approval"
                      />
                    )}
                    {p.title ||
                      (p.kind === "new"
                        ? `New JRC entry · ${p.country ? `${p.country} · ` : ""}${p.jrc_type_approval || "—"}`
                        : `${p.country || "—"} · ${p.jrc_type_approval || "—"}`)}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {p.source_label || SOURCE_LABELS[p.source_type ?? "card_status"]}
                    </Badge>
                    {(p.country ||
                      (p.payload ?? {})["Resolved country"] ||
                      (p.payload ?? {})["Certification country"]) && (
                      <Badge variant="secondary">
                        {p.country ||
                          (p.payload ?? {})["Resolved country"] ||
                          (p.payload ?? {})["Certification country"]}
                      </Badge>
                    )}
                    {(p.payload ?? {})["Device type"] && (
                      <Badge variant="secondary">{(p.payload ?? {})["Device type"]}</Badge>
                    )}
                    {p.generation && <Badge variant="secondary">{p.generation}</Badge>}

                    <Badge variant={p.kind === "new" ? "default" : "outline"}>
                      {isInfo ? "Info" : p.kind === "new" ? "New entry" : "Changed"}
                    </Badge>
                    {p.status !== "pending" && <Badge variant="secondary">{p.status}</Badge>}
                    {p.status !== "pending" &&
                      (p.reviewed_at ? (
                        <Badge variant="outline" className="gap-1">
                          <Eye className="h-3 w-3" /> Checked
                        </Badge>
                      ) : (
                        <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
                          <EyeOff className="h-3 w-3" /> Not checked
                        </Badge>
                      ))}
                  </div>
                </div>
                {/* Going through the handled list needs dates: when the finding
                    turned up, when it was last decided, and whether anyone has
                    already read it. Without them every pass starts blind. */}
                <p className="pt-1 text-xs text-muted-foreground">
                  Found {fmtStamp(p.created_at)}
                  {p.updated_at && p.updated_at !== p.created_at && (
                    <> · Last change {fmtStamp(p.updated_at)}</>
                  )}
                  {p.reviewed_at && <> · Checked {fmtStamp(p.reviewed_at)}</>}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {isInfo ? (
                  <div className="grid gap-1 text-sm sm:grid-cols-2">
                    {Object.entries(payload).map(([k, v]) => (
                      <Detail key={k} label={k} value={v} />
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-1 text-sm sm:grid-cols-2">
                    <Detail label="Manufacturer (JRC)" value={p.jrc_manufacturer} />
                    <Detail label="Card (JRC)" value={p.jrc_card_name} />
                    <Detail label="Certificate" value={p.jrc_certificate} />
                    <Detail label="Date / EOV" value={`${p.jrc_date} / ${p.jrc_eov}`} />
                  </div>
                )}

                {fields.length > 0 && (
                  <div className="rounded-md border">
                    <div className="grid grid-cols-3 gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium">
                      <span>Field</span>
                      <span>Current</span>
                      <span>Proposed</span>
                    </div>
                    {fields.map((f) => (
                      <div
                        key={f.field}
                        className="grid grid-cols-3 gap-2 border-b px-3 py-2 text-xs last:border-b-0"
                      >
                        <span className="font-medium">{f.label}</span>
                        <span className="text-muted-foreground line-through">{f.old || "—"}</span>
                        <span className="text-foreground">{f.new}</span>
                      </div>
                    ))}
                  </div>
                )}

                {p.status !== "pending" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={p.status === "approved" ? "secondary" : "outline"}>
                      {p.status === "approved" ? "Applied" : "Dismissed"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reopenMutation.mutate(p.id)}
                      disabled={reopenMutation.isPending || !signedIn}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" /> Review again
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        reviewMutation.mutate({ ids: [p.id], reviewed: !p.reviewed_at })
                      }
                      disabled={reviewMutation.isPending || !signedIn}
                    >
                      {p.reviewed_at ? (
                        <>
                          <EyeOff className="mr-2 h-4 w-4" /> Mark unchecked
                        </>
                      ) : (
                        <>
                          <Eye className="mr-2 h-4 w-4" /> Mark checked
                        </>
                      )}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {p.status === "approved"
                        ? "Reviewing again does not undo what was written — it offers the decision once more."
                        : "Moves this proposal back to the pending list."}
                    </span>
                  </div>
                )}

                {p.status === "pending" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {(p.kind === "new" || (isInfo && !p.country)) &&
                      (() => {
                        // Only a documented resolution may pre-fill the field. The issuer
                        // prefix names the approval authority, not the card's country — in
                        // roughly three of four documented cases the two differ, so offering
                        // it as a default would write wrong data on a single click.
                        const documented = documentedCountry(p.jrc_type_approval ?? "");
                        const prefill = newCountry[p.id] ?? p.country ?? documented?.country ?? "";
                        const issuer = prefill ? null : resolveTaCountry(p.jrc_type_approval ?? "");
                        return (
                          <div className="flex flex-col gap-1">
                            <Input
                              className="h-9 w-56"
                              placeholder={
                                deviceOf(p) !== "Card"
                                  ? `Country (optional for a ${deviceOf(p).toLowerCase()})`
                                  : isInfo
                                    ? "Country to note this on"
                                    : "Country for new entry"
                              }
                              value={prefill}
                              onChange={(e) =>
                                setNewCountry((s) => ({ ...s, [p.id]: e.target.value }))
                              }
                            />
                            {documented?.evidence && (
                              <span className="text-[11px] text-muted-foreground">
                                Documented: {documented.evidence.slice(0, 70)}
                              </span>
                            )}
                            {issuer?.country && (
                              <button
                                type="button"
                                className="text-left text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                onClick={() =>
                                  setNewCountry((s) => ({ ...s, [p.id]: issuer.country }))
                                }
                              >
                                Issued by the authority of {issuer.country} (
                                {taPrefix(p.jrc_type_approval ?? "")}) — not evidence for the
                                card&apos;s country. Click to use anyway.
                              </button>
                            )}
                          </div>
                        );
                      })()}

                    <Button
                      size="sm"
                      onClick={() =>
                        approveMutation.mutate({
                          id: p.id,
                          // No issuer-prefix fallback here either: an unedited field
                          // must stay empty rather than silently store the authority's
                          // country as the card's country.
                          country:
                            newCountry[p.id] ??
                            p.country ??
                            documentedCountry(p.jrc_type_approval ?? "")?.country ??
                            "",
                        })
                      }
                      disabled={approveMutation.isPending || !signedIn}
                    >
                      <Check className="mr-2 h-4 w-4" />{" "}
                      {deviceOf(p) !== "Card"
                        ? `Approve & add ${deviceOf(p).toLowerCase()}`
                        : isInfo
                          ? "Acknowledge & note"
                          : "Approve & apply"}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectMutation.mutate(p.id)}
                      disabled={rejectMutation.isPending || !signedIn}
                    >
                      <X className="mr-2 h-4 w-4" /> Dismiss
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** Short local date+time; an unparseable or missing stamp shows as a dash. */
function fmtStamp(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span>{value || "—"}</span>
    </div>
  );
}
