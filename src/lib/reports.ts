// v2.83: the four product-marketing reports (menu "Reports").
//
//   1. Market share   — who supplies the cards of each generation, by country
//   2. Moves          — new approvals of the last 12 months, supplier changes
//                       from one generation to the next ("who replaced whom")
//   3. Opportunities  — countries without a G2.2 approval, security
//                       certificates running out, documented tenders
//   4. Dependencies   — which security certificate (platform) the approvals
//                       of which countries rest on, and when it expires
//
// All four read the same thing: the card records and the market status lanes
// (market-status.ts). Cards only — vehicle units and motion sensors are not
// part of these reports. Pure functions without server imports, so the view,
// the CSV export and the tests share them.

import { parseLooseDate } from "./expiry";
import { generationRank, type MarketGroup, type MarketStatusEntry } from "./market-status";
import { parseCertificate } from "./cert-family";
import { chipPlatformOf } from "./chip-platform";
import { normalizeCountry } from "./country-flag";

export type ReportCard = {
  id: string;
  country?: string | null;
  device_type?: string | null;
  generation?: string | null;
  type_approval_number?: string | null;
  current_manufacturer?: string | null;
  current_manufacturer_normalized?: string | null;
  date_status?: string | null;
  security_certificate?: string | null;
  security_certificate_lab?: string | null;
  chip_certificate?: string | null;
  certificate_expiry_date?: string | null;
  certified_security_platform?: string | null;
  chip_platform_vendor?: string | null;
  latest_tender?: string | null;
  winner_contractor?: string | null;
  procurement_status?: string | null;
  tender_source?: string | null;
};

export type ReportLine = { name: string; vendor: string; families: string[] };

export const GENERATIONS = ["G1", "G2.1", "G2.2"] as const;
export type Generation = (typeof GENERATIONS)[number];

export const UNKNOWN = "Not known";
const DAY = 86_400_000;

const str = (v: unknown) => String(v ?? "").trim();

// ------------------------------------------------------------------ suppliers
//
// The manufacturer field is free text: "AKD", "AKD d.o.o." and "Agencija za
// komercijalnu djelatnost d.o.o (AKD)" are one company. Counted as written,
// they split a supplier's share and turn a renewal into a "supplier change".
// Only spellings of the same company are grouped — no mergers, no parents.

const SUPPLIER_GROUPS: [RegExp, string][] = [
  [/thales|gemalto/i, "Thales"],
  [/idemia|oberthur|morpho/i, "IDEMIA"],
  [/imprimerie nationale|\bin groupe\b/i, "Imprimerie Nationale"],
  [/\bakd\b|agencija za komercijalnu/i, "AKD"],
  [/pwpw|polska wytw/i, "PWPW"],
  [/austria card/i, "Austria Card"],
  [/giesecke|g\s*[+&]\s*d\b/i, "Giesecke+Devrient"],
  [/kraftfahrt-bundesamt|\bkba\b/i, "Kraftfahrt-Bundesamt"],
  [/cardplus/i, "CardPlus"],
  [/fnmt|real casa de la moneda/i, "FNMT-RCM"],
  [/security printing and systems/i, "Security Printing and Systems"],
  [/\btobb\b|union of chambers/i, "TOBB"],
  [/lodvila/i, "Lodvila"],
  [/hungarian banknote/i, "Hungarian Banknote Printing"],
  [/st[áa]tn[íi] tisk[áa]rna cenin/i, "Státní tiskárna cenin"],
];
const SUPPLIER_PLACEHOLDER =
  /^$|to be verified|not publicly documented|not identified|not confirmed|unknown|^[-–—]+$/i;

/** One name per company; UNKNOWN for placeholders. */
export function supplierName(raw: unknown): string {
  // "PWPW S.A. / DEMAX": the first name is the approval holder.
  const first = str(raw).split(/\s+\/\s+/)[0] ?? "";
  if (SUPPLIER_PLACEHOLDER.test(first)) return UNKNOWN;
  for (const [re, name] of SUPPLIER_GROUPS) if (re.test(first)) return name;
  return first;
}

// --------------------------------------------------------------------- basics

/** EU, EEA, Switzerland and the United Kingdom: the smart tachograph 2 area. */
const G22_AREA = new Set(
  [
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Cyprus",
    "Czech Republic",
    "Czechia",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Italy",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
    "Iceland",
    "Liechtenstein",
    "Norway",
    "Switzerland",
    "United Kingdom",
  ].map((c) => c.toLowerCase()),
);
export function inG22Area(country: string): boolean {
  return G22_AREA.has(normalizeCountry(country).toLowerCase());
}

/** A record without a real country ("", "unknown", "Not identified") belongs to no market. */
const NO_COUNTRY =
  /^(unknown|not (identified|confirmed|known|published)|n\/?a|to be verified|[-–—]+)$/i;

