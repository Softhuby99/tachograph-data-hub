import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  saveCardOverride,
  importCards,
  resetCardOverride,
  getCards,
  getOverrides,
} from "@/lib/cards.functions";
import { getCurrentListing } from "@/lib/market.functions";
import {
  computeMarketStatus,
  topCardApprovalByCountry,
  type CurrentListingEntry,
} from "@/lib/market-status";
import { getAuthMode } from "@/lib/auth-mode.functions";
import { APP_VERSION } from "@/lib/version";
import { flagUrl } from "@/lib/country-flag";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UpdatesView } from "@/components/UpdatesView";
import {
  ShieldCheck,
  FileText,
  BarChart3,
  RefreshCw,
  Globe2,
  Wrench,
  BookOpen,
  FileBarChart,
} from "lucide-react";
import { type TimelineFocus } from "@/components/PlatformTimelineView";
import { parseCertificate } from "@/lib/cert-family";
import { WorldMapView } from "@/components/WorldMapView";
import { ToolsView } from "@/components/ToolsView";
import { InfoView } from "@/components/InfoView";
import { ReportsView } from "@/components/ReportsView";
import { getEventOverview, verifyAdminLogin } from "@/lib/events.functions";
import { AnalyticsView } from "@/components/tacho/AnalyticsView";
import { DataView } from "@/components/tacho/DataView";
import { EditConflictDialog, type SaveEditResult } from "@/components/tacho/EditConflictDialog";
import { RecordDetailDialog } from "@/components/tacho/RecordDetailDialog";
import { type Overrides, type TachoCard } from "@/components/tacho/types";

function useOverrides() {
  const fetchOverrides = useServerFn(getOverrides);
  return useQuery({
    queryKey: ["tachograph_card_overrides"],
    queryFn: async (): Promise<Overrides> => {
      const rows = await fetchOverrides();
      const map: Overrides = {};
      for (const row of rows ?? []) {
        map[row.card_id] = (row.patch ?? {}) as Partial<TachoCard>;
      }
      return map;
    },
  });
}

function useCards() {
  const fetchCards = useServerFn(getCards);
  return useQuery({
    queryKey: ["tachograph_cards"],
    queryFn: async (): Promise<TachoCard[]> => {
      const data = await fetchCards();
      return data as TachoCard[];
    },
  });
}

/** "What's currently listed on JRC" mirror — see jrc_current_listing / migration 0006. */
function useCurrentListing() {
  const fetchListing = useServerFn(getCurrentListing);
  return useQuery({
    queryKey: ["jrc_current_listing"],
    queryFn: async (): Promise<CurrentListingEntry[]> => {
      const rows = await fetchListing();
      return rows as CurrentListingEntry[];
    },
  });
}

function useAuthMode() {
  const fetchMode = useServerFn(getAuthMode);
  return useQuery({
    queryKey: ["auth_mode"],
    queryFn: async () => fetchMode(),
  });
}

