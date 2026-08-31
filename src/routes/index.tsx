import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { saveCardOverride, resetCardOverride } from "@/lib/cards.functions";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";
import thalesLogo from "@/assets/thales-logo.png.asset.json";

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
};

type Overrides = Record<string, Partial<TachoCard>>;

function useOverrides() {
  return useQuery({
    queryKey: ["tachograph_card_overrides"],
    queryFn: async (): Promise<Overrides> => {
      const { data, error } = await supabase
        .from("tachograph_card_overrides")
        .select("card_id, patch");
      if (error) throw error;
      const map: Overrides = {};
      for (const row of data ?? []) {
        map[row.card_id] = (row.patch ?? {}) as Partial<TachoCard>;
      }
      return map;
    },
  });
}


function useCards() {
  return useQuery({
    queryKey: ["tachograph_cards"],
    queryFn: async (): Promise<TachoCard[]> => {
      const { data, error } = await supabase.from("tachograph_cards").select("*").order("country");
      if (error) throw error;
      return data as TachoCard[];
    },
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
];

function TachographTool() {
  const { data: rawCards, isLoading, error } = useCards();
  const auth = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"data" | "analytics" | "updates">("data");
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
          <div className="flex gap-2">
            <Button
              variant={tab === "data" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("data")}
            >
              <FileText className="mr-2 h-4 w-4" /> Data
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
            onSave={saveOverride}
            onReset={resetOverride}
          />
        )}
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
  onSave,
  onReset,
}: {
  cards: TachoCard[];
  overrides: Overrides;
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

function DetailView({
  card,
  edited,
  onSave,
  onReset,
}: {
  card: TachoCard;
  edited: boolean;
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
              {!editing && (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                </Button>
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
