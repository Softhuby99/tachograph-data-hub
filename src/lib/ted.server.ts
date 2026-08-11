// Server-only helpers: query TED (Tenders Electronic Daily) for tachograph
// card procurement notices and turn them into update proposals for the
// procurement fields of tachograph_cards.

export const TED_SEARCH_API = "https://api.ted.europa.eu/v3/notices/search";
export const TED_SOURCE_URL = "https://ted.europa.eu/en/search/result";

/** ISO3 country code -> country name as stored in tachograph_cards. */
const ISO3_TO_COUNTRY: Record<string, string> = {
  ALB: "Albania",
  ARM: "Armenia",
  AUT: "Austria",
  AZE: "Azerbaijan",
  BLR: "Belarus",
  BEL: "Belgium",
  BIH: "Bosnia and Herzegovina",
  BGR: "Bulgaria",
  HRV: "Croatia",
  CYP: "Cyprus",
  CZE: "Czechia",
  DNK: "Denmark",
  EST: "Estonia",
  FIN: "Finland",
  FRA: "France",
  GEO: "Georgia",
  DEU: "Germany",
  GRC: "Greece",
  HUN: "Hungary",
  ISL: "Iceland",
  IRL: "Ireland",
  ISR: "Israel",
  ITA: "Italy",
  KAZ: "Kazakhstan",
  KGZ: "Kyrgyzstan",
  LVA: "Latvia",
  LIE: "Liechtenstein",
  LTU: "Lithuania",
  LUX: "Luxembourg",
  MLT: "Malta",
  MDA: "Moldova",
  MCO: "Monaco",
  MNE: "Montenegro",
  NLD: "Netherlands",
  MKD: "North Macedonia",
  NOR: "Norway",
  POL: "Poland",
  PRT: "Portugal",
  ROU: "Romania",
  RUS: "Russia",
  SMR: "San Marino",
  SRB: "Serbia",
  SVK: "Slovakia",
  SVN: "Slovenia",
  ESP: "Spain",
  SWE: "Sweden",
  CHE: "Switzerland",
  TJK: "Tajikistan",
  TKM: "Turkmenistan",
  TUR: "Türkiye",
  UKR: "Ukraine",
  GBR: "United Kingdom",
  UZB: "Uzbekistan",
};

export type TedNotice = {
  publicationNumber: string;
  title: string;
  buyer: string;
  country: string;
  date: string; // YYYY-MM-DD
  noticeType: string;
  url: string;
};

type RawNotice = Record<string, unknown>;

function pickText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(pickText).filter(Boolean)[0] ?? "";
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return pickText(rec["eng"] ?? Object.values(rec)[0]);
  }
  return "";
}

/** "Ireland – Driving-test services – ET2604 - ..." -> drop the boilerplate prefixes. */
function shortTitle(title: string): string {
  const parts = title.split("–").map((p) => p.trim());
  return (parts.length > 2 ? parts.slice(2).join(" – ") : title).trim();
}

const NOTICE_TYPE_LABEL: Record<string, string> = {
  "cn-standard": "Contract notice",
  "cn-social": "Contract notice",
  "cn-desg": "Design contest notice",
  "pin-only": "Prior information notice",
  "pin-buyer": "Prior information notice",
  "pin-tender": "Prior information notice",
  "can-standard": "Contract award notice",
  "can-social": "Contract award notice",
  "can-modif": "Contract modification notice",
  "veat": "Voluntary ex-ante transparency notice",
};

function noticeTypeLabel(value: string): string {
  return NOTICE_TYPE_LABEL[value] ?? (value ? value.replace(/-/g, " ") : "Notice");
}

export function isAward(noticeType: string): boolean {
  return noticeType.startsWith("can");
}

export function normalizeNotice(raw: RawNotice): TedNotice | null {
  const publicationNumber = pickText(raw["publication-number"]);
  if (!publicationNumber) return null;
  const iso = pickText(raw["buyer-country"] ?? raw["organisation-country-buyer"]).toUpperCase();
  const country = ISO3_TO_COUNTRY[iso] ?? "";
  const date = pickText(raw["publication-date"]).slice(0, 10);
  return {
    publicationNumber,
    title: shortTitle(pickText(raw["notice-title"])),
    buyer: pickText(raw["buyer-name"]),
    country,
    date,
    noticeType: pickText(raw["notice-type"]),
    url: `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}`,
  };
}

const QUERIES = [
  'FT~"tachograph card"',
  'FT~"tachograph cards"',
  'FT~"driver card" AND FT~"tachograph"',
  'FT~"Fahrerkarte" AND FT~"Tachograph"',
  'FT~"carte de conducteur" AND FT~"tachygraphe"',
];

/**
 * Full-text hits also return notices that merely mention a driver card
 * somewhere (staffing, bus fleets, ...). Keep only notices whose title or
 * buyer points at card issuing / tachograph procurement.
 */
const RELEVANT = /tachograph|tachygraph|tachograf|fahrerkarte|driver card|driving licence|driver licence|driving license|conducteur|kartenherstell|kartenpersonalis|smart ?card|chip ?card|kaart|karte/i;