export function TachographTool() {
  const { data: rawCards, isLoading, error } = useCards();
  const auth = useAuth();
  const authMode = useAuthMode();
  const authEnabled = authMode.data?.enabled ?? true;
  const adminRequired = authMode.data?.adminRequired ?? false;
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminInput, setAdminInput] = useState("");
  // In local mode with ADMIN_TOKEN: can edit only after entering the token.
  // In Supabase mode: can edit with a session.
  // In local mode without ADMIN_TOKEN: always can edit.
  const adminUnlocked = !adminRequired || !!adminToken;
  const canEdit = adminUnlocked && (!authEnabled || !!auth.session);
  const qc = useQueryClient();
  const [tab, setTab] = useState<
    "data" | "map" | "analytics" | "reports" | "updates" | "info" | "tools"
  >("data");
  // v2.55: record → Platform Timeline link.
  const [timelineFocus, setTimelineFocus] = useState<TimelineFocus>(null);
  // v2.54: a manual edit that collided with someone else's change.
  const [editConflict, setEditConflict] = useState<{
    cardId: string;
    conflicts: { field: string; original: string; theirs: string; yours: string }[];
    changes: Record<string, string>;
    expected: Record<string, string>;
  } | null>(null);
  // v2.53: record opened from Tools → Data quality (read-only window).
  const [toolsRecordId, setToolsRecordId] = useState<string | null>(null);
  const overridesQuery = useOverrides();
  const overrides = useMemo(() => overridesQuery.data ?? {}, [overridesQuery.data]);

  const saveOverrideFn = useServerFn(saveCardOverride);
  const importCardsFn = useServerFn(importCards);

  const handleImport = async (rows: Record<string, string>[]) => {
    const res = await importCardsFn({ data: { rows } });
    await qc.invalidateQueries({ queryKey: ["tachograph_cards"] });
    await qc.invalidateQueries({ queryKey: ["tachograph_card_overrides"] });
    await qc.invalidateQueries({ queryKey: ["data_quality"] });
    return res;
  };
  const resetOverrideFn = useServerFn(resetCardOverride);

  const cards = useMemo(
    () => (rawCards ?? []).map((c) => ({ ...c, ...(overrides[c.id] ?? {}) })) as TachoCard[],
    [rawCards, overrides],
  );

  const currentListingQuery = useCurrentListing();
  const currentListing = useMemo(() => currentListingQuery.data ?? [], [currentListingQuery.data]);
  const marketStatus = useMemo(
    () => computeMarketStatus(cards, currentListing),
    [cards, currentListing],
  );
  const topApprovalByCountry = useMemo(
    () => topCardApprovalByCountry(marketStatus.groups),
    [marketStatus],
  );

  // The Data tab owns the filter controls; it reports the resulting ids here so
  // the Tools tab can export exactly the view the user is looking at.
  const [filteredIds, setFilteredIds] = useState<string[] | null>(null);
  const filteredCards = useMemo(() => {
    if (!filteredIds) return cards;
    const wanted = new Set(filteredIds);
    return cards.filter((c) => wanted.has(c.id));
  }, [cards, filteredIds]);

  const saveMutation = useMutation({
    mutationFn: async (vars: {
      cardId: string;
      patch?: Record<string, string>;
      changes?: Record<string, string>;
      expected?: Record<string, string>;
    }) => (await saveOverrideFn({ data: vars })) as SaveEditResult | undefined,
    onSuccess: (res, vars) => {
      if (res && res.ok === false) {
        setEditConflict({
          cardId: vars.cardId,
          conflicts: res.conflicts,
          changes: vars.changes ?? {},
          expected: vars.expected ?? {},
        });
        void qc.invalidateQueries({ queryKey: ["tachograph_card_overrides"] });
        return;
      }
      toast.success("Changes saved for everyone.");
      void qc.invalidateQueries({ queryKey: ["tachograph_card_overrides"] });
      void qc.invalidateQueries({ queryKey: ["data_quality"] });
      void qc.invalidateQueries({ queryKey: ["card_field_history"] });
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });

  const resetMutation = useMutation({
    mutationFn: (cardId: string) => resetOverrideFn({ data: { cardId } }),
    onSuccess: () => {
      toast.success("Manual edits removed.");
      void qc.invalidateQueries({ queryKey: ["tachograph_card_overrides"] });
      void qc.invalidateQueries({ queryKey: ["data_quality"] });
      void qc.invalidateQueries({ queryKey: ["card_field_history"] });
    },
    onError: (e: Error) => toast.error(`Reset failed: ${e.message}`),
  });

  const saveOverride = (
    id: string,
    patch: Partial<TachoCard>,
    original?: Record<string, string>,
  ) => {
    // v2.54 (code review 18): send only what the editor changed, together with
    // the value they started from.
    if (original) {
      const changes: Record<string, string> = {};
      const expected: Record<string, string> = {};
      for (const [k, v] of Object.entries(patch)) {
        const now = String(v ?? "");
        if (now !== (original[k] ?? "")) {
          changes[k] = now;
          expected[k] = original[k] ?? "";
        }
      }
      if (Object.keys(changes).length === 0) return;
      saveMutation.mutate({ cardId: id, changes, expected });
      return;
    }
    const base = rawCards?.find((c) => c.id === id);
    if (!base) return;
    const cleanedPatch: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== (base as Record<string, unknown>)[k]) cleanedPatch[k] = String(v ?? "");
    }
    if (Object.keys(cleanedPatch).length === 0) {
      if (overrides[id]) resetMutation.mutate(id);
      return;
    }
    saveMutation.mutate({ cardId: id, patch: cleanedPatch });
  };

  const resetOverride = (id: string) => resetMutation.mutate(id);

  const verifyAdminFn = useServerFn(verifyAdminLogin);
  const [adminChecking, setAdminChecking] = useState(false);

  // Read the stored admin token on mount and re-check it on the server once
  // (v2.52): a token that no longer matches (ADMIN_TOKEN changed) is dropped
  // instead of failing on the first write.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const stored = localStorage.getItem("admin-token");
    if (!stored) return;
    setAdminToken(stored);
    void verifyAdminFn({ data: { token: stored, mode: "session" } })
      .then((res) => {
        if (!res.ok) {
          localStorage.removeItem("admin-token");
          setAdminToken(null);
          toast.error("Stored admin login is no longer valid — please sign in again.");
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2.52: the server confirms the token before it is stored; a wrong token is
  // rejected right away (and logged), not only at the first write.
  const submitAdminToken = async () => {
    const token = adminInput.trim();
    if (!token || adminChecking) return;
    setAdminChecking(true);
    try {
      const res = await verifyAdminFn({ data: { token, mode: "login" } });
      if (!res.ok) {
        toast.error("Admin login failed: wrong token.");
        return;
      }
      localStorage.setItem("admin-token", token);
      setAdminToken(token);
      setAdminInput("");
      setAdminLoginOpen(false);
      toast.success("Admin login confirmed.");
    } catch (e) {
      toast.error(`Admin login failed: ${(e as Error).message}`);
    } finally {
      setAdminChecking(false);
    }
  };

  // v2.52: open errors / warnings of the operations log, admins only.
  const isLogAdmin = adminRequired && !!adminToken;
  // v2.57: the Tools tab is shown to admins only (whoever may edit); leaving
  // admin mode while on it returns to the data list.
  const showTools = !!authMode.data && canEdit;
  useEffect(() => {
    if (!showTools && tab === "tools") setTab("data");
  }, [showTools, tab]);
  const overviewFn = useServerFn(getEventOverview);
  const logOverview = useQuery({
    queryKey: ["event_overview"],
    queryFn: () => overviewFn(),
    enabled: isLogAdmin,
    refetchInterval: 60_000,
    retry: false,
  });
  const openErrors = isLogAdmin ? (logOverview.data?.openErrors ?? 0) : 0;
  const openWarnings = isLogAdmin ? (logOverview.data?.openWarnings ?? 0) : 0;

  const signOutAdmin = () => {
    localStorage.removeItem("admin-token");
    setAdminToken(null);
    toast.info("Signed out of admin mode.");
  };

  // One-time migration: push edits that still live in this browser's localStorage
  // into the shared database, then clear them locally.
  useEffect(() => {
    if (!auth.session || !rawCards?.length) return;
    const raw = localStorage.getItem("tacho-overrides-v1");
    if (!raw) return;
    localStorage.removeItem("tacho-overrides-v1");
    try {
      const legacy = JSON.parse(raw) as Record<string, Record<string, string>>;
      for (const [cardId, patch] of Object.entries(legacy)) {
        if (patch && Object.keys(patch).length > 0) {
          saveMutation.mutate({ cardId, patch });
        }
      }
    } catch {
      /* ignore malformed legacy data */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.session, rawCards?.length]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Tachograph Cards Info Tool</h1>
              <p className="text-sm text-muted-foreground">
                Consolidated certification &amp; procurement data for European Tacho Card (G1 · G2.1
                · G2.2)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"
              title="App version"
            >
              V{APP_VERSION}
            </span>
            <Button
              variant={tab === "data" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("data")}
            >
              <FileText className="mr-2 h-4 w-4" /> Data
            </Button>
            <Button
              variant={tab === "map" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("map")}
            >
              <Globe2 className="mr-2 h-4 w-4" /> Map
            </Button>
            <Button
              variant={tab === "analytics" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("analytics")}
            >
              <BarChart3 className="mr-2 h-4 w-4" /> Market Analytics
            </Button>
            <Button
              variant={tab === "reports" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("reports")}
            >
              <FileBarChart className="mr-2 h-4 w-4" /> Reports
            </Button>
            <Button
              variant={tab === "updates" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("updates")}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Update Monitor
            </Button>
            <Button
              variant={tab === "info" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("info")}
            >
              <BookOpen className="mr-2 h-4 w-4" /> Info
            </Button>
            {showTools && (
              <Button
                variant={tab === "tools" ? "default" : "outline"}
                size="sm"
                onClick={() => setTab("tools")}
              >
                <Wrench className="mr-2 h-4 w-4" /> Tools
                {openErrors > 0 ? (
                  <span
                    className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-4 text-white"
                    title={`${openErrors} open error(s) in the operations log`}
                  >
                    {openErrors}
                  </span>
                ) : openWarnings > 0 ? (
                  <span
                    className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold leading-4 text-white"
                    title={`${openWarnings} open warning(s) in the operations log`}
                  >
                    {openWarnings}
                  </span>
                ) : null}
              </Button>
            )}
            <span className="mx-1 h-8 w-px bg-border" />
            {authEnabled &&
              (auth.session ? (
                <Button variant="ghost" size="sm" onClick={() => void auth.signOut()}>
                  Sign out
                </Button>
              ) : (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/auth">Sign in</Link>
                </Button>
              ))}
            {adminRequired &&
              (adminToken ? (
                <Button variant="ghost" size="sm" onClick={signOutAdmin}>
                  Admin sign out
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setAdminLoginOpen(true)}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Admin login
                </Button>
              ))}
            {adminRequired && adminLoginOpen && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="password"
                  placeholder="Admin token"
                  className="h-8 w-40"
                  value={adminInput}
                  onChange={(e) => setAdminInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitAdminToken();
                  }}
                  autoFocus
                />
                <Button size="sm" onClick={() => void submitAdminToken()} disabled={adminChecking}>
                  {adminChecking ? "…" : "OK"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAdminLoginOpen(false);
                    setAdminInput("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">Error loading: {String(error)}</p>}

        {!isLoading && !error && tab === "data" && (
          <DataView
            cards={cards}
            overrides={overrides}
            canEdit={canEdit}
            editHint={adminRequired ? "Admin login required to edit" : "Sign in to edit"}
            onSave={saveOverride}
            onReset={resetOverride}
            onFilteredChange={setFilteredIds}
            marketStatusById={marketStatus.byId}
            onShowTimeline={(certificate) => {
              setTimelineFocus({
                family: parseCertificate(certificate)?.family,
                nonce: Date.now(),
              });
              setTab("analytics");
            }}
          />
        )}
        {!isLoading && !error && tab === "map" && (
          <WorldMapView cards={cards} flagUrl={flagUrl} topApproval={topApprovalByCountry} />
        )}
        {!isLoading && !error && tab === "analytics" && (
          <AnalyticsView cards={cards} marketStatus={marketStatus} timelineFocus={timelineFocus} />
        )}
        {!isLoading && !error && tab === "reports" && (
          <ReportsView cards={cards} marketStatus={marketStatus} onOpenCard={setToolsRecordId} />
        )}
        {tab === "updates" && <UpdatesView />}
        {tab === "info" && <InfoView />}
        {!isLoading && !error && tab === "tools" && showTools && (
          <ToolsView
            cards={cards}
            filteredCards={filteredCards}
            onImport={handleImport}
            isAdmin={isLogAdmin}
            onOpenCard={setToolsRecordId}
          />
        )}
        <RecordDetailDialog
          card={toolsRecordId ? (cards.find((c) => c.id === toolsRecordId) ?? null) : null}
          onClose={() => setToolsRecordId(null)}
        />
        <EditConflictDialog
          conflict={editConflict}
          onKeepTheirs={() => {
            setEditConflict(null);
            toast.info("Kept the saved values — your conflicting changes were not written.");
          }}
          onOverwrite={() => {
            if (!editConflict) return;
            const expected = { ...editConflict.expected };
            for (const c of editConflict.conflicts) expected[c.field] = c.theirs;
            saveMutation.mutate({
              cardId: editConflict.cardId,
              changes: editConflict.changes,
              expected,
            });
            setEditConflict(null);
          }}
        />

        <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
          Last data update: {cards?.[0]?.data_reference_date ?? "—"} · Source: JRC, ANSSI, RDW,
          national authorities &amp; public procurement records.
        </footer>
      </main>
    </div>
  );
}