function splitCountries(value: string): string[] {
  return str(value)
    .split(/\s*(?:,|;|\/|\+|&)\s*/)
    .map((p) => normalizeCountry(p))
    .filter((p) => p && !NO_COUNTRY.test(p));
}

/** "08.06.2023 (JRC-Listung)" → the date; free text → null. */
function approvalDate(text: string): Date | null {
  return parseLooseDate(str(text).replace(/\s*\([^)]*\)\s*$/, ""));
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

function generationOf(value: unknown): Generation | null {
  const r = generationRank(str(value));
  return r === 1 ? "G1" : r === 2 ? "G2.1" : r === 3 ? "G2.2" : null;
}

/** The newest approval of one generation in one country. */
export type Leader = {
  cardId: string;
  country: string;
  generation: Generation;
  supplier: string;
  typeApproval: string;
  date: Date | null;
  status: string;
};

/**
 * Per country and generation the newest card approval. A record naming two
 * countries ("Bulgaria, Poland") counts for both; where a country appears in
 * several lanes the newer date wins.
 */
export function generationLeaders(groups: MarketGroup[]): Map<string, Map<Generation, Leader>> {
  const out = new Map<string, Map<Generation, Leader>>();
  for (const g of groups) {
    if (g.deviceType !== "Card") continue;
    for (const country of splitCountries(g.country)) {
      const byGen = out.get(country) ?? new Map<Generation, Leader>();
      for (const e of g.entries) {
        const generation = generationOf(e.generation);
        if (!generation) continue;
        const date = approvalDate(e.ranking_date);
        const have = byGen.get(generation);
        // Lanes are sorted newest first, so the first entry of a generation is
        // its leader; across lanes the dated, newer one wins.
        if (have && !(date && (!have.date || date > have.date))) continue;
        // A country enters the reports with its first approval of a known generation.
        out.set(country, byGen);
        byGen.set(generation, {
          cardId: e.id,
          country,
          generation,
          supplier: supplierName(e.manufacturer),
          typeApproval: e.type_approval_number,
          date,
          status: e.status,
        });
      }
    }
  }
  return out;
}

function latestLeader(byGen: Map<Generation, Leader>): Leader | null {
  for (const g of [...GENERATIONS].reverse()) {
    const l = byGen.get(g);
    if (l) return l;
  }
  return null;
}

// ------------------------------------------------------------ 1. market share

export type ShareRow = { name: string; count: number; share: number; countries: string[] };
export type ShareBlock = { total: number; rows: ShareRow[] };

function shareBlock(items: { name: string; country: string }[]): ShareBlock {
  const by = new Map<string, string[]>();
  for (const i of items) by.set(i.name, [...(by.get(i.name) ?? []), i.country]);
  const total = items.length;
  const rows = [...by]
    .map(([name, countries]) => ({
      name,
      count: countries.length,
      share: total ? countries.length / total : 0,
      countries: countries.sort((a, b) => a.localeCompare(b)),
    }))
    // "Not known" always last, whatever its size.
    .sort(
      (a, b) =>
        Number(a.name === UNKNOWN) - Number(b.name === UNKNOWN) ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    );
  return { total, rows };
}

export type MarketShareReport = {
  countries: number;
  /** Supplier of each country's newest generation. */
  latest: ShareBlock;
  generations: { generation: Generation; suppliers: ShareBlock; platforms: ShareBlock }[];
};

export function marketShareReport(cards: ReportCard[], groups: MarketGroup[]): MarketShareReport {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const leaders = generationLeaders(groups);
  const latest: { name: string; country: string }[] = [];
  for (const [country, byGen] of leaders) {
    const l = latestLeader(byGen);
    if (l) latest.push({ name: l.supplier, country });
  }
  return {
    countries: leaders.size,
    latest: shareBlock(latest),
    generations: GENERATIONS.map((generation) => {
      const list = [...leaders.values()]
        .map((byGen) => byGen.get(generation))
        .filter((l): l is Leader => !!l);
      return {
        generation,
        suppliers: shareBlock(list.map((l) => ({ name: l.supplier, country: l.country }))),
        platforms: shareBlock(
          list.map((l) => {
            const card = byId.get(l.cardId);
            return { name: (card && chipPlatformOf(card).vendor) || UNKNOWN, country: l.country };
          }),
        ),
      };
    }),
  };
}

// ------------------------------------------------------------------- 2. moves

export type RecentApproval = {
  cardId: string;
  country: string;
  generation: string;
  supplier: string;
  typeApproval: string;
  date: string;
  days: number;
  previousSupplier: string;
  /** first = first approval in the country, same = same supplier, switch = another supplier. */
  kind: "first" | "same" | "switch";
};

