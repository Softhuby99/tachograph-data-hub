import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  saveCardOverride,
  resetCardOverride,
  getCards,
  getOverrides,
} from "@/lib/cards.functions";
import { getAuthMode } from "@/lib/auth-mode.functions";
import { APP_VERSION } from "@/lib/version";
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
} from "lucide-react";
import thalesLogo from "@/assets/thales-logo.png.asset.json";
import { WorldMapView } from "@/components/WorldMapView";

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
  generation: string;
  application: string;
  current_manufacturer: string;
  current_manufacturer_normalized: string;
  chip_platform_vendor: string;
  security_certificate: string;
  chip_certificate: string;
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

const COUNTRY_ISO: Record<string, string> = {
  Albania: "al",
  Armenia: "am",
  Austria: "at",
  Azerbaijan: "az",
  Belarus: "by",
  Belgium: "be",
  "Bosnia and Herzegovina": "ba",
  Bulgaria: "bg",
  Croatia: "hr",
  Cyprus: "cy",
  Czechia: "cz",
  Denmark: "dk",
  Estonia: "ee",
  Finland: "fi",
  France: "fr",
  Georgia: "ge",
  Germany: "de",
  Greece: "gr",
  Hungary: "hu",
  Iceland: "is",
  Ireland: "ie",
  Israel: "il",
  Italy: "it",
  Kazakhstan: "kz",
  Kyrgyzstan: "kg",
  Latvia: "lv",
  Liechtenstein: "li",
  Lithuania: "lt",
  Luxembourg: "lu",
  Malta: "mt",
  Moldova: "md",
  Monaco: "mc",
  Montenegro: "me",
  Netherlands: "nl",
  "North Macedonia": "mk",
  Norway: "no",
  Poland: "pl",
  Portugal: "pt",
  Romania: "ro",
  Russia: "ru",
  "San Marino": "sm",
  Serbia: "rs",
  Slovakia: "sk",
  Slovenia: "si",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tajikistan: "tj",
  Turkmenistan: "tm",
  Türkiye: "tr",
  Ukraine: "ua",
  "United Kingdom": "gb",
  Uzbekistan: "uz",
};

function flagUrl(country: string, size: 40 | 80 = 40): string | null {
  const code = COUNTRY_ISO[country];
  return code ? `https://flagcdn.com/w${size}/${code}.png` : null;
}

