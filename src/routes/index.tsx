import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  saveCardOverride,
  importCards,
  resetCardOverride,
  getCards,
  getOverrides,
  getCardChangeHistory,
} from "@/lib/cards.functions";
import { getCurrentListing } from "@/lib/market.functions";
import {
  computeMarketStatus,
  topCardApprovalByCountry,
  MARKET_STATUS_LABEL,
  MARKET_STATUS_BADGE_CLASS,
  type CurrentListingEntry,
  type MarketStatus,
  type MarketStatusEntry,
  type MarketGroup,
} from "@/lib/market-status";
import { approvalHolderOf, chipPlatformOf, isOwnApproval } from "@/lib/chip-platform";
import { getAuthMode } from "@/lib/auth-mode.functions";
import { APP_VERSION } from "@/lib/version";
import { flagUrl } from "@/lib/country-flag";
import { expiryOf, expiryLabel, needsAttention, type Expiry, type ExpiryState } from "@/lib/expiry";
import { formatQuantities } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UpdatesView } from "@/components/UpdatesView";
import {
  Search,
  ExternalLink,
  ShieldCheck,
  FileText,
  Building2,
  BarChart3,
  Pencil,
  RefreshCw,
  Globe2,
  Wrench,
  History,
  CalendarClock,
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Layers,
  GitBranch,
} from "lucide-react";
import { PlatformTimelineView, type TimelineFocus } from "@/components/PlatformTimelineView";
import { parseCertificate } from "@/lib/cert-family";
import { thalesLogoUrl } from "@/assets/thales-logo";
import { WorldMapView } from "@/components/WorldMapView";
import { ToolsView } from "@/components/ToolsView";
import { getEventOverview, verifyAdminLogin } from "@/lib/events.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tachograph Cards Info Tool" },
      {
        name: "description",
        content:
          "Consolidated overview of all European tachograph cards (G1, G2.1, G2.2): manufacturers, chip platforms, certificates and procurement data.",
      },
      { property: "og:title", content: "Tachograph Cards Info Tool" },
      {
        property: "og:description",
        content: "Search European tachograph cards by country, generation and manufacturer.",
      },
    ],
  }),
  component: TachographTool,
});

type TachoCard = {
  id: string;
  country: string;
  country_flag: string;
  device_type: string;
  generation: string;
  application: string;
  current_manufacturer: string;
  current_manufacturer_normalized: string;
  chip_platform_vendor: string;
  security_certificate: string;
  chip_certificate: string;
  certificate_issued_date: string;
  certificate_expiry_date: string;
  type_approval_number: string;
  certified_security_platform: string;
  certificate_holder: string;
  date_status: string;
  issued_by_authority: string;
  jrc_interoperability_status: string;
  functional_certificate_lab: string;
  security_certificate_lab: string;
  tachograph_application_os: string;
  distinction_from_manufacturer: string;
  jrc_certificate_source: string;
  primary_source: string;
  latest_tender: string;
  winner_contractor: string;
  procurement_status: string;
  procurement_scope: string;
  tender_source: string;
  verification_note: string;
  data_reference_date: string;
  // Virtual field — not a DB column; stored only in manual overrides.
  card_quantities?: string;
};

type Overrides = Record<string, Partial<TachoCard>>;

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

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((s) => s && s.trim().length > 0))).sort();
}

/**
 * The device types the sources publish. Offered everywhere as a fixed list, not
 * derived from the data: a type that does not occur yet must still be
 * selectable, otherwise a record can never be set to it in the first place.
 */
const DEVICE_TYPES = ["Card", "Vehicle Unit", "Motion Sensor"] as const;

const EXPIRY_LABELS: Record<ExpiryState, string> = {
  expired: "Expired",
  critical: "Expires within 3 months",
  warning: "Expires within 6 months",
  ok: "Valid",
  unknown: "Not dated",
};

const EXPIRY_DOT: Record<ExpiryState, string> = {
  expired: "bg-destructive",
  critical: "bg-destructive",
  warning: "bg-amber-500",
  ok: "bg-emerald-500",
  unknown: "bg-muted-foreground/40",
};

