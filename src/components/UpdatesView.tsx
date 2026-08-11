import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  checkJrcUpdates,
  approveJrcProposal,
  rejectJrcProposal,
} from "@/lib/jrc.functions";
import { RefreshCw, Check, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type FieldChange = { field: string; label: string; old: string; new: string };

const SOURCE_LABELS: Record<string, string> = {
  card_status: "Card status",
  other_certificates: "Other certificates",
  public_key_certificates: "Public key certificates",
  key_management: "Key management",
  security_updates: "Security updates",
};

const SOURCE_URLS: Record<string, string> = {
  card_status: "https://dtc.jrc.ec.europa.eu/dtc_card_status.php.html",
  other_certificates: "https://dtc.jrc.ec.europa.eu/dtc_other_certificates.php.html",
  public_key_certificates: "https://dtc.jrc.ec.europa.eu/dtc_public_key_certificates.php.html",
  key_management: "https://dtc.jrc.ec.europa.eu/dtc_key_management.php.html",
  security_updates: "https://dtc.jrc.ec.europa.eu/dtc_security_updates.php.html",
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
  const [showHandled, setShowHandled] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [newCountry, setNewCountry] = useState<Record<string, string>>({});

  const proposals = useQuery({
    queryKey: ["jrc_proposals"],
    queryFn: async (): Promise<Proposal[]> => {
      const { data, error } = await supabase
        .from("jrc_update_proposals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Proposal[];
    },
  });

  const lastRuns = useQuery({
    queryKey: ["jrc_last_run"],
    queryFn: async (): Promise<CheckRun[]> => {
      const { data, error } = await supabase
        .from("jrc_check_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as CheckRun[];
    },
  });


  const check = useServerFn(checkJrcUpdates);
  const approve = useServerFn(approveJrcProposal);
  const reject = useServerFn(rejectJrcProposal);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["jrc_proposals"] });
    qc.invalidateQueries({ queryKey: ["jrc_last_run"] });
    qc.invalidateQueries({ queryKey: ["tachograph_cards"] });
  };

  const checkMutation = useMutation({
    mutationFn: () => check(),
    onSuccess: (res) => {
      toast.success(
        `JRC check finished — ${res.rowsParsed} rows read, ${res.created} new proposal(s).`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(`Check failed: ${e.message}`),
  });

  const approveMutation = useMutation({
    mutationFn: (vars: { id: string; country: string }) =>
      approve({ data: vars }),
    onSuccess: () => {
      toast.success("Update applied to the database.");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Apply failed: ${e.message}`),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => reject({ data: { id } }),
    onSuccess: () => {
      toast.success("Proposal dismissed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Dismiss failed: ${e.message}`),
  });

  const all = proposals.data ?? [];
  const bySource = (p: Proposal) =>
    sourceFilter === "all" || (p.source_type ?? "card_status") === sourceFilter;
  const pending = all.filter((p) => p.status === "pending" && bySource(p));
  const handled = all.filter((p) => p.status !== "pending" && bySource(p));
  const list = showHandled ? handled : pending;

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
          <h2 className="text-xl font-semibold">JRC Updates</h2>
          <p className="text-sm text-muted-foreground">
            Monitors all JRC digital tachograph sources — card status, other
            certificates, public key certificates, key management and security
            updates. Nothing is written to the database until you approve it.
          </p>
        </div>
        <Button
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${checkMutation.isPending ? "animate-spin" : ""}`}
          />
          {checkMutation.isPending ? "Checking…" : "Check for updates"}
        </Button>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2 text-xs font-medium">
          <span>Monitored sources</span>
          <span className="text-muted-foreground">
            Last check:{" "}
            {lastCheckAt ? new Date(lastCheckAt).toLocaleString() : "never"}
          </span>
        </div>
        {Object.keys(SOURCE_LABELS).map((key) => {
          const run = latestBySource.get(key);
          return (
            <div
              key={key}
              className="grid gap-1 border-b px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[200px_1fr_auto] sm:items-center"
            >
              <span className="font-medium">{SOURCE_LABELS[key]}</span>
              <span className="text-muted-foreground">
                {run
                  ? run.message
                  : "not checked yet"}
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
          onClick={() => setShowHandled(false)}
        >
          Pending ({pending.length})
        </Button>
        <Button
          size="sm"
          variant={showHandled ? "default" : "outline"}
          onClick={() => setShowHandled(true)}
        >
          Handled ({handled.length})
        </Button>
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


      {proposals.isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {!proposals.isLoading && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {showHandled
            ? "No handled proposals yet."
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
                  <CardTitle className="text-base">
                    {p.title ||
                      (p.kind === "new"
                        ? `New JRC entry · ${p.jrc_type_approval || "—"}`
                        : `${p.country || "—"} · ${p.jrc_type_approval || "—"}`)}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {p.source_label || SOURCE_LABELS[p.source_type ?? "card_status"]}
                    </Badge>
                    {p.generation && <Badge variant="secondary">{p.generation}</Badge>}
                    <Badge variant={p.kind === "new" ? "default" : "outline"}>
                      {isInfo ? "Info" : p.kind === "new" ? "New entry" : "Changed"}
                    </Badge>
                    {p.status !== "pending" && (
                      <Badge variant="secondary">{p.status}</Badge>
                    )}
                  </div>
                </div>
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
                        <span className="text-muted-foreground line-through">
                          {f.old || "—"}
                        </span>
                        <span className="text-foreground">{f.new}</span>
                      </div>
                    ))}
                  </div>
                )}

                {p.status === "pending" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {p.kind === "new" && (
                      <Input
                        className="h-9 w-56"
                        placeholder="Country for new entry"
                        value={newCountry[p.id] ?? ""}
                        onChange={(e) =>
                          setNewCountry((s) => ({ ...s, [p.id]: e.target.value }))
                        }
                      />
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        approveMutation.mutate({
                          id: p.id,
                          country: newCountry[p.id] ?? "",
                        })
                      }
                      disabled={approveMutation.isPending}
                    >
                      <Check className="mr-2 h-4 w-4" /> Approve &amp; apply
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectMutation.mutate(p.id)}
                      disabled={rejectMutation.isPending}
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span>{value || "—"}</span>
    </div>
  );
}
