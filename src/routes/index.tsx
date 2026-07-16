import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ExternalLink, ShieldCheck, FileText, Building2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tachograph Cards Info Tool" },
      {
        name: "description",
        content:
          "Konsolidierte Übersicht aller europäischen Tachographen-Karten (G1, G2.1, G2.2): Hersteller, Chip-Plattformen, Zertifikate und Beschaffungsdaten.",
      },
      { property: "og:title", content: "Tachograph Cards Info Tool" },
      {
        property: "og:description",
        content:
          "Durchsuche europäische Tachographen-Karten nach Land, Generation und Hersteller.",
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

function useCards() {
  return useQuery({
    queryKey: ["tachograph_cards"],
    queryFn: async (): Promise<TachoCard[]> => {
      const { data, error } = await supabase
        .from("tachograph_cards")
        .select("*")
        .order("country");
      if (error) throw error;
      return data as TachoCard[];
    },
  });
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((s) => s && s.trim().length > 0))).sort();
}

function TachographTool() {
  const { data: cards, isLoading, error } = useCards();
  const [country, setCountry] = useState("all");
  const [generation, setGeneration] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const countries = useMemo(
    () => uniq((cards ?? []).map((c) => c.country)),
    [cards],
  );
  const generations = useMemo(
    () => uniq((cards ?? []).map((c) => c.generation)),
    [cards],
  );
  const manufacturers = useMemo(
    () => uniq((cards ?? []).map((c) => c.current_manufacturer_normalized)),
    [cards],
  );

  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = search.toLowerCase();
    return cards.filter((c) => {
      if (country !== "all" && c.country !== country) return false;
      if (generation !== "all" && c.generation !== generation) return false;
      if (
        manufacturer !== "all" &&
        c.current_manufacturer_normalized !== manufacturer
      )
        return false;
      if (!q) return true;
      return Object.values(c).some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      );
    });
  }, [cards, country, generation, manufacturer, search]);

  const selected =
    filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Tachograph Cards Info Tool
              </h1>
              <p className="text-sm text-muted-foreground">
                Consolidated certification &amp; procurement data for
                European driver cards (G1 · G2.1 · G2.2)
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="grid gap-3 pt-6 md:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Freitextsuche
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="z. B. Thales, e4-0030-00, ANSSI…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Country
              </label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger>
                  <SelectValue placeholder="Alle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Länder</SelectItem>
                  {countries.map((c) => {
                    const flag =
                      (cards ?? []).find((x) => x.country === c)
                        ?.country_flag ?? "";
                    return (
                      <SelectItem key={c} value={c}>
                        {flag} {c}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Generation
              </label>
              <Select value={generation} onValueChange={setGeneration}>
                <SelectTrigger>
                  <SelectValue placeholder="Alle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Generationen</SelectItem>
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
                  <SelectValue placeholder="Alle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Hersteller</SelectItem>
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

        {isLoading && (
          <p className="text-sm text-muted-foreground">Lade Daten…</p>
        )}
        {error && (
          <p className="text-sm text-destructive">
            Fehler beim Laden: {String(error)}
          </p>
        )}

        {!isLoading && !error && (
          <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
            {/* Results list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {filtered.length} Ergebnis{filtered.length === 1 ? "" : "se"}
                </p>
              </div>
              <ScrollArea className="h-[70vh] rounded-lg border bg-card">
                <div className="divide-y">
                  {filtered.map((c) => {
                    const active = selected?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={
                          "flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors hover:bg-accent " +
                          (active ? "bg-accent" : "")
                        }
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="font-medium">
                            <span className="mr-1 text-lg">
                              {c.country_flag}
                            </span>
                            {c.country}
                          </span>
                          <Badge variant="secondary">{c.generation}</Badge>
                        </div>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {c.current_manufacturer_normalized ||
                            c.current_manufacturer ||
                            "—"}
                        </p>
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Keine Treffer.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Detail */}
            <div>
              {selected ? (
                <DetailView card={selected} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Wähle links ein Land aus.
                </p>
              )}
            </div>
          </div>
        )}

        <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
          Datenstand:{" "}
          {cards?.[0]?.data_reference_date ?? "—"} · Quelle: JRC, ANSSI, RDW,
          nationale Behörden &amp; öffentliche Beschaffungsdaten.
        </footer>
      </main>
    </div>
  );
}

function DetailView({ card }: { card: TachoCard }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-4xl leading-none">{card.country_flag}</span>
        <div>
          <h2 className="text-2xl font-semibold">{card.country}</h2>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge>{card.generation || "—"}</Badge>
            {card.tachograph_application_os && (
              <Badge variant="outline">{card.tachograph_application_os}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Antwort Gruppe 1 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Karte &amp; Zertifizierung
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <Field label="Country" value={`${card.country_flag} ${card.country}`} />
          <Field label="Generation" value={card.generation} />
          <Field label="Application" value={card.application} />
          <Field
            label="Current Manufacturer / Personalizer (normalized)"
            value={card.current_manufacturer_normalized}
            sub={
              card.current_manufacturer !==
              card.current_manufacturer_normalized
                ? card.current_manufacturer
                : undefined
            }
          />
          <Field label="Chip Platform (Vendor)" value={card.chip_platform_vendor} />
          <Field label="Security Certificate (OS)" value={card.security_certificate} />
          <Field label="Chip Certificate" value={card.chip_certificate} />
          <Field label="Type Approval Number" value={card.type_approval_number} />
          <Field
            label="Certified Security Platform / Chip Reference"
            value={card.certified_security_platform}
          />
          <Field label="Date / Status" value={card.date_status} />
          <Field label="Issued by (Authority)" value={card.issued_by_authority} />
          <Field
            label="JRC Interoperability Status"
            value={card.jrc_interoperability_status}
          />
          <Field
            label="Functional Certificate / Laboratory"
            value={card.functional_certificate_lab}
          />
          <Field
            label="Tachograph Application / OS"
            value={card.tachograph_application_os}
          />
          <Field
            label="Distinction from Card Manufacturer / Personalizer"
            value={card.distinction_from_manufacturer}
            className="md:col-span-2"
          />
          <LinkField
            label="JRC / Certificate Source"
            value={card.jrc_certificate_source}
            className="md:col-span-2"
          />
        </CardContent>
      </Card>

      {/* Antwort Gruppe 2 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Beschaffung
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <Field
            label="Latest Tender / Procurement Procedure"
            value={card.latest_tender}
            className="md:col-span-2"
          />
          <Field label="Winner / Contractor" value={card.winner_contractor} />
          <Field
            label="Procurement Status / Assessment"
            value={card.procurement_status}
          />
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
            <p className="text-sm text-muted-foreground">
              {card.verification_note}
            </p>
          </CardContent>
        </Card>
      )}
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
      <div className="text-sm">{value?.trim() ? value : <span className="text-muted-foreground">—</span>}</div>
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