/** Validity of a certificate in one badge; renders nothing without a date. */
function ExpiryBadge({ expiry, compact = false }: { expiry: Expiry; compact?: boolean }) {
  if (expiry.state === "unknown" || !expiry.date) return null;
  const critical = expiry.state === "expired" || expiry.state === "critical";
  if (!needsAttention(expiry)) {
    if (compact) return null;
    return (
      <span className="text-xs text-muted-foreground">
        valid until {expiry.date.toISOString().slice(0, 10)}
      </span>
    );
  }
  return (
    <Badge
      variant={critical ? "destructive" : "outline"}
      className={"gap-1 text-xs font-normal " + (critical ? "" : "border-amber-500 text-amber-600")}
      title={`Certificate validity ends ${expiry.date.toISOString().slice(0, 10)}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {compact ? (expiry.state === "expired" ? "expired" : `${expiry.days}d`) : expiryLabel(expiry)}
    </Badge>
  );
}

const GROUP1_FIELDS: Array<[keyof TachoCard, string]> = [
  ["country", "Country"],
  ["device_type", "Device Type"],
  ["generation", "Generation"],
  ["application", "Application"],
  ["tachograph_application_os", "Tachograph Application / OS"],
  ["type_approval_number", "Type Approval Number"],
  ["issued_by_authority", "Issued by Authority"],
  ["date_status", "Date / Status"],
  ["certificate_holder", "Certificate Holder"],
  ["certified_security_platform", "Certified Security Platform"],
  ["chip_certificate", "Chip Certificate"],
  ["chip_platform_vendor", "Chip / Platform Vendor"],
  ["security_certificate", "Security Certificate"],
  ["certificate_issued_date", "Date Certificate Issued"],
  ["certificate_expiry_date", "Certificate Validity Expiration Date"],
  ["security_certificate_lab", "Security Certificate Lab"],
  ["functional_certificate_lab", "Functional Certificate Lab"],
  ["jrc_interoperability_status", "JRC Interoperability Status"],
  ["jrc_certificate_source", "JRC / Certificate Source"],
  ["primary_source", "Primary Source"],
  ["card_quantities", "Card Quantities"],
];

function TachographTool() {
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
  const [tab, setTab] = useState<"data" | "map" | "analytics" | "updates" | "tools">("data");
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
  const currentListing = useMemo(
    () => currentListingQuery.data ?? [],
    [currentListingQuery.data],
  );
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
        setEditConflict({ cardId: vars.cardId, conflicts: res.conflicts, changes: vars.changes ?? {}, expected: vars.expected ?? {} });
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
            <div className="shrink-0 rounded-md bg-white px-2 py-1.5 shadow-sm ring-1 ring-border">
              <img src={thalesLogoUrl} alt="Thales logo" className="h-7 w-auto object-contain" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Tachograph Cards Info Tool</h1>
              <p className="text-sm text-muted-foreground">
                Consolidated certification &amp; procurement data for European Tacho Card (G1 · G2.1
                · G2.2)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border bg-muted p-0.5 text-xs font-medium">
              <span className="rounded-sm bg-background px-2.5 py-1 shadow-sm">Web</span>
              <a
                href="/offline"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 text-muted-foreground hover:text-foreground"
                title="Open the standalone/offline version in a new tab"
              >
                Offline
              </a>
            </div>
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
              variant={tab === "updates" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("updates")}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Update Monitor
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
              setTimelineFocus({ family: parseCertificate(certificate)?.family, nonce: Date.now() });
              setTab("analytics");
            }}
          />
        )}
        {!isLoading && !error && tab === "map" && <WorldMapView cards={cards} flagUrl={flagUrl} topApproval={topApprovalByCountry} />}
        {!isLoading && !error && tab === "analytics" && (
          <AnalyticsView cards={cards} marketStatus={marketStatus} timelineFocus={timelineFocus} />
        )}
        {tab === "updates" && <UpdatesView />}
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

// v2.56: approval-status views of the Data list (market status per record,
// see market-status.ts). Records whose status cannot be decided stay in the
// default view so the open cases are not hidden.
type StatusView = "active" | "current" | "history" | "all";
const STATUS_VIEW_LABEL: Record<StatusView, string> = {
  active: "Active + unclear",
  current: "Active only",
  history: "History (superseded / delisted)",
  all: "All records",
};
function inStatusView(view: StatusView, status: MarketStatus | undefined): boolean {
  if (view === "all") return true;
  if (view === "current") return status === "current";
  if (view === "history") return status === "superseded" || status === "delisted";
  return status !== "superseded" && status !== "delisted";
}

function DataView({
  cards,
  overrides,
  canEdit,
  editHint,
  onSave,
  onReset,
  onFilteredChange,
  marketStatusById,
  onShowTimeline,
}: {
  cards: TachoCard[];
  overrides: Overrides;
  canEdit: boolean;
  editHint: string;
  onSave: (id: string, patch: Partial<TachoCard>, original?: Record<string, string>) => void;
  onReset: (id: string) => void;
  /** Reports the current filter upwards so Tools can export exactly this view. */
  onFilteredChange?: (ids: string[]) => void;
  /** Current / superseded / delisted / unmatched per card id — see market-status.ts. */
  marketStatusById?: Map<string, MarketStatusEntry>;
  onShowTimeline?: (certificate: string) => void;
}) {
  const [country, setCountry] = useState("all");
  const [generation, setGeneration] = useState("all");
  const [deviceType, setDeviceType] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // v2.56: the list starts with the approvals in force (plus those whose
  // status cannot be decided); history is one click away. Remembered per browser.
  const [statusView, setStatusView] = useState<StatusView>("active");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("tdh.dataStatusView");
      if (v && v in STATUS_VIEW_LABEL) setStatusView(v as StatusView);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const chooseStatusView = (v: StatusView) => {
    setStatusView(v);
    try {
      window.localStorage.setItem("tdh.dataStatusView", v);
    } catch {
      /* storage unavailable — choice just isn't remembered */
    }
  };

  // v2.46: the list / detail split is draggable. Dragging the divider widens
  // the list; the detail pane keeps (at least) the width it has in the default
  // layout and moves right — the row scrolls horizontally instead of the
  // detail pane being squeezed. Width is remembered per browser.
  const DEFAULT_LIST_W = 360;
  const SPLITTER_W = 24;
  const [listWidth, setListWidth] = useState<number>(DEFAULT_LIST_W);
  // Read after mount (not in the initializer) so server and client render the
  // same markup first.
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem("tdh.dataListWidth"));
      if (v >= 260 && v <= 1600) setListWidth(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [detailMinWidth, setDetailMinWidth] = useState<number | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const splitDrag = useRef<{ x: number; w: number } | null>(null);
  // Width the detail pane has with the default list width; it never gets
  // narrower than that (re-measured when the window is resized).
  useEffect(() => {
    const measure = () => {
      const el = splitRef.current;
      if (el) setDetailMinWidth(Math.max(480, el.clientWidth - DEFAULT_LIST_W - SPLITTER_W));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const saveListWidth = (w: number) => {
    try {
      window.localStorage.setItem("tdh.dataListWidth", String(Math.round(w)));
    } catch {
      /* storage unavailable — width just isn't remembered */
    }
  };
  const startSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    splitDrag.current = { x: e.clientX, w: listWidth };
    document.body.style.userSelect = "none";
  };
  const moveSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current;
    if (!d) return;
    setListWidth(Math.min(1600, Math.max(260, d.w + e.clientX - d.x)));
  };
  const endSplitDrag = () => {
    if (!splitDrag.current) return;
    splitDrag.current = null;
    document.body.style.userSelect = "";
    saveListWidth(listWidth);
  };

  const countries = useMemo(() => uniq(cards.map((c) => c.country)), [cards]);
  const generations = useMemo(() => uniq(cards.map((c) => c.generation)), [cards]);
  // Empty on older records: everything stored before the device type existed is
  // a card, so it is treated as one rather than shown as a blank option.
  const deviceTypes = useMemo(
    () => uniq([...DEVICE_TYPES, ...cards.map((c) => c.device_type || "Card")]),
    [cards],
  );
  const manufacturers = useMemo(
    () => uniq(cards.map((c) => c.current_manufacturer_normalized)),
    [cards],
  );

  // Everything the other filters let through, before the status view.
  const matching = useMemo(() => {
    const q = search.toLowerCase();
    return cards.filter((c) => {
      if (country !== "all" && c.country !== country) return false;
      if (generation !== "all" && c.generation !== generation) return false;
      if (deviceType !== "all" && (c.device_type || "Card") !== deviceType) return false;
      if (manufacturer !== "all" && c.current_manufacturer_normalized !== manufacturer)
        return false;
      if (!q) return true;
      return Object.values(c).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [cards, country, generation, deviceType, manufacturer, search]);
  const statusOf = (c: TachoCard) => marketStatusById?.get(c.id)?.status;
  const statusCounts = useMemo(() => {
    const n: Record<StatusView, number> = { active: 0, current: 0, history: 0, all: matching.length };
    for (const c of matching) {
      for (const v of ["active", "current", "history"] as const) if (inStatusView(v, statusOf(c))) n[v]++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matching, marketStatusById]);
  const filtered = useMemo(
    () => matching.filter((c) => inStatusView(statusView, statusOf(c))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matching, statusView, marketStatusById],
  );
  const hiddenByStatus = matching.length - filtered.length;

  useEffect(() => {
    onFilteredChange?.(filtered.map((c) => c.id));
  }, [filtered, onFilteredChange]);

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  return (
    <>
      <Card className="mb-6">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Full-text search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="e.g. Thales, e4-0030-00, ANSSI…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Country</label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All countries</SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Generation
            </label>
            <Select value={generation} onValueChange={setGeneration}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All generations</SelectItem>
                {generations.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Device Type
            </label>
            <Select value={deviceType} onValueChange={setDeviceType}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All device types</SelectItem>
                {deviceTypes.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Current Manufacturer
            </label>
            <Select value={manufacturer} onValueChange={setManufacturer}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All manufacturers</SelectItem>
                {manufacturers.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Approval status
            </label>
            <Select value={statusView} onValueChange={(v) => chooseStatusView(v as StatusView)}>
              <SelectTrigger title="Market status — same rule as in Market Analytics">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_VIEW_LABEL) as StatusView[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {STATUS_VIEW_LABEL[v]} ({statusCounts[v]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {manufacturer !== "all" && (
        <ManufacturerTimeline manufacturer={manufacturer} cards={filtered} />
      )}

      <div
        ref={splitRef}
        className="flex flex-col gap-6 lg:flex-row lg:gap-0 lg:overflow-x-auto lg:pb-2"
        style={
          {
            "--list-w": `${listWidth}px`,
            "--detail-min-w": detailMinWidth ? `${detailMinWidth}px` : "0px",
          } as CSSProperties
        }
      >
        <div className="min-w-0 lg:w-[var(--list-w)] lg:shrink-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm text-muted-foreground">
              {statusView === "all"
                ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}`
                : `${filtered.length} of ${matching.length} · ${STATUS_VIEW_LABEL[statusView].toLowerCase()}`}
            </p>
            {hiddenByStatus > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => chooseStatusView("all")}
              >
                + {hiddenByStatus} more in history — show all
              </button>
            )}
          </div>
          <ScrollArea className="h-[70vh] rounded-lg border bg-card">
            <div className="divide-y">
              {filtered.map((c) => {
                const active = selected?.id === c.id;
                const fUrl = flagUrl(c.country, 40);
                const edited = !!overrides[c.id];
                const status = marketStatusById?.get(c.id)?.status;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent " +
                      (active ? "bg-accent" : "")
                    }
                  >
                    {fUrl ? (
                      <img
                        src={fUrl}
                        alt={`${c.country} flag`}
                        width={32}
                        height={24}
                        loading="lazy"
                        className="h-6 w-8 shrink-0 rounded-sm border object-cover shadow-sm"
                      />
                    ) : (
                      <span className="text-2xl leading-none">{c.country_flag}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {/* A vehicle unit or motion sensor has no country —
                              without a fallback the row would be blank. */}
                          {c.country ||
                            c.tachograph_application_os ||
                            c.current_manufacturer ||
                            "—"}
                          {edited && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              edited
                            </Badge>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <ExpiryBadge expiry={expiryOf(c.certificate_expiry_date)} compact />
                          {status && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${MARKET_STATUS_BADGE_CLASS[status]}`}
                              title="Market status — see the Market Analytics tab"
                            >
                              {MARKET_STATUS_LABEL[status]}
                            </Badge>
                          )}
                          <Badge variant="secondary">{c.generation}</Badge>
                        </span>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {hiddenByStatus > 0
                    ? `No ${STATUS_VIEW_LABEL[statusView].toLowerCase()} records match — ${hiddenByStatus} in the history.`
                    : "No matches."}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize the list · double-click to reset"
          className="group hidden shrink-0 cursor-col-resize touch-none justify-center pt-7 lg:flex"
          style={{ width: SPLITTER_W }}
          onPointerDown={startSplitDrag}
          onPointerMove={moveSplitDrag}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
          onDoubleClick={() => {
            setListWidth(DEFAULT_LIST_W);
            saveListWidth(DEFAULT_LIST_W);
          }}
        >
          <div className="h-[70vh] w-1 rounded-full bg-border transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
        </div>

        <div className="min-w-0 lg:min-w-[var(--detail-min-w)] lg:flex-1">
          {selected ? (
            <DetailView
              card={selected}
              edited={!!overrides[selected.id]}
              canEdit={canEdit}
              editHint={editHint}
              onSave={(patch, original) => onSave(selected.id, patch, original)}
              onReset={() => onReset(selected.id)}
              marketStatus={marketStatusById?.get(selected.id)?.status}
              onShowTimeline={onShowTimeline}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a country on the left.</p>
          )}
        </div>
      </div>
    </>
  );
}

/** Parse the first dd.mm.yyyy (or yyyy-mm-dd) date found in a free-text status field. */
function parseApprovalDate(text: string): Date | null {
  if (!text) return null;
  const dmy = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const ymd = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const y = /\b(19|20)\d{2}\b/.exec(text);
  if (y) return new Date(Number(y[0]), 0, 1);
  return null;
}

const TIMELINE_FIELDS: Array<[keyof TachoCard, string]> = [
  ["application", "Application"],
  ["type_approval_number", "Type Approval Number"],
  ["issued_by_authority", "Issued by Authority"],
  ["date_status", "Date / Status"],
  ["certificate_holder", "Certificate Holder"],
  ["chip_platform_vendor", "Chip / Platform Vendor"],
  ["security_certificate", "Security Certificate"],
  ["certificate_issued_date", "Date Certificate Issued"],
  ["certificate_expiry_date", "Certificate Validity Expiration Date"],
  ["jrc_interoperability_status", "JRC Interoperability Status"],
  ["latest_tender", "Latest Tender"],
  ["procurement_status", "Procurement Status"],
];

function ManufacturerTimeline({
  manufacturer,
  cards,
}: {
  manufacturer: string;
  cards: TachoCard[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "name">("date");

  const entries = useMemo(() => {
    const list = cards.map((c) => ({ card: c, date: parseApprovalDate(c.date_status) }));
    if (sortBy === "name") {
      return list.sort((a, b) => a.card.country.localeCompare(b.card.country));
    }
    return list.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.getTime() - b.date.getTime();
    });
  }, [cards, sortBy]);

  const dated = entries.filter((e) => e.date);
  const years = dated.length
    ? `${dated[0].date!.getFullYear()} – ${dated[dated.length - 1].date!.getFullYear()}`
    : "no dates available";

  if (entries.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          Approval timeline — {manufacturer}
          <Badge variant="secondary">{entries.length} countries</Badge>
          <span className="text-xs font-normal text-muted-foreground">{years}</span>
          <div className="ml-auto flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <Button
              type="button"
              size="sm"
              variant={sortBy === "date" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setSortBy("date")}
            >
              Date
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sortBy === "name" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setSortBy("name")}
            >
              Name
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-2 border-l pl-6">
          {entries.map(({ card: c, date }) => {
            const open = openId === c.id;
            const fUrl = flagUrl(c.country, 40);
            return (
              <li key={c.id} className="relative">
                <span className="absolute -left-[27px] top-4 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : c.id)}
                  className={
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent " +
                    (open ? "bg-accent" : "bg-card")
                  }
                >
                  <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                    {date
                      ? date.toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "unknown"}
                  </span>
                  {fUrl ? (
                    <img
                      src={fUrl}
                      alt={`${c.country} flag`}
                      width={32}
                      height={24}
                      loading="lazy"
                      className="h-6 w-8 shrink-0 rounded-sm border object-cover shadow-sm"
                    />
                  ) : (
                    <span className="text-xl leading-none">{c.country_flag}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{c.country}</span>
                  <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">
                    {c.type_approval_number || "—"}
                  </span>
                  <Badge variant="secondary">{c.generation}</Badge>
                </button>
                {open && (
                  <dl className="mt-1 grid gap-x-6 gap-y-2 rounded-md border bg-muted/40 px-4 py-3 text-sm sm:grid-cols-2">
                    {TIMELINE_FIELDS.map(([key, label]) => (
                      <div key={String(key)}>
                        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                        <dd className="break-words">{String(c[key] ?? "") || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function DetailView({
  card,
  edited,
  canEdit,
  editHint,
  onSave,
  onReset,
  marketStatus,
  onShowTimeline,
}: {
  card: TachoCard;
  edited: boolean;
  canEdit: boolean;
  editHint: string;
  onSave: (patch: Partial<TachoCard>, original?: Record<string, string>) => void;
  onReset: () => void;
  marketStatus?: MarketStatus;
  onShowTimeline?: (certificate: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // v2.54 (code review 18): what the record showed when editing started — the
  // server only writes fields that differ from it and reports a conflict when
  // someone else changed the same field meanwhile.
  const [original, setOriginal] = useState<Record<string, string>>({});

  useEffect(() => {
    setEditing(false);
    setDraft({});
  }, [card.id]);

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const [k] of GROUP1_FIELDS) {
      d[k as string] = String((card as Record<string, unknown>)[k as string] ?? "");
    }
    setDraft(d);
    setOriginal(d);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft({});
  };
  const save = () => {
    onSave(draft as Partial<TachoCard>, original);
    setEditing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        {flagUrl(card.country, 80) ? (
          <img
            src={flagUrl(card.country, 80)!}
            alt={`${card.country} flag`}
            width={64}
            height={48}
            className="h-12 w-16 shrink-0 rounded-md border object-cover shadow-sm"
          />
        ) : (
          <span className="text-4xl leading-none">{card.country_flag}</span>
        )}
        <div>
          <h2 className="text-2xl font-semibold">
            {card.country || card.tachograph_application_os || card.current_manufacturer || "—"}
            {edited && (
              <Badge variant="outline" className="ml-2 align-middle text-xs">
                edited
              </Badge>
            )}
          </h2>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge>{card.generation || "—"}</Badge>
            {card.tachograph_application_os && (
              <Badge variant="outline">{card.tachograph_application_os}</Badge>
            )}
            {marketStatus && (
              <Badge
                variant="outline"
                className={MARKET_STATUS_BADGE_CLASS[marketStatus]}
                title="Market status — see the Market Analytics tab"
              >
                {MARKET_STATUS_LABEL[marketStatus]}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Group 1 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Card &amp; Certification
            </CardTitle>
            <div className="flex gap-2">
              {!editing && canEdit && (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {!editing && !canEdit && (
                <span className="text-xs text-muted-foreground">{editHint}</span>
              )}
              {editing && (
                <>
                  <Button size="sm" onClick={save}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancel}>
                    Cancel
                  </Button>
                  {edited && (
                    <Button size="sm" variant="ghost" onClick={onReset}>
                      Reset
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          {GROUP1_FIELDS.map(([k, label]) => {
            const key = k as string;
            let value = String((card as Record<string, unknown>)[key] ?? "");
            if (key === "card_quantities") value = formatQuantities(value);
            if (editing) {
              return (
                <div key={key} className="md:col-span-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  {key === "device_type" ? (
                    // A fixed set of values: typed by hand, "vehicle unit" and
                    // "VU" would end up as separate categories.
                    <Select
                      value={draft[key] || "Card"}
                      onValueChange={(v) => setDraft({ ...draft, [key]: v })}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEVICE_TYPES.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Textarea
                      className="mt-1 min-h-[40px] text-sm"
                      value={draft[key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    />
                  )}
                  {key === "security_certificate" && (
                    // v2.55: the Platform Timeline reads the family from this text.
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      One certificate number as on the type approval, e.g. ANSSI-CC-2022/38-M01,
                      NSCIB-CC-22-0635023, BSI-DSZ-CC-0889. Continuations as -M01 / -R01 / -S02.
                      {draft[key]?.trim() &&
                        (parseCertificate(draft[key])
                          ? ` Recognised: ${parseCertificate(draft[key])!.family}.`
                          : " Not recognised as a certificate number.")}
                    </p>
                  )}
                </div>
              );
            }
            if (key === "jrc_certificate_source" || key === "primary_source") {
              return <LinkField key={key} label={label} value={value} className="md:col-span-2" />;
            }
            if (key === "certificate_expiry_date") {
              return (
                <Field key={key} label={label} value={value}>
                  <ExpiryBadge expiry={expiryOf(value)} />
                </Field>
              );
            }
            if (key === "security_certificate" && onShowTimeline && parseCertificate(value)) {
              return (
                <Field key={key} label={label} value={value}>
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => onShowTimeline(value)}
                  >
                    Platform timeline →
                  </button>
                </Field>
              );
            }
            return <Field key={key} label={label} value={value} />;
          })}
          {!editing && (
            <div className="md:col-span-2">
              <CertificationChainPanel card={card} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Group 2 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Procurement
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <Field
            label="Latest Tender / Procurement Procedure"
            value={card.latest_tender}
            className="md:col-span-2"
          />
          <Field label="Winner / Contractor" value={card.winner_contractor} />
          <Field label="Procurement Status / Assessment" value={card.procurement_status} />
          {card.procurement_scope && (
            <Field
              label="Scope / Assessment"
              value={card.procurement_scope}
              className="md:col-span-2"
            />
          )}
          <LinkField
            label="Tender / Procurement Source"
            value={card.tender_source}
            className="md:col-span-2"
          />
        </CardContent>
      </Card>

      {card.verification_note && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Verification Note
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{card.verification_note}</p>
          </CardContent>
        </Card>
      )}

      <HistoryCard cardId={card.id} />
    </div>
  );
}

const HISTORY_ORIGINS: Record<string, string> = {
  manual: "Manual edit",
  jrc_proposal: "Approved JRC proposal",
  csv_import: "CSV import",
  reset: "Manual edits removed",
};

/** Field labels are defined for group 1; fall back to the raw column name. */
const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  GROUP1_FIELDS.map(([k, label]) => [String(k), label]),
);

type HistoryRow = {
  id: string;
  field: string;
  old_value: string;
  new_value: string;
  origin: string;
  source_label: string;
  source_url: string;
  created_at: string;
};

/**
 * Change history of one card. Answers "why does this record say that?" —
 * until now the override table only kept the current values, so a corrected
 * field left no trace of what it held before or where the change came from.
 */
function HistoryCard({ cardId }: { cardId: string }) {
  const fetchHistory = useServerFn(getCardChangeHistory);
  const history = useQuery({
    queryKey: ["card_field_history", cardId],
    queryFn: async (): Promise<HistoryRow[]> =>
      (await fetchHistory({ data: { cardId } })) as HistoryRow[],
  });

  const rows = history.data ?? [];
  if (history.isLoading || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Change History
          <Badge variant="outline" className="ml-1 text-xs font-normal">
            {rows.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Field</th>
                <th className="py-2 pr-4 font-medium">Change</th>
                <th className="py-2 pr-4 font-medium">Origin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 font-medium">{FIELD_LABELS[r.field] ?? r.field}</td>
                  <td className="py-2 pr-4">
                    <span className="text-muted-foreground line-through">{r.old_value || "—"}</span>{" "}
                    <span aria-hidden>→</span> <span>{r.new_value || "—"}</span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {HISTORY_ORIGINS[r.origin] ?? r.origin}
                    {r.source_label && ` · ${r.source_label}`}
                    {r.source_url && (
                      <>
                        {" "}
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          source
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

type Drill =
  | { kind: "generation"; value: string }
  | { kind: "activeGeneration"; value: string }
  | { kind: "manufacturer"; value: string }
  | { kind: "certificate"; value: string }
  | { kind: "device"; value: string }
  | { kind: "expiry"; value: ExpiryState };

function AnalyticsView({
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
  const genMax = Math.max(1, ...Object.values(genCounts));

  // v2.58: the generation bars use exactly the records of the market share
  // table below (ovCards: product group + active / history), split by
  // generation — so G1 + G2.1 + G2.2 add up to the table's approvals.
  const activeGen = useMemo(() => {
    const ids: Record<string, Set<string>> = {};
    const counts: Record<string, number> = {};
    const countries: Record<string, Set<string>> = {};
    for (const c of ovCards) {
      const gen = c.generation || "—";
      (ids[gen] ??= new Set()).add(c.id);
      counts[gen] = (counts[gen] ?? 0) + 1;
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
      const m = c.current_manufacturer_normalized || c.current_manufacturer || "—";
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
          ? cards.filter(
              (c) => (c.current_manufacturer_normalized || c.current_manufacturer) === drill.value,
            )
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
            <Select value={ovGroupBy} onValueChange={(v) => setOvGroupBy(v as "holder" | "platform")}>
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
          </CardHeader>
          <CardContent className="space-y-2">
            {activeGens.map((g) => (
              <button
                key={g}
                onClick={() => toggleDrill({ kind: "activeGeneration", value: g })}
                className="grid w-full grid-cols-[60px_1fr_140px] items-center gap-3 rounded p-1 text-left hover:bg-accent"
                title={`${activeGen.counts[g]} approval(s) in ${activeGen.countryCounts[g] ?? 0} country(ies) — click to list them`}
              >
                <span className="font-semibold">{g}</span>
                <div className="h-5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(activeGen.counts[g] / activeMax) * 100}%` }}
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
                {activeGen.otherGen} approval{activeGen.otherGen === 1 ? "" : "s"} without a
                G1 / G2.1 / G2.2 generation.
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
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-400"
                      style={{ width: `${pct}%` }}
                    />
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
            Cards, vehicle units and motion sensors are counted separately from the generation — a
            vehicle unit has a generation of its own.
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
            Based on the stored expiry date. &ldquo;Not dated&rdquo; means no readable date is on
            file — those are not safe to treat as valid.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["expired", "critical", "warning", "ok", "unknown"] as ExpiryState[]).map((state) => (
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
            ))}
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
            The reverse view: which type approvals rest on a given certificate. Click a row to list
            them.
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

/**
 * Market share of manufacturers holding the *current* type approval per
 * country/device-type lane — i.e. only status === "current" counts. A cert
 * that is our most-recent record for its lane but has disappeared from JRC
 * ("delisted") is surfaced separately rather than folded into the total,
 * since it is no longer a live market position.
 */
/** Full-record window, opened from any drill-down list (Overview, Current
 * Status, History) — one implementation so every surface shows the same
 * fields in the same layout. */
function RecordDetailDialog({ card, onClose }: { card: TachoCard | null; onClose: () => void }) {
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="shrink-0" onClick={onClose}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {card && flagUrl(card.country, 40) && (
              <img
                src={flagUrl(card.country, 40)!}
                alt=""
                className="h-6 w-9 rounded border object-cover"
              />
            )}
            <span>
              {card?.country} · {card?.type_approval_number || "—"}
            </span>
          </DialogTitle>
        </DialogHeader>
        {card && (
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {GROUP1_FIELDS.map(([k, label]) => {
              const key = k as string;
              let value = String((card as Record<string, unknown>)[key] ?? "");
              if (key === "card_quantities") value = formatQuantities(value);
              if (key === "certificate_expiry_date") {
                return (
                  <Field key={key} label={label} value={value}>
                    <ExpiryBadge expiry={expiryOf(value)} />
                  </Field>
                );
              }
              return <Field key={key} label={label} value={value} />;
            })}
            {card.verification_note && (
              <Field
                label="Verification Note"
                value={card.verification_note}
                className="md:col-span-2"
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CurrentStatusView({
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
  const UNKNOWN_PLATFORM = "Platform unknown";
  const groupKeyOf = (c: TachoCard) =>
    groupBy === "holder"
      ? c.current_manufacturer_normalized || c.current_manufacturer || "—"
      : chipPlatformOf(c).vendor || UNKNOWN_PLATFORM;
  const scoped = useMemo(
    () => cards.filter((c) => deviceType === "all" || (c.device_type || "Card") === deviceType),
    [cards, deviceType],
  );

  const activeOnly = useMemo(
    () => scoped.filter((c) => byId.get(c.id)?.status === "current"),
    [scoped, byId],
  );
  // With "include history" the table counts every record (long-term share).
  const current = includeHistory ? scoped : activeOnly;
  const delisted = useMemo(
    () => scoped.filter((c) => byId.get(c.id)?.status === "delisted"),
    [scoped, byId],
  );

  const shareList = useMemo(() => {
    const map: Record<
      string,
      { holders: number; countries: Set<string>; own: number; partner: number; gens: Record<string, number> }
    > = {};
    for (const c of current) {
      const m = groupKeyOf(c);
      if (!map[m]) map[m] = { holders: 0, countries: new Set(), own: 0, partner: 0, gens: {} };
      map[m].holders++;
      // v2.58: split by generation, same split as the bars above.
      const gen = c.generation || "—";
      map[m].gens[gen] = (map[m].gens[gen] ?? 0) + 1;
      map[m].countries.add(c.country);
      if (groupBy === "platform") {
        const vendor = chipPlatformOf(c).vendor;
        if (vendor && isOwnApproval(c, vendor)) map[m].own++;
        else if (vendor) map[m].partner++;
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
        share: (v.holders / total) * 100,
      }))
      .sort(
        (a, b) =>
          Number(a.name === UNKNOWN_PLATFORM) - Number(b.name === UNKNOWN_PLATFORM) ||
          b.holders - a.holders ||
          b.countries - a.countries,
      );
    // groupKeyOf depends only on groupBy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, groupBy]);
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
                approval date, still listed on JRC today. {current.length} of{" "}
                {scoped.length} record{scoped.length === 1 ? "" : "s"} in scope count as current.
              </>
            )}
            {groupBy === "platform" &&
              " Grouped by the vendor of the secure chip platform, taken from the security certificate number (field 7.2 of the type approval); “own” means the platform vendor also holds the approval, “via partner” means another card manufacturer does."}{" "}
            Click a row to list its countries.
          </p>
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
                    className="py-2 pr-3 text-right font-medium"
                    title="Approvals per generation: G1 / G2.1 / G2.2"
                  >
                    G1 / G2.1 / G2.2
                  </th>
                  {groupBy === "platform" && (
                    <th className="py-2 pr-3 text-right font-medium">Own / via partner</th>
                  )}
                  <th className="py-2 pr-3 text-right font-medium">Countries</th>
                  <th className="py-2 pr-3 text-right font-medium">Market share</th>
                  <th className="hidden py-2 pr-3 font-medium lg:table-cell"></th>
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
                    <td className="py-2 pr-3 font-medium">{m.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.holders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {m.gens["G1"] ?? 0} / {m.gens["G2.1"] ?? 0} / {m.gens["G2.2"] ?? 0}
                    </td>
                    {groupBy === "platform" && (
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.name === UNKNOWN_PLATFORM ? "—" : `${m.own} / ${m.partner}`}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-right tabular-nums">{m.countries}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.share.toFixed(1)}%</td>
                    <td className="hidden py-2 pr-3 lg:table-cell">
                      <div className="h-3 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                          style={{ width: `${(m.holders / shareMax) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {shareList.length === 0 && (
                  <tr>
                    <td colSpan={groupBy === "platform" ? 7 : 6} className="py-6 text-center text-muted-foreground">
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
              Our most recent record for this lane, but its type approval is not currently listed
              on either JRC page. Worth a manual check — JRC may have removed it, or the stored
              type approval number may no longer match its JRC spelling.
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
        <DialogContent className={`max-h-[80vh] ${groupBy === "platform" ? "max-w-5xl" : "max-w-2xl"}`}>
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
                  <td colSpan={groupBy === "platform" ? 5 : 4} className="py-6 text-center text-muted-foreground">
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

/**
 * Succession chains: every (country, manufacturer, product group) lane with
 * more than one type approval, newest first, each tagged with its status.
 * This is the "complete history" view for market status — the Data tab
 * already lists every record flatly, so this one only earns its place by
 * showing the *lineage* a flat list can't.
 */
function MarketHistoryView({ groups, cards }: { groups: MarketGroup[]; cards: TachoCard[] }) {
  const [deviceType, setDeviceType] = useState("all");
  const [search, setSearch] = useState("");
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const deviceTypes = useMemo(() => uniq(groups.map((g) => g.deviceType || "Card")), [groups]);

  const chains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => g.entries.length > 1)
      .filter((g) => deviceType === "all" || (g.deviceType || "Card") === deviceType)
      .filter(
        (g) =>
          !q ||
          g.country.toLowerCase().includes(q) ||
          g.manufacturers.some((m) => m.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.country.localeCompare(b.country) || a.deviceType.localeCompare(b.deviceType));
  }, [groups, deviceType, search]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Search country / manufacturer
            </label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Ukraine" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Product group
            </label>
            <Select value={deviceType} onValueChange={setDeviceType}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All product groups</SelectItem>
                {deviceTypes.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {chains.length} lane{chains.length === 1 ? "" : "s"} with more than one type approval on
        record.
      </p>

      <div className="space-y-4">
        {chains.map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {g.country || "—"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {g.deviceType}
                </span>
              </CardTitle>
              {g.manufacturers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {g.manufacturers.length > 1 ? "Manufacturers: " : "Manufacturer: "}
                  {g.manufacturers.join(", ")}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4">
                {g.entries.map((e) => (
                  <li
                    key={e.id}
                    className="relative cursor-pointer rounded-r px-1 py-0.5 -ml-1 hover:bg-accent/60"
                    onClick={() => cardById.get(e.id) && setDetailCard(cardById.get(e.id)!)}
                    title="Click for full details"
                  >
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.type_approval_number || "—"}</span>
                      <Badge variant="secondary" className="text-xs">
                        {e.generation || "—"}
                      </Badge>
                      {e.manufacturer && (
                        <Badge variant="outline" className="text-xs">
                          {e.manufacturer}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-xs ${MARKET_STATUS_BADGE_CLASS[e.status]}`}>
                        {MARKET_STATUS_LABEL[e.status]}
                      </Badge>
                      {e.closeDateWarningDays !== undefined && (
                        <Badge
                          variant="outline"
                          className="text-xs border-amber-500 text-amber-600"
                          title={`Only ${e.closeDateWarningDays} day${e.closeDateWarningDays === 1 ? "" : "s"} from the top entry of the same generation in this lane — unclear which one is current, worth a manual check for a data entry error.`}
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" /> Check dates
                        </Badge>
                      )}
                      <span
                        className="text-xs text-muted-foreground"
                        title={
                          e.ranking_date_source === "security_certificate"
                            ? "No type approval date on file — ranked by the security certificate date instead."
                            : undefined
                        }
                      >
                        {e.ranking_date_source === "approval"
                          ? `approved ${e.ranking_date}`
                          : e.ranking_date_source === "security_certificate"
                            ? `${e.ranking_date} (security cert., no approval date)`
                            : "no approval date on file"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
        {chains.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            No multi-entry lanes match this filter.
          </p>
        )}
      </div>

      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </div>
  );
}

type LabRole = "Security evaluation / certification" | "Functional & interoperability certificate";

const LAB_PATTERNS: Array<{ name: string; role: LabRole; note: string; re: RegExp }> = [
  {
    name: "ANSSI (FR)",
    role: "Security evaluation / certification",
    note: "French CC scheme — ANSSI-CC security certificates (e.g. ANSSI-CC-2022/38, 2022/36v2, 2018/11)",
    re: /anssi/i,
  },
  {
    name: "NSCIB / TÜV Rheinland (NL)",
    role: "Security evaluation / certification",
    note: "Dutch CC scheme — NSCIB-CC / CC-22-… security certificates",
    re: /nscib|CC-\d{2}-\d{6,}/i,
  },
  {
    name: "BSI (DE)",
    role: "Security evaluation / certification",
    note: "German CC scheme — BSI-DSZ security certificates",
    re: /\bbsi\b|BSI-DSZ/i,
  },
  {
    name: "RDW (NL)",
    role: "Functional & interoperability certificate",
    note: "Dutch approval authority — RDW-2016/799-… and RDW-AETR-… functional certificates",
    re: /\brdw\b/i,
  },
  {
    name: "UL TS B.V. (NL)",
    role: "Functional & interoperability certificate",
    note: "Interoperability / functional test laboratory used for RDW approvals",
    re: /\bUL\s?TS\b|UL TS B\.V\./i,
  },
  {
    name: "KBA (DE)",
    role: "Functional & interoperability certificate",
    note: "German Kraftfahrt-Bundesamt functional certificates (…-…/2023 Kontext)",
    re: /\bkba\b/i,
  },
  {
    name: "UTAC (FR)",
    role: "Functional & interoperability certificate",
    note: "French functional certification body",
    re: /utac/i,
  },
  {
    name: "CETIS",
    role: "Functional & interoperability certificate",
    note: "Functional approval referenced via CETIS / JRC",
    re: /cetis/i,
  },
  {
    name: "Swedish Transport Agency (TSV)",
    role: "Functional & interoperability certificate",
    note: "TSV functional certificates (e.g. TSV 2023-756)",
    re: /\bTSV\b|swedish transport/i,
  },
  {
    name: "JRC (EU)",
    role: "Functional & interoperability certificate",
    note: "JRC interoperability certificates / DTC listing",
    re: /\bjrc\b/i,
  },
];

function LabsCard({ cards }: { cards: TachoCard[] }) {
  // v2.56: the selected lab's countries & evidence show in a panel to the right
  // of the table (scrolls on its own) instead of below it.
  const [open, setOpen] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);

  const labs = useMemo(() => {
    const map: Record<
      string,
      {
        role: LabRole;
        note: string;
        entries: Array<{ card: TachoCard; country: string; generation: string; evidence: string }>;
      }
    > = {};
    for (const c of cards) {
      const fields = [
        c.security_certificate_lab,
        c.security_certificate,
        c.functional_certificate_lab,
        c.jrc_certificate_source,
        c.issued_by_authority,
      ].filter(Boolean);
      for (const lab of LAB_PATTERNS) {
        const hit = fields.find((f) => lab.re.test(String(f)));
        if (!hit) continue;
        if (!map[lab.name]) map[lab.name] = { role: lab.role, note: lab.note, entries: [] };
        map[lab.name].entries.push({
          card: c,
          country: c.country,
          generation: c.generation,
          evidence: String(hit),
        });
      }
    }
    return Object.entries(map)
      .map(([name, v]) => ({
        name,
        ...v,
        entries: [...v.entries].sort(
          (a, b) =>
            (a.country || "").localeCompare(b.country || "") ||
            (a.generation || "").localeCompare(b.generation || ""),
        ),
        count: v.entries.length,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [cards]);

  const unmatched = useMemo(
    () =>
      cards.filter(
        (c) =>
          !LAB_PATTERNS.some((l) =>
            [c.security_certificate_lab, c.functional_certificate_lab, c.security_certificate].some(
              (f) => f && l.re.test(String(f)),
            ),
          ),
      ).length,
    [cards],
  );

  // The largest lab is shown until another one is chosen.
  const current = labs.find((l) => l.name === open) ?? labs[0] ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Laboratories &amp; Certification Bodies — who did what
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Derived from the JRC / certificate fields of each record (security certificate, functional
          certificate, issuing authority). {unmatched} record(s) contain no identifiable lab. Click a
          row to see its countries and evidence.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Lab / Body</th>
                  <th className="py-2 pr-3 font-medium">Used for</th>
                  <th className="py-2 pr-3 text-right font-medium">Records</th>
                </tr>
              </thead>
              <tbody>
                {labs.map((l) => {
                  const active = current?.name === l.name;
                  return (
                    <tr
                      key={l.name}
                      onClick={() => setOpen(l.name)}
                      aria-selected={active}
                      className={
                        "cursor-pointer border-b align-top transition-colors last:border-0 hover:bg-accent/60 " +
                        (active ? "bg-accent" : "")
                      }
                    >
                      <td className="py-2 pl-2 pr-3 font-medium">{l.name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="secondary" className="mb-1">
                          {l.role}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{l.note}</p>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.count}</td>
                    </tr>
                  );
                })}
                {labs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      No laboratory information found in the current data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {current && (
            <div className="rounded-md border bg-muted/30 lg:sticky lg:top-4">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {current.name} — countries &amp; evidence
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {current.entries.length} record{current.entries.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto p-3 text-sm lg:max-h-[70vh]">
                {current.entries.map((e, i) => (
                  <li key={`${e.card.id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => setDetailCard(e.card)}
                      title="Open record"
                      className="flex w-full flex-wrap items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
                    >
                      <span className="font-medium">{e.country || "—"}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {e.generation || "—"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{e.evidence}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </Card>
  );
}

/** e-number prefix of a type approval number -> approving authority. */
const E_NUMBER_AUTHORITY: Record<string, string> = {
  e1: "KBA (Germany)",
  e2: "France (ministère chargé des transports / UTAC)",
  e3: "Italy (MIT)",
  e4: "RDW (Netherlands)",
  e5: "Transportstyrelsen / TSV (Sweden)",
  e6: "Belgium (FPS Mobility)",
  e7: "Hungary (NKH/KTI)",
  e8: "Czech Republic (Ministry of Transport)",
  e9: "Spain (Ministerio de Industria)",
  e11: "United Kingdom (VCA/DVSA)",
  e12: "Austria (BMK)",
  e13: "Luxembourg (SNCA)",
  e17: "Finland (Traficom)",
  e19: "Romania (RAR)",
  e20: "Poland (TDT)",
  e21: "Portugal (IMT)",
  e23: "Greece",
  e24: "Ireland (RSA)",
  e25: "Croatia (CVH)",
  e26: "Slovenia",
  e27: "Slovakia",
  e29: "Estonia",
  e32: "Latvia (CSDD)",
  e34: "Bulgaria",
  e36: "Lithuania",
};

type ChainItem = { label: string; value: string; evidence?: string; note?: string };

function certificationChain(card: TachoCard): {
  typeApproval: ChainItem[];
  security: ChainItem[];
  functional: ChainItem[];
} {
  const match = (role: LabRole, fields: Array<[string, string]>): ChainItem[] => {
    const out: ChainItem[] = [];
    for (const lab of LAB_PATTERNS) {
      if (lab.role !== role) continue;
      const hit = fields.find(([, v]) => v && lab.re.test(v));
      if (!hit) continue;
      out.push({ label: lab.name, value: hit[1], evidence: hit[0], note: lab.note });
    }
    return out;
  };

  const ta: ChainItem[] = [];
  const num = (card.type_approval_number || "").trim();
  const eMatch = /\be\s?(\d{1,2})\b/i.exec(num);
  const authority = eMatch ? E_NUMBER_AUTHORITY[`e${eMatch[1]}`] : undefined;
  if (card.issued_by_authority) {
    ta.push({
      label: "Type approval authority",
      value: card.issued_by_authority,
      evidence: "Issued by Authority",
    });
  }
  if (authority) {
    ta.push({
      label: "Derived from approval number",
      value: authority,
      evidence: num,
      note: `The "e${eMatch![1]}" prefix identifies the approving member-state authority.`,
    });
  }
  if (!ta.length && num) {
    ta.push({ label: "Type approval number", value: num, evidence: "no authority identifiable" });
  }

  const security = match("Security evaluation / certification", [
    ["Security Certificate Lab", card.security_certificate_lab],
    ["Security Certificate", card.security_certificate],
    ["Chip Certificate", card.chip_certificate],
    ["Certified Security Platform", card.certified_security_platform],
    ["Date Certificate Issued", card.certificate_issued_date],
    ["Certificate Validity Expiration Date", card.certificate_expiry_date],
  ]);

  const functional = match("Functional & interoperability certificate", [
    ["Functional Certificate Lab", card.functional_certificate_lab],
    ["JRC Interoperability Status", card.jrc_interoperability_status],
    ["JRC / Certificate Source", card.jrc_certificate_source],
    ["Issued by Authority", card.issued_by_authority],
    ["Type Approval Number", card.type_approval_number],
  ]);

  return { typeApproval: ta, security, functional };
}

function ChainGroup({ title, items, empty }: { title: string; items: ChainItem[]; empty: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {items.map((it, i) => (
            <li key={`${it.label}-${i}`} className="rounded-md border bg-card px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{it.label}</span>
                {it.evidence && (
                  <Badge variant="outline" className="text-[10px]">
                    {it.evidence}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 break-words text-sm">{it.value}</p>
              {it.note && <p className="mt-0.5 text-xs text-muted-foreground">{it.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CertificationChainPanel({ card }: { card: TachoCard }) {
  const chain = useMemo(() => certificationChain(card), [card]);
  return (
    <div className="mt-4 rounded-md border bg-muted/30 p-3">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">
          Certification chain — who tested / approved what
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <ChainGroup
          title="Type approval"
          items={chain.typeApproval}
          empty="No approving authority identifiable."
        />
        <ChainGroup
          title="Security evaluation (Common Criteria)"
          items={chain.security}
          empty="No security lab / scheme identifiable."
        />
        <ChainGroup
          title="Functional & interoperability"
          items={chain.functional}
          empty="No functional / interoperability body identifiable."
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Derived from the certificate fields of this record; the badge shows the source field the
        match came from. Cross-check details in the Market Analytics → Laboratories section.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
  className,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  className?: string;
  /** Rendered next to the value — used for the certificate validity badge. */
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm whitespace-pre-wrap">
        {value?.trim() ? value : <span className="text-muted-foreground">—</span>}
        {children}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function LinkField({
  label,
  value,
  className,
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  const links = (value ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {links.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-col gap-1">
          {links.map((l) =>
            l.startsWith("http") ? (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 break-all text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="break-all">{l}</span>
              </a>
            ) : (
              <span key={l} className="text-sm">
                {l}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

type SaveEditResult =
  | { ok: true; applied?: string[]; cleared?: boolean }
  | { ok: false; conflicts: { field: string; original: string; theirs: string; yours: string }[] };

const FIELD_LABEL = new Map<string, string>(
  GROUP1_FIELDS.map(([k, label]) => [k as string, label]),
);

/**
 * v2.54 (code review 18): someone else saved the same field while this edit
 * was open. Nothing was written; the editor chooses per save.
 */
function EditConflictDialog({
  conflict,
  onKeepTheirs,
  onOverwrite,
}: {
  conflict: {
    conflicts: { field: string; original: string; theirs: string; yours: string }[];
  } | null;
  onKeepTheirs: () => void;
  onOverwrite: () => void;
}) {
  return (
    <Dialog open={!!conflict} onOpenChange={(o) => !o && onKeepTheirs()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Someone else changed this record meanwhile</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Nothing was saved. These fields were changed by someone else after you started editing:
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 font-medium">When you started</th>
                <th className="px-2 py-1.5 font-medium">Saved now</th>
                <th className="px-2 py-1.5 font-medium">Yours</th>
              </tr>
            </thead>
            <tbody>
              {(conflict?.conflicts ?? []).map((c) => (
                <tr key={c.field} className="border-t align-top">
                  <td className="px-2 py-1.5 font-medium">{FIELD_LABEL.get(c.field) ?? c.field}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{c.original || "—"}</td>
                  <td className="px-2 py-1.5">{c.theirs || "—"}</td>
                  <td className="px-2 py-1.5 font-medium">{c.yours || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onKeepTheirs}>
            Keep saved values
          </Button>
          <Button onClick={onOverwrite}>Overwrite with mine</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