export function isRelevant(notice: TedNotice): boolean {
  return RELEVANT.test(`${notice.title} ${notice.buyer}`);
}


async function searchTed(query: string, limit = 50): Promise<RawNotice[]> {
  const res = await fetch(TED_SEARCH_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `${query} SORT BY publication-date DESC`,
      limit,
      page: 1,
      fields: [
        "publication-number",
        "notice-title",
        "publication-date",
        "buyer-name",
        "buyer-country",
        "organisation-country-buyer",
        "notice-type",
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`TED search failed [${res.status}]: ${await res.text()}`);
  }
  const json = (await res.json()) as { notices?: RawNotice[] };
  return json.notices ?? [];
}

/** All tachograph-card related notices, de-duplicated by publication number. */
export async function fetchTedNotices(): Promise<TedNotice[]> {
  const seen = new Map<string, TedNotice>();
  for (const query of QUERIES) {
    let raws: RawNotice[] = [];
    try {
      raws = await searchTed(query);
    } catch {
      continue; // a single failing phrase must not kill the whole check
    }
    for (const raw of raws) {
      const notice = normalizeNotice(raw);
      if (notice && isRelevant(notice) && !seen.has(notice.publicationNumber)) {
        seen.set(notice.publicationNumber, notice);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export type TedCardRow = {
  id: string;
  country: string;
  generation: string;
  latest_tender: string;
  winner_contractor: string;
  procurement_status: string;
  tender_source: string;
};

export type FieldChange = { field: string; label: string; old: string; new: string };

const LABELS: Record<string, string> = {
  latest_tender: "Latest Tender",
  procurement_status: "Procurement Status / Assessment",
  tender_source: "Tender Source",
};

export function tenderText(notice: TedNotice): string {
  return [
    notice.date,
    noticeTypeLabel(notice.noticeType),
    notice.title || notice.buyer,
    `TED ${notice.publicationNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function diffNotice(notice: TedNotice, card: TedCardRow): FieldChange[] {
  const changes: FieldChange[] = [];
  const tender = tenderText(notice);
  const currentTender = card.latest_tender ?? "";
  if (!currentTender.includes(notice.publicationNumber)) {
    changes.push({
      field: "latest_tender",
      label: LABELS.latest_tender,
      old: currentTender,
      new: tender,
    });
  }
  const currentSource = card.tender_source ?? "";
  if (!currentSource.includes(notice.publicationNumber)) {
    changes.push({
      field: "tender_source",
      label: LABELS.tender_source,
      old: currentSource,
      new: currentSource ? `${currentSource} | ${notice.url}` : notice.url,
    });
  }
  if (isAward(notice.noticeType)) {
    const status = `Awarded — see TED ${notice.publicationNumber} (${notice.date})`;
    const currentStatus = card.procurement_status ?? "";
    if (!currentStatus.includes(notice.publicationNumber)) {
      changes.push({
        field: "procurement_status",
        label: LABELS.procurement_status,
        old: currentStatus,
        new: status,
      });
    }
  }
  return changes;
}

export type TedProposal = {
  fingerprint: string;
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
  source_type: string;
  source_label: string;
  title: string;
  payload: Record<string, string>;
  changes: { fields: FieldChange[] };
  status: string;
};

/**
 * One proposal per notice, targeting the newest generation card of the buyer
 * country (procurement data is tracked per country, not per generation).
 */
export function buildTedProposals(
  notices: TedNotice[],
  cards: TedCardRow[],
  sinceMs = 0,
): TedProposal[] {
  const out: TedProposal[] = [];
  const genRank = (g: string) => (g.includes("2.2") ? 3 : g.includes("2.1") ? 2 : 1);

  for (const notice of notices) {
    if (!notice.country) continue;
    const noticeMs = Date.parse(notice.date);
    if (sinceMs && Number.isFinite(noticeMs) && noticeMs < sinceMs) continue;

    const candidates = cards
      .filter((c) => c.country === notice.country)
      .sort((a, b) => genRank(b.generation) - genRank(a.generation));
    const card = candidates[0];
    const changes = card ? diffNotice(notice, card) : [];
    if (card && changes.length === 0) continue;

    out.push({
      fingerprint: `ted_procurement:${notice.publicationNumber}:${card?.id ?? "new"}`,
      kind: card ? "changed" : "info",
      card_id: card?.id ?? null,
      country: notice.country,
      generation: card?.generation ?? "",
      jrc_manufacturer: "",
      jrc_card_name: "",
      jrc_certificate: "",
      jrc_date: notice.date,
      jrc_eov: "",
      jrc_type_approval: "",
      source_url: notice.url,
      source_type: "ted_procurement",
      source_label: "TED procurement",
      title: `${notice.country} · ${noticeTypeLabel(notice.noticeType)} ${notice.publicationNumber}`,
      payload: {
        Country: notice.country,
        Buyer: notice.buyer,
        "Notice type": noticeTypeLabel(notice.noticeType),
        "Publication number": notice.publicationNumber,
        "Publication date": notice.date,
        Title: notice.title,
        Link: notice.url,
      },
      changes: { fields: changes },
      status: "pending",
    });
  }
  return out;
}