export type SupplierSwitch = {
  country: string;
  fromGeneration: Generation;
  fromSupplier: string;
  toGeneration: Generation;
  toSupplier: string;
  date: string;
};

export type MovesReport = {
  recent: RecentApproval[];
  switches: SupplierSwitch[];
  /** Generation steps where the supplier stayed. */
  kept: number;
  balance: { supplier: string; won: number; lost: number; net: number }[];
};

export const RECENT_DAYS = 365;

export function movesReport(groups: MarketGroup[], today = new Date()): MovesReport {
  const recent: RecentApproval[] = [];
  for (const g of groups) {
    if (g.deviceType !== "Card") continue;
    g.entries.forEach((e, index) => {
      if (e.ranking_date_source !== "approval") return;
      const date = approvalDate(e.ranking_date);
      if (!date) return;
      const days = Math.floor((today.getTime() - date.getTime()) / DAY);
      if (days < 0 || days > RECENT_DAYS) return;
      const supplier = supplierName(e.manufacturer);
      // The approval this one follows: the next older entry of the lane.
      const previous = g.entries
        .slice(index + 1)
        .map((p) => supplierName(p.manufacturer))
        .find((s) => s !== UNKNOWN);
      recent.push({
        cardId: e.id,
        country: g.country,
        generation: e.generation,
        supplier,
        typeApproval: e.type_approval_number,
        date: iso(date),
        days,
        previousSupplier: previous ?? "",
        kind: !previous ? "first" : previous === supplier ? "same" : "switch",
      });
    });
  }
  recent.sort((a, b) => a.days - b.days || a.country.localeCompare(b.country));

  const switches: SupplierSwitch[] = [];
  let kept = 0;
  const won = new Map<string, number>();
  const lost = new Map<string, number>();
  for (const [country, byGen] of generationLeaders(groups)) {
    const steps = GENERATIONS.map((g) => byGen.get(g)).filter((l): l is Leader => !!l);
    for (let i = 1; i < steps.length; i++) {
      const from = steps[i - 1]!;
      const to = steps[i]!;
      if (from.supplier === UNKNOWN || to.supplier === UNKNOWN) continue;
      if (from.supplier === to.supplier) {
        kept += 1;
        continue;
      }
      switches.push({
        country,
        fromGeneration: from.generation,
        fromSupplier: from.supplier,
        toGeneration: to.generation,
        toSupplier: to.supplier,
        date: iso(to.date),
      });
      won.set(to.supplier, (won.get(to.supplier) ?? 0) + 1);
      lost.set(from.supplier, (lost.get(from.supplier) ?? 0) + 1);
    }
  }
  switches.sort(
    (a, b) => (b.date || "0").localeCompare(a.date || "0") || a.country.localeCompare(b.country),
  );
  const balance = [...new Set([...won.keys(), ...lost.keys()])]
    .map((supplier) => {
      const w = won.get(supplier) ?? 0;
      const l = lost.get(supplier) ?? 0;
      return { supplier, won: w, lost: l, net: w - l };
    })
    .sort((a, b) => b.net - a.net || b.won - a.won || a.supplier.localeCompare(b.supplier));
  return { recent, switches, kept, balance };
}

// ----------------------------------------------------------- 3. opportunities

export type OpenCountry = {
  country: string;
  /** In the EU / EEA / CH / UK, where the smart tachograph 2 is mandatory. */
  g22Area: boolean;
  generation: Generation;
  supplier: string;
  typeApproval: string;
  date: string;
};

export type ExpiryBucket = "expired" | "0-6" | "6-12" | "12-18";

export type ExpiringApproval = {
  cardId: string;
  country: string;
  generation: string;
  supplier: string;
  typeApproval: string;
  certificate: string;
  expiry: string;
  days: number;
  bucket: ExpiryBucket;
};

export type TenderNote = {
  country: string;
  generation: string;
  supplier: string;
  tender: string;
  winner: string;
  status: string;
  source: string;
};

export type PipelineReport = {
  withoutG22: OpenCountry[];
  expiring: ExpiringApproval[];
  tenders: TenderNote[];
  /** Current card approvals, and how many of them carry an expiry date. */
  coverage: { current: number; withExpiry: number };
};

export const EXPIRY_HORIZON_DAYS = 548; // 18 months