const GROUP1_FIELDS: Array<[keyof TachoCard, string]> = [
  ["country", "Country"],
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
  const canEdit = !authEnabled || !!auth.session;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"data" | "map" | "analytics" | "updates">("data");
  const overridesQuery = useOverrides();
  const overrides = overridesQuery.data ?? {};

  const saveOverrideFn = useServerFn(saveCardOverride);
  const resetOverrideFn = useServerFn(resetCardOverride);

  const cards = useMemo(
    () => (rawCards ?? []).map((c) => ({ ...c, ...(overrides[c.id] ?? {}) })) as TachoCard[],
    [rawCards, overrides],
  );

  const saveMutation = useMutation({
    mutationFn: (vars: { cardId: string; patch: Record<string, string> }) =>
      saveOverrideFn({ data: vars }),
    onSuccess: () => {
      toast.success("Changes saved for everyone.");
      void qc.invalidateQueries({ queryKey: ["tachograph_card_overrides"] });
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });

  const resetMutation = useMutation({
    mutationFn: (cardId: string) => resetOverrideFn({ data: { cardId } }),
    onSuccess: () => {
      toast.success("Manual edits removed.");
      void qc.invalidateQueries({ queryKey: ["tachograph_card_overrides"] });
    },
    onError: (e: Error) => toast.error(`Reset failed: ${e.message}`),
  });

  const saveOverride = (id: string, patch: Partial<TachoCard>) => {
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
              <img src={thalesLogo.url} alt="Thales logo" className="h-7 w-auto object-contain" />
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
            <span className="mx-1 h-8 w-px bg-border" />
            {auth.session ? (
              <Button variant="ghost" size="sm" onClick={() => void auth.signOut()}>
                Sign out
              </Button>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
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
            canEdit={!!auth.session}
            onSave={saveOverride}
            onReset={resetOverride}
          />
        )}
        {!isLoading && !error && tab === "map" && <WorldMapView cards={cards} />}
        {!isLoading && !error && tab === "analytics" && <AnalyticsView cards={cards} />}
        {tab === "updates" && <UpdatesView />}

        <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
          Data as of: {cards?.[0]?.data_reference_date ?? "—"} · Source: JRC, ANSSI, RDW, national
          authorities &amp; public procurement records.
        </footer>
      </main>
    </div>
  );
}

function DataView({
  cards,
  overrides,
  canEdit,
  onSave,
  onReset,
}: {
  cards: TachoCard[];
  overrides: Overrides;
  canEdit: boolean;
  onSave: (id: string, patch: Partial<TachoCard>) => void;
  onReset: (id: string) => void;
}) {
  const [country, setCountry] = useState("all");
  const [generation, setGeneration] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const countries = useMemo(() => uniq(cards.map((c) => c.country)), [cards]);
  const generations = useMemo(() => uniq(cards.map((c) => c.generation)), [cards]);
  const manufacturers = useMemo(
    () => uniq(cards.map((c) => c.current_manufacturer_normalized)),
    [cards],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cards.filter((c) => {
      if (country !== "all" && c.country !== country) return false;
      if (generation !== "all" && c.generation !== generation) return false;
      if (manufacturer !== "all" && c.current_manufacturer_normalized !== manufacturer)
        return false;
      if (!q) return true;
      return Object.values(c).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [cards, country, generation, manufacturer, search]);

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
        </CardContent>
      </Card>

      {manufacturer !== "all" && (
        <ManufacturerTimeline manufacturer={manufacturer} cards={filtered} />
      )}



      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {filtered.length} result{filtered.length === 1 ? "" : "s"}
            </p>
          </div>
          <ScrollArea className="h-[70vh] rounded-lg border bg-card">
            <div className="divide-y">
              {filtered.map((c) => {
                const active = selected?.id === c.id;
                const fUrl = flagUrl(c.country, 40);
                const edited = !!overrides[c.id];
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
                          {c.country}
                          {edited && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              edited
                            </Badge>
                          )}
                        </span>
                        <Badge variant="secondary">{c.generation}</Badge>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No matches.</p>
              )}
            </div>
          </ScrollArea>
        </div>

        <div>
          {selected ? (
            <DetailView
              card={selected}
              edited={!!overrides[selected.id]}
              canEdit={canEdit}
              onSave={(patch) => onSave(selected.id, patch)}
              onReset={() => onReset(selected.id)}
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
      return list.sort((a, b) =>
        a.card.country.localeCompare(b.card.country),
      );
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
  onSave,
  onReset,
}: {
  card: TachoCard;
  edited: boolean;
  canEdit: boolean;
  onSave: (patch: Partial<TachoCard>) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

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
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft({});
  };
  const save = () => {
    onSave(draft as Partial<TachoCard>);
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
            {card.country}
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
                <span className="text-xs text-muted-foreground">Sign in to edit</span>
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
            const value = String((card as Record<string, unknown>)[key] ?? "");
            if (editing) {
              return (
                <div key={key} className="md:col-span-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <Textarea
                    className="mt-1 min-h-[40px] text-sm"
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  />
                </div>
              );
            }
            if (key === "jrc_certificate_source" || key === "primary_source") {
              return <LinkField key={key} label={label} value={value} className="md:col-span-2" />;
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
    </div>
  );
}

function AnalyticsView({ cards }: { cards: TachoCard[] }) {
  const [drillGen, setDrillGen] = useState<string | null>(null);
  const [drillMan, setDrillMan] = useState<string | null>(null);
  const total = cards.length;

  const genCounts = useMemo(() => {
    const m: Record<string, number> = {};
    cards.forEach((c) => {
      m[c.generation] = (m[c.generation] ?? 0) + 1;
    });
    return m;
  }, [cards]);
  const gens = ["G1", "G2.1", "G2.2"].filter((g) => genCounts[g]);
  const genMax = Math.max(1, ...Object.values(genCounts));

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

  const genDrillCountries = drillGen
    ? cards
        .filter((c) => c.generation === drillGen)
        .map((c) => `${c.country_flag ?? ""} ${c.country}`)
        .sort()
    : [];
  const manDrillCountries = drillMan
    ? cards
        .filter((c) => (c.current_manufacturer_normalized || c.current_manufacturer) === drillMan)
        .map((c) => `${c.country_flag ?? ""} ${c.country} (${c.generation})`)
        .sort()
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Market Analytics</h2>
        <p className="text-sm text-muted-foreground">
          {total} records across {gens.length} generation(s)
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Countries per Generation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {gens.map((g) => (
              <button
                key={g}
                onClick={() => setDrillGen(drillGen === g ? null : g)}
                className="grid w-full grid-cols-[60px_1fr_90px] items-center gap-3 rounded p-1 text-left hover:bg-accent"
              >
                <span className="font-semibold">{g}</span>
                <div className="h-5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(genCounts[g] / genMax) * 100}%` }}
                  />
                </div>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  {genCounts[g]} ({((genCounts[g] / total) * 100).toFixed(1)}%)
                </span>
              </button>
            ))}
            {drillGen && (
              <div className="mt-3 rounded-md border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Countries with {drillGen}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setDrillGen(null)}>
                    Close
                  </Button>
                </div>
                <ul className="grid grid-cols-2 gap-x-4 text-sm md:grid-cols-3">
                  {genDrillCountries.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Market Share by Generation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {gens.map((g) => {
              const pct = (genCounts[g] / total) * 100;
              return (
                <button
                  key={g}
                  onClick={() => setDrillGen(drillGen === g ? null : g)}
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Manufacturers — Type Approvals &amp; Countries
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Manufacturer</th>
                  <th className="py-2 pr-3 text-right font-medium">Type Approvals</th>
                  <th className="py-2 pr-3 text-right font-medium">Countries</th>
                  <th className="py-2 pr-3 text-right font-medium">Market Share</th>
                  <th className="py-2 pr-3 font-medium w-56"></th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {mfgList.map((m) => (
                  <tr key={m.name} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{m.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.approvals}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.countries}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.share.toFixed(1)}%</td>
                    <td className="py-2 pr-3">
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
                        onClick={() => setDrillMan(drillMan === m.name ? null : m.name)}
                      >
                        {drillMan === m.name ? "Hide" : "Show countries"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {drillMan && (
            <div className="mt-4 rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {drillMan} — countries
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDrillMan(null)}>
                  Close
                </Button>
              </div>
              <ul className="grid grid-cols-2 gap-x-4 text-sm md:grid-cols-3">
                {manDrillCountries.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <LabsCard cards={cards} />
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
  const [open, setOpen] = useState<string | null>(null);

  const labs = useMemo(() => {
    const map: Record<
      string,
      {
        role: LabRole;
        note: string;
        entries: Array<{ country: string; generation: string; evidence: string }>;
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
          country: c.country,
          generation: c.generation,
          evidence: String(hit),
        });
      }
    }
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v, count: v.entries.length }))
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Laboratories &amp; Certification Bodies — who did what
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Derived from the JRC / certificate fields of each record (security certificate, functional
          certificate, issuing authority). {unmatched} record(s) contain no identifiable lab.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Lab / Body</th>
                <th className="py-2 pr-3 font-medium">Used for</th>
                <th className="py-2 pr-3 text-right font-medium">Records</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {labs.map((l) => (
                <tr key={l.name} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3 font-medium">{l.name}</td>
                  <td className="py-2 pr-3">
                    <Badge variant="secondary" className="mb-1">
                      {l.role}
                    </Badge>
                    <p className="text-xs text-muted-foreground">{l.note}</p>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.count}</td>
                  <td className="py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpen(open === l.name ? null : l.name)}
                    >
                      {open === l.name ? "Hide" : "Details"}
                    </Button>
                  </td>
                </tr>
              ))}
              {labs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No laboratory information found in the current data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {open && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">
                {open} — countries &amp; evidence
              </span>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                Close
              </Button>
            </div>
            <ul className="space-y-1 text-sm">
              {labs
                .find((l) => l.name === open)
                ?.entries.sort((a, b) => a.country.localeCompare(b.country))
                .map((e, i) => (
                  <li key={`${e.country}-${i}`} className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{e.country}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {e.generation}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{e.evidence}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
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

function ChainGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: ChainItem[];
  empty: string;
}) {
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
        <span className="text-sm font-semibold">Certification chain — who tested / approved what</span>
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
}: {
  label: string;
  value?: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm whitespace-pre-wrap">
        {value?.trim() ? value : <span className="text-muted-foreground">—</span>}
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