export function pipelineReport(
  cards: ReportCard[],
  groups: MarketGroup[],
  statusById: Map<string, MarketStatusEntry>,
  today = new Date(),
): PipelineReport {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const leaders = generationLeaders(groups);

  const withoutG22: OpenCountry[] = [];
  const tenders: TenderNote[] = [];
  for (const [country, byGen] of leaders) {
    const l = latestLeader(byGen);
    if (!l) continue;
    if (!byGen.has("G2.2")) {
      withoutG22.push({
        country,
        g22Area: inG22Area(country),
        generation: l.generation,
        supplier: l.supplier,
        typeApproval: l.typeApproval,
        date: iso(l.date),
      });
    }
    const card = byId.get(l.cardId);
    const tender = str(card?.latest_tender);
    if (tender && !/not researched/i.test(tender)) {
      tenders.push({
        country,
        generation: l.generation,
        supplier: l.supplier,
        tender,
        winner: str(card?.winner_contractor),
        status: str(card?.procurement_status),
        source: str(card?.tender_source),
      });
    }
  }
  withoutG22.sort(
    (a, b) => Number(b.g22Area) - Number(a.g22Area) || a.country.localeCompare(b.country),
  );
  tenders.sort((a, b) => a.country.localeCompare(b.country));

  const expiring: ExpiringApproval[] = [];
  let current = 0;
  let withExpiry = 0;
  for (const c of cards) {
    if (str(c.device_type || "Card") !== "Card") continue;
    if (statusById.get(c.id)?.status !== "current") continue;
    current += 1;
    const expiry = parseLooseDate(c.certificate_expiry_date);
    if (!expiry) continue;
    withExpiry += 1;
    const days = Math.floor((expiry.getTime() - today.getTime()) / DAY);
    if (days > EXPIRY_HORIZON_DAYS) continue;
    expiring.push({
      cardId: c.id,
      country: str(c.country),
      generation: str(c.generation),
      supplier: supplierName(c.current_manufacturer_normalized || c.current_manufacturer),
      typeApproval: str(c.type_approval_number),
      certificate: str(c.security_certificate),
      expiry: iso(expiry),
      days,
      bucket: days < 0 ? "expired" : days <= 183 ? "0-6" : days <= 365 ? "6-12" : "12-18",
    });
  }
  expiring.sort((a, b) => a.days - b.days || a.country.localeCompare(b.country));
  return { withoutG22, expiring, tenders, coverage: { current, withExpiry } };
}

// ------------------------------------------------------------ 4. dependencies

export type FamilyRow = {
  family: string;
  /** Platform line the family is assigned to ("" when none). */
  line: string;
  vendor: string;
  approvals: number;
  current: number;
  /** Countries of the current approvals. */
  countries: string[];
  suppliers: string[];
  generations: string[];
  /** Earliest and latest expiry among the current approvals ("" when unknown). */
  expiryFrom: string;
  expiryTo: string;
  /** Days until the earliest expiry (null when unknown). */
  days: number | null;
};

export type DependencyReport = {
  cards: number;
  withCertificate: number;
  families: FamilyRow[];
};

export function dependencyReport(
  cards: ReportCard[],
  statusById: Map<string, MarketStatusEntry>,
  lines: ReportLine[] = [],
  today = new Date(),
): DependencyReport {
  const lineOf = new Map<string, ReportLine>();
  for (const l of lines) for (const f of l.families) lineOf.set(f, l);

  type Acc = {
    approvals: number;
    current: ReportCard[];
    all: ReportCard[];
  };
  const by = new Map<string, Acc>();
  let total = 0;
  let withCertificate = 0;
  for (const c of cards) {
    if (str(c.device_type || "Card") !== "Card") continue;
    total += 1;
    const ref = parseCertificate(c.security_certificate);
    if (!ref) continue;
    withCertificate += 1;
    const acc = by.get(ref.family) ?? { approvals: 0, current: [], all: [] };
    by.set(ref.family, acc);
    acc.approvals += 1;
    acc.all.push(c);
    if (statusById.get(c.id)?.status === "current") acc.current.push(c);
  }

  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  const families: FamilyRow[] = [...by].map(([family, acc]) => {
    const line = lineOf.get(family);
    const scope = acc.current.length > 0 ? acc.current : acc.all;
    const expiries = scope
      .map((c) => parseLooseDate(c.certificate_expiry_date))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());
    const first = expiries[0] ?? null;
    return {
      family,
      line: line?.name ?? "",
      vendor: line?.vendor ?? chipPlatformOf(acc.all[0]!).vendor ?? "",
      approvals: acc.approvals,
      current: acc.current.length,
      countries: uniq(acc.current.flatMap((c) => splitCountries(str(c.country)))),
      suppliers: uniq(
        scope.map((c) => supplierName(c.current_manufacturer_normalized || c.current_manufacturer)),
      ).filter((s) => s !== UNKNOWN),
      generations: uniq(scope.map((c) => generationOf(c.generation) ?? "")),
      expiryFrom: iso(first),
      expiryTo: iso(expiries[expiries.length - 1] ?? null),
      days: first ? Math.floor((first.getTime() - today.getTime()) / DAY) : null,
    };
  });
  families.sort(
    (a, b) =>
      b.current - a.current || b.approvals - a.approvals || a.family.localeCompare(b.family),
  );
  return { cards: total, withCertificate, families };
}
