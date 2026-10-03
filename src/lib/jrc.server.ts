// Server-only helpers: fetch + parse the JRC pages and diff them against the
// tachograph_cards table.

import {
  JRC_SOURCES,
  cellText,
  extractRows,
  fetchPage,
  generationFromAttrs,
  parseKeyManagement,
  parseManufacturerCodes,
  parseOtherCertificates,
  parsePublicKeyCertificates,
  parseSecurityUpdates,
  type OtherCertRow,
  type SourceKey,
} from "./jrc-sources.server";
import {
  countryConflict,
  documentedCountry,
  resolveFromCardName,
  approvalAuthorityLabel,
} from "./ta-country";
import { flagEmoji, normalizeCountry } from "./country-flag";
import { approvalKeys, keysMatchStrict } from "./market-status";
import { randomUUID } from "crypto";
import { emitEvent } from "./events.server";

import {
  getCardsForJrc as dbGetCardsForJrc,
  getCardsForTed as dbGetCardsForTed,
  getKnownFingerprints,
  insertProposals as dbInsertProposals,
  getSnapshots,
  upsertSnapshots,
  insertCheckRun,
  getProposal,
  getCardVerificationNotes,
  updateCardVerificationNote,
  updateCardFields,
  insertCard,
  insertFieldHistory,
  updateProposalStatus,
  replaceCurrentListing,
  getCurrentListing as dbGetCurrentListing,
  setProposalCardId,
  withOverrides,
  withTransaction,
  insertFieldHistoryTx,
  type TxQuery,
  type ProposalRow,
  type CurrentListingRow,
} from "./db.server";

export { JRC_SOURCES } from "./jrc-sources.server";
export type { SourceKey } from "./jrc-sources.server";

/** Device types the sources can report; anything else is treated as a card. */
const DEVICE_TYPES = new Set(["Card", "Vehicle Unit", "Motion Sensor"]);

export const JRC_CARD_STATUS_URL = JRC_SOURCES.card_status.url;

export type JrcRow = {
  manufacturer: string;
  cardName: string;
  certificate: string;
  date: string;
  eov: string;
  typeApproval: string;
  generation: string;
};

export function parseJrcCardStatus(html: string): JrcRow[] {
  const rows: JrcRow[] = [];
  for (const row of extractRows(html)) {
    if (row.values.length < 8) continue;

    // A row header block ("Manufacturer | Card | ...") can be glued to the
    // data row; always take the last 8 cells of the block.
    const values = row.values.slice(-8);
    const attrs = row.attrs.slice(-8);
    if (values[0].toLowerCase() === "manufacturer") continue;

    const typeApproval = values[5];
    if (!typeApproval && !values[2]) continue;

    rows.push({
      manufacturer: values[0],
      cardName: values[1],
      certificate: values[2],
      date: values[3],
      eov: values[4],
      typeApproval,
      generation: generationFromAttrs(attrs[7]),
    });
  }
  return rows;
}

export async function fetchJrcRows(): Promise<JrcRow[]> {
  return parseJrcCardStatus(await fetchPage(JRC_CARD_STATUS_URL));
}

/** Fetches + parses the "Other certificates" page once, raw (every component). */
export async function fetchOtherCertificateRows(): Promise<OtherCertRow[]> {
  return parseOtherCertificates(await fetchPage(JRC_SOURCES.other_certificates.url));
}

/**
 * "Other certificates" page, reduced to its Card rows. Pass `rows` (from
 * fetchOtherCertificateRows) when the caller already fetched the page, so the
 * same run doesn't hit JRC twice for the same data.
 */
export async function fetchOtherCertificateCardRows(rows?: OtherCertRow[]): Promise<JrcRow[]> {
  const parsed = rows ?? (await fetchOtherCertificateRows());
  return parsed
    .filter((r) => r.component.toLowerCase() === "card")
    .map((r) => ({
      manufacturer: r.manufacturer,
      cardName: r.name,
      certificate: /^n\.?\/?a\.?$/i.test(r.interopCertificate) ? "" : r.interopCertificate,
      date: r.date,
      eov: "",
      typeApproval: r.typeApproval,
      generation: r.generation,
    }));
}

/**
 * "Other certificates" page, non-card entries (VU, MS, DSRC, M1N1, Paper, ...).
 * The Annex column colour maps to the generation: Annex 1B = G1,
 * Annex 1C (dark blue) = G2.1, Annex 1C v2 (pink) = G2.2.
 */
export async function fetchOtherCertificateInfoEntries(rows?: OtherCertRow[]): Promise<{
  entries: SnapshotEntry[];
  rowsParsed: number;
}> {
  const parsed = rows ?? (await fetchOtherCertificateRows());
  const others = parsed.filter((r) => r.component.toLowerCase() !== "card");
  return {
    rowsParsed: parsed.length,
    entries: others.map((r) => ({
      key: `${r.component}|${r.manufacturer}|${r.name}|${r.typeApproval}`,
      fingerprint: [r.interopCertificate, r.date, r.mandatoryUpdates, r.generation].join("|"),
      country: "",
      generation: r.generation,
      title: `${r.component} · ${r.name || r.typeApproval} — ${r.manufacturer}${
        r.generation ? ` (${r.generation})` : ""
      }`,
      payload: {
        Component: r.component,
        Manufacturer: r.manufacturer,
        Name: r.name,
        "Interoperability certificate": r.interopCertificate,
        "Type approval certificate": r.typeApproval,
        "Date of approval": r.date,
        "Mandatory security updates": r.mandatoryUpdates,
        Annex: r.generation
          ? `${r.generation} (${
              r.generation === "G1"
                ? "Annex 1B"
                : r.generation === "G2.1"
                  ? "Annex 1C"
                  : "Annex 1C v2"
            })`
          : "",
      },
    })),
  };
}

function parseJrcDate(value: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function normApproval(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Keep the most recent JRC entry per type approval number AND generation, so
 * historic G1 approvals stay visible alongside newer G2.x rows.
 */
export function latestPerApproval(rows: JrcRow[]): JrcRow[] {
  const best = new Map<string, JrcRow>();
  for (const row of rows) {
    const key = normApproval(row.typeApproval);
    if (!key) continue;
    const mapKey = `${key}#${row.generation ?? ""}`;
    const current = best.get(mapKey);
    if (!current || parseJrcDate(row.date) > parseJrcDate(current.date)) {
      best.set(mapKey, row);
    }
  }
  return Array.from(best.values());
}

type CardRow = {
  id: string;
  country: string;
  generation: string;
  type_approval_number: string;
  current_manufacturer: string;
  tachograph_application_os: string;
  jrc_interoperability_status: string;
  jrc_certificate_source: string;
  device_type?: string | null;
};

export type FieldChange = { field: string; label: string; old: string; new: string };

const FIELD_LABELS: Record<string, string> = {
  country: "Country",
  generation: "Generation",
  current_manufacturer: "Current Manufacturer",
  tachograph_application_os: "Tachograph Application / OS",
  type_approval_number: "Type Approval Number",
  jrc_interoperability_status: "JRC Interoperability Status",
  jrc_certificate_source: "JRC / Certificate Source",
  certificate_issued_date: "Date Certificate Issued",
  certificate_expiry_date: "Certificate Validity Expiration Date",
};

function jrcStatusText(row: JrcRow): string {
  const parts = [row.certificate];
  if (row.date) parts.push(`issued ${row.date}`);
  if (row.eov) parts.push(`EOV ${row.eov}`);
  return parts.filter(Boolean).join(" · ");
}

function matchCard(row: JrcRow, cards: CardRow[]): CardRow | undefined {
  const key = normApproval(row.typeApproval);
  if (!key) return undefined;
  // A G1 row must not be swallowed by a G2.x card with the same approval no.
  const sameGeneration = (c: CardRow) =>
    !(row.generation && c.generation && row.generation !== c.generation);
  // v2.50 (code review 26): structured approval keys decide first. Mark,
  // series (EU/AETR), number AND extension must agree, so the same approval in
  // another spelling matches (JRC "e5-2002-00" vs the stored long form
  // "e5*165/2014*980/2023*2002*00") while a revision never does ("e1-209" is
  // not "e1-209-03"). The substring test used to run first and attached
  // revisions to the wrong record.
  const rowKeys = approvalKeys(row.typeApproval);
  if (rowKeys.length > 0) {
    const hits = cards.filter((c) => {
      if (!sameGeneration(c)) return false;
      const cardKeys = approvalKeys(c.type_approval_number);
      return cardKeys.some((ck) => rowKeys.some((rk) => keysMatchStrict(ck, rk)));
    });
    if (hits.length > 0) {
      // Several records can carry the same approval (one row per country,
      // duplicates). Prefer the one stored in exactly this spelling.
      return hits.find((c) => normApproval(c.type_approval_number) === key) ?? hits[0];
    }
  }
  // Substring only where one side has no parseable approval (free text such
  // as "Not identified", unusual formats) — never between two parseable ones.
  return cards.find((c) => {
    if (!sameGeneration(c)) return false;
    const haystack = normApproval(c.type_approval_number);
    if (haystack.length === 0 || !haystack.includes(key)) return false;
    return rowKeys.length === 0 || approvalKeys(c.type_approval_number).length === 0;
  });
}

export function diffRow(row: JrcRow, card: CardRow): FieldChange[] {
  const proposed: Record<string, string> = {
    generation: row.generation,
    type_approval_number: row.typeApproval,
  };

  // Only flag the certificate when the certificate ID itself is new — the
  // "issued / EOV" suffix alone is formatting noise.
  const certKey = normApproval(row.certificate);
  const currentStatus = normApproval(card.jrc_interoperability_status || "");
  if (certKey && !currentStatus.includes(certKey)) {
    proposed.jrc_interoperability_status = jrcStatusText(row);
  }

  const manuOld = (card.current_manufacturer || "").toLowerCase();
  const manuNew = row.manufacturer.toLowerCase();
  const manuToken = manuNew.split(/[\s/–-]/)[0];
  if (manuNew && manuToken.length > 2 && !manuOld.includes(manuToken)) {
    proposed.current_manufacturer = row.manufacturer;
  }

  const changes: FieldChange[] = [];
  for (const [field, value] of Object.entries(proposed)) {
    if (!value) continue;
    const old = String((card as unknown as Record<string, unknown>)[field] ?? "");
    if (old.trim() === value.trim()) continue;
    // Type approval: ignore purely cosmetic differences.
    if (field === "type_approval_number" && normApproval(old).includes(normApproval(value)))
      continue;
    changes.push({ field, label: FIELD_LABELS[field] ?? field, old, new: value });
  }
  return changes;
}

export function fingerprintFor(row: JrcRow, cardId: string | null): string {
  return [
    cardId ?? "new",
    normApproval(row.typeApproval),
    row.certificate,
    row.date,
    row.eov,
    row.generation,
    row.manufacturer,
  ].join("|");
}

export type ProposalInsert = {
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

export function buildProposals(
  rows: JrcRow[],
  cards: CardRow[],
  sinceMs = 0,
  source: SourceKey = "card_status",
): ProposalInsert[] {
  const out: ProposalInsert[] = [];
  const meta = JRC_SOURCES[source];
  for (const row of latestPerApproval(rows)) {
    const card = matchCard(row, cards);

    // Country resolution from the JRC type approval table (see ta-country.ts).
    // Computed early because a country conflict must bypass the date filter —
    // it flags stored data as wrong, independent of when the JRC row was
    // published.
    const documented = documentedCountry(row.typeApproval);
    const fromName = !documented ? resolveFromCardName(row.cardName) : null;
    const resolved = documented || fromName;
    const authorityLabel = approvalAuthorityLabel(row.typeApproval);
    const conflict = card ? countryConflict(row.typeApproval, card.country) : null;

    // Rows already represented in the dataset are only re-checked when they
    // were published after the data reference date — UNLESS there is a
    // country conflict, which must always surface as a proposal.
    if (card && sinceMs && parseJrcDate(row.date) < sinceMs && !conflict) continue;

    const changes = card ? diffRow(row, card) : [];
    // Country conflicts become an actionable field change so the user can
    // approve correcting the stored country to the documented one.
    if (conflict) {
      changes.push({
        field: "country",
        label: FIELD_LABELS["country"] ?? "Country",
        old: card?.country ?? "",
        new: conflict.country,
      });
    }
    if (card && changes.length === 0) continue;

    const country = card?.country || resolved?.country || "";
    const payload: Record<string, string> = {};
    if (resolved) {
      payload["Resolved country"] = resolved.country;
      payload["Country confidence"] = "documented";
      if (resolved.basis) payload["Country source"] = resolved.basis;
      if (resolved.evidence) payload["Country evidence"] = resolved.evidence;
      if (resolved.authority) payload["Approval authority"] = resolved.authority;
      if (resolved.pdf) payload["Type approval PDF"] = resolved.pdf;
    }
    if (authorityLabel) {
      payload["Approval issued by"] = authorityLabel;
    }
    if (conflict) {
      payload["Country cross-check"] =
        `stored "${card?.country}" differs from documented "${conflict.country}"`;
    }

    out.push({
      fingerprint: `${source}:${fingerprintFor(row, card?.id ?? null)}`,
      kind: card ? "changed" : "new",
      card_id: card?.id ?? null,
      country,
      generation: row.generation,
      jrc_manufacturer: row.manufacturer,
      jrc_card_name: row.cardName,
      jrc_certificate: row.certificate,
      jrc_date: row.date,
      jrc_eov: row.eov,
      jrc_type_approval: row.typeApproval,
      source_url: meta.url,
      source_type: source,
      source_label: meta.label,
      title: card
        ? conflict
          ? `${card.country} → ${conflict.country} · ${row.typeApproval}`
          : `${card.country} · ${row.typeApproval}`
        : `New entry · ${country ? `${country} · ` : ""}${row.typeApproval}`,
      payload,

      changes: { fields: changes },
      status: "pending",
    });
  }
  return out;
}

// --------------------------------------------------------- info-only sources
// Pages without a direct card-field mapping (country key certificates, key
// management status, mandatory VU security updates). They are diffed against a
// stored snapshot so the first run only records a baseline instead of flooding
// the inbox, and later runs surface genuinely new or changed entries.

type SnapshotEntry = {
  key: string;
  fingerprint: string;
  country: string;
  title: string;
  payload: Record<string, string>;
  generation?: string;
};

const MAX_INFO_PER_SOURCE = 40;

async function collectInfoEntries(
  source: Exclude<SourceKey, "card_status" | "other_certificates" | "ted_procurement">,
): Promise<{ entries: SnapshotEntry[]; rowsParsed: number }> {
  const html = await fetchPage(JRC_SOURCES[source].url);

  if (source === "public_key_certificates") {
    const rows = parsePublicKeyCertificates(html);
    return {
      rowsParsed: rows.length,
      entries: rows.map((r) => ({
        key: `${r.country}|${r.equipment}|${r.certificate}`,
        fingerprint: `${r.endOfValidity}|${r.sha1}`,
        country: r.country,
        title: `${r.country} · ${r.equipment} certificate ${r.certificate}`,
        payload: {
          Country: r.country,
          Equipment: r.equipment,
          Certificate: r.certificate,
          "End of validity": r.endOfValidity,
          "SHA-1": r.sha1,
        },
      })),
    };
  }

  if (source === "manufacturer_codes") {
    const rows = parseManufacturerCodes(html);
    return {
      rowsParsed: rows.length,
      entries: rows.map((r) => ({
        key: r.code,
        fingerprint: `${r.manufacturer}|${r.date}`,
        country: "",
        title: `Manufacturer code ${r.code} · ${r.manufacturer}`,
        payload: {
          Manufacturer: r.manufacturer,
          Code: r.code,
          "Assigned on": r.date,
        },
      })),
    };
  }

  if (source === "key_management") {
    const rows = parseKeyManagement(html);
    return {
      rowsParsed: rows.length,
      entries: rows.map((r) => ({
        key: r.country,
        fingerprint: [r.stateAuthority, r.policyApproved, r.tcc, r.kmwc, r.vuc, r.kmvu, r.km].join(
          "|",
        ),
        country: r.country,
        title: `${r.country} · key management status updated`,
        payload: {
          Country: r.country,
          "State authority identified": r.stateAuthority,
          "Policy approved": r.policyApproved,
          "TC.C": r.tcc,
          KmWC: r.kmwc,
          "VU.C": r.vuc,
          KmVU: r.kmvu,
          Km: r.km,
        },
      })),
    };
  }

  const rows = parseSecurityUpdates(html);
  return {
    rowsParsed: rows.length,
    entries: rows.map((r) => ({
      key: `${r.brand}|${r.model}`,
      fingerprint: [
        r.versions,
        r.typeApprovals,
        r.vulnerableVersions,
        r.updateVersions,
        r.versionsAfter,
        r.approvalsAfter,
        r.mandatoryFrom,
        r.deadline,
      ].join("|"),
      country: "",
      title: `${r.brand} · ${r.model} — mandatory security update`,
      payload: {
        Brand: r.brand,
        Model: r.model,
        "Version(s)": r.versions,
        "Type approval(s)": r.typeApprovals,
        "Vulnerable version(s)": r.vulnerableVersions,
        "Update to version(s)": r.updateVersions,
        "Version(s) after update": r.versionsAfter,
        "Type approval(s) after update": r.approvalsAfter,
        "Mandatory as from": r.mandatoryFrom,
        Deadline: r.deadline,
      },
    })),
  };
}

type SourceResult = {
  source: SourceKey;
  label: string;
  rowsParsed: number;
  candidates: number;
  created: number;
  baseline: boolean;
  error?: string;
  /** v2.52: info changes held back for the next run (MAX_INFO_PER_SOURCE). */
  deferred?: number;
  /** v2.52: new CC proposals beyond the per-run cap. */
  capped?: number;
  implausible?: boolean;
  durationMs?: number;
  checkRunId?: string | null;
};

export type RunTrigger = "manual" | "cron" | "scheduler";

export const UPDATE_SOURCE_ORDER = [
  "card_status",
  "other_certificates",
  "public_key_certificates",
  "key_management",
  "security_updates",
  "manufacturer_codes",
  "cc_certificates",
  "ted_procurement",
] as const;

// ------------------------------------------------------- current listing rows
// Maps a freshly-parsed JRC row into the jrc_current_listing shape (see
// db.server.ts / migration 0006). Stored as-is, one row per JRC entry — not
// deduplicated by latestPerApproval — so the table stays a faithful mirror of
// what the page currently shows; callers decide how to interpret duplicates.

function cardRowToListingRow(row: JrcRow): CurrentListingRow {
  return {
    source_type: "card_status",
    type_approval_number: normApproval(row.typeApproval),
    raw_type_approval: row.typeApproval,
    manufacturer: row.manufacturer,
    card_name: row.cardName,
    certificate: row.certificate,
    jrc_date: row.date,
    eov: row.eov,
    generation: row.generation,
    device_type: "Card",
  };
}

/** Card / Vehicle Unit / Motion Sensor for the app's own device types; the
 * JRC component label as-is for everything else (DSRC, M1N1, Paper, ...). */
function otherCertDeviceType(component: string): string {
  const c = component.trim().toLowerCase();
  if (c === "card") return "Card";
  if (c === "vu") return "Vehicle Unit";
  if (c === "ms") return "Motion Sensor";
  return component.trim();
}

function otherCertToListingRow(r: OtherCertRow): CurrentListingRow {
  return {
    source_type: "other_certificates",
    type_approval_number: normApproval(r.typeApproval),
    raw_type_approval: r.typeApproval,
    manufacturer: r.manufacturer,
    card_name: r.name,
    certificate: /^n\.?\/?a\.?$/i.test(r.interopCertificate) ? "" : r.interopCertificate,
    jrc_date: r.date,
    eov: "",
    generation: r.generation,
    device_type: otherCertDeviceType(r.component),
  };
}

/**
 * v2.50 (code review 13): a JRC page that parses to nothing (changed layout, a
 * maintenance page served with HTTP 200) used to replace jrc_current_listing
 * with an empty list — every approval then showed as Delisted. Such a result
 * now fails the run for that source and the previous listing stays.
 */
/** v2.52: a parse result blocked as implausible (nothing written). */
export class ImplausibleSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImplausibleSourceError";
  }
}

async function assertPlausibleListing(sourceType: string, nextCount: number): Promise<void> {
  const prevCount = (await dbGetCurrentListing()).filter(
    (r) => r.source_type === sourceType,
  ).length;
  if (nextCount === 0) {
    throw new ImplausibleSourceError(
      `${sourceType}: the page parsed to 0 rows — previous listing (${prevCount} rows) kept. Check whether the JRC page layout changed.`,
    );
  }
  if (prevCount >= 20 && nextCount < prevCount * 0.5) {
    throw new ImplausibleSourceError(
      `${sourceType}: only ${nextCount} rows parsed (before: ${prevCount}) — previous listing kept. Check the JRC page.`,
    );
  }
}

export async function runUpdateCheckForSource(
  source: SourceKey,
  opts: { runId?: string; trigger?: RunTrigger } = {},
): Promise<SourceResult> {
  const startedAt = Date.now();
  const runId = opts.runId ?? randomUUID();
  const trigger: RunTrigger = opts.trigger ?? "manual";
  let deferredInfo = 0;
  let cappedCc = 0;
  // v2.54 (code review 16): compare against the values a reader sees — base
  // row with manual edits applied — not the base row underneath them.
  const cardRows = (await withOverrides(
    (await dbGetCardsForJrc()) as (CardRow & { data_reference_date: string })[],
  )) as (CardRow & { data_reference_date: string })[];
  const sinceMs = cardRows.reduce((acc, c) => {
    const t = Date.parse(c.data_reference_date ?? "");
    return Number.isNaN(t) ? acc : Math.max(acc, t);
  }, 0);

  const known = await getKnownFingerprints();
  const insertProposals = (items: ProposalInsert[]) =>
    dbInsertProposals(items as unknown as ProposalRow[], known);

  const meta = JRC_SOURCES[source];
  let result: SourceResult;

  /** Snapshot-diff a list of info entries and turn changes into proposals. */
  const runInfoDiff = async (entries0: SnapshotEntry[]) => {
    // A page can list the same key twice (e.g. re-issued certificates);
    // upsert rejects duplicate keys inside one batch, so keep the last one.
    const entries = [...new Map(entries0.map((e) => [e.key, e])).values()];

    // PostgREST caps a select at 1000 rows — page through the snapshot,
    // otherwise unseen rows look "changed" on every run.
    const snapshot = new Map<string, string>();
    const snapRows = await getSnapshots(source);
    for (const s of snapRows) snapshot.set(s.entry_key, s.fingerprint);
    const baseline = snapshot.size === 0;
    if (entries.length === 0 && !baseline) {
      throw new ImplausibleSourceError(
        `${source}: the page parsed to 0 entries — snapshot kept. Check the page layout.`,
      );
    }

    let created = 0;
    let candidates = 0;
    // v2.50 (code review 12): only MAX_INFO_PER_SOURCE changes become proposals
    // per run. The rest must NOT be written into the snapshot, otherwise they
    // count as "seen" and are never proposed. They come up again next run.
    let deferred = new Set<string>();
    if (!baseline) {
      const changed = entries.filter((e) => snapshot.get(e.key) !== e.fingerprint);
      candidates = changed.length;
      deferred = new Set(changed.slice(MAX_INFO_PER_SOURCE).map((e) => e.key));
      const items: ProposalInsert[] = changed.slice(0, MAX_INFO_PER_SOURCE).map((e) => ({
        fingerprint: `${source}:${e.key}:${e.fingerprint}`,
        kind: "info",
        card_id: null,
        country: e.country,
        generation: e.generation ?? "",
        jrc_manufacturer: "",
        jrc_card_name: "",
        jrc_certificate: "",
        jrc_date: "",
        jrc_eov: "",
        jrc_type_approval: "",
        source_url: meta.url,
        source_type: source,
        source_label: meta.label,
        title: e.title,
        payload: e.payload,
        changes: { fields: [] },
        status: "pending",
      }));
      created = await insertProposals(items);
    }

    // Chunked: a single very large upsert is silently truncated.
    const snapRowsToWrite = entries
      .filter((e) => !deferred.has(e.key))
      .map((e) => ({
        source_type: source,
        entry_key: e.key,
        fingerprint: e.fingerprint,
        updated_at: new Date().toISOString(),
      }));
    await upsertSnapshots(snapRowsToWrite);

    return { candidates, created, baseline, deferred: deferred.size };
  };

  try {
    if (source === "card_status" || source === "other_certificates") {
      // Fetched once and reused below for both the proposal diff and the
      // jrc_current_listing mirror, so a run of this source only hits JRC once.
      const otherRawRows =
        source === "other_certificates" ? await fetchOtherCertificateRows() : undefined;
      const rows =
        source === "card_status"
          ? await fetchJrcRows()
          : await fetchOtherCertificateCardRows(otherRawRows);
      // Before anything is written: proposals from a broken parse are as wrong
      // as an emptied listing.
      await assertPlausibleListing(
        source,
        source === "card_status" ? rows.length : (otherRawRows ?? []).length,
      );
      // v2.51: the info part of other_certificates is parsed and checked here
      // too — BEFORE the first proposal is written. In v2.50 card proposals were
      // already stored when the info check failed afterwards.
      const otherInfo =
        source === "other_certificates"
          ? await fetchOtherCertificateInfoEntries(otherRawRows)
          : undefined;
      if (otherInfo && otherInfo.entries.length === 0 && (await getSnapshots(source)).length > 0) {
        throw new ImplausibleSourceError(
          `${source}: the page parsed to 0 info entries — nothing written, snapshot and listing kept. Check the page layout.`,
        );
      }
      // Card rows only ever match card records (v2.51).
      const cardRecords = cardRows.filter((c) => (c.device_type || "Card") === "Card");
      const candidates = buildProposals(rows, cardRecords, sinceMs, source);
      let created = await insertProposals(candidates);
      let extraCandidates = 0;
      let extraRows = 0;
      let baseline = false;

      if (source === "other_certificates" && otherInfo) {
        // Every non-card entry (VU, MS, DSRC, M1N1, Paper, ...) is tracked as an
        // info proposal, with the Annex generation taken from the legend colour.
        const { entries, rowsParsed } = otherInfo;
        extraRows = rowsParsed;
        const info = await runInfoDiff(entries);
        extraCandidates = info.candidates;
        created += info.created;
        baseline = info.baseline;
        deferredInfo = info.deferred;

        // Persist a full mirror of the page (every component, not just cards)
        // for Market Analytics — see jrc_current_listing (migration 0006).
        await replaceCurrentListing(
          "other_certificates",
          (otherRawRows ?? []).map(otherCertToListingRow),
        );
      } else {
        await replaceCurrentListing("card_status", rows.map(cardRowToListingRow));
      }

      result = {
        source,
        label: meta.label,
        rowsParsed: Math.max(rows.length, extraRows),
        candidates: candidates.length + extraCandidates,
        created,
        baseline,
      };
    } else if (source === "cc_certificates") {
      // Common Criteria portal: card certificates are matched against the
      // security certificate numbers already stored, motion sensor and vehicle
      // unit entries are tracked as information only.
      const { fetchCcEntries, buildCcProposals } = await import("./cc.server");
      const { getCardsForCc } = await import("./db.server");
      const entries = await fetchCcEntries();
      const ccCards = await withOverrides(await getCardsForCc());
      const candidates = buildCcProposals(entries, ccCards);
      // v2.50 (code review 25): filter known fingerprints first, then cap —
      // capping first let 80 already-known entries block every new one. Sorted
      // so the order no longer depends on the parallel portal scraping.
      const fresh = candidates
        .filter((c) => !known.has(c.fingerprint))
        .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
      const created = await insertProposals(fresh.slice(0, 80) as unknown as ProposalInsert[]);
      cappedCc = Math.max(0, fresh.length - 80);
      result = {
        source,
        label: meta.label,
        rowsParsed: entries.length,
        candidates: candidates.length,
        created,
        baseline: false,
      };
    } else if (source === "ted_procurement") {
      const { fetchTedNotices, buildTedProposals } = await import("./ted.server");
      const notices = await fetchTedNotices();
      const procCards = await withOverrides((await dbGetCardsForTed()) as { id: string }[]);
      const candidates = buildTedProposals(notices, procCards as never, sinceMs);
      const created = await insertProposals(candidates as unknown as ProposalInsert[]);
      result = {
        source,
        label: meta.label,
        rowsParsed: notices.length,
        candidates: candidates.length,
        created,
        baseline: false,
      };
    } else {
      const { entries, rowsParsed } = await collectInfoEntries(source);
      const info = await runInfoDiff(entries);
      deferredInfo = info.deferred;
      result = {
        source,
        label: meta.label,
        rowsParsed,
        candidates: info.candidates,
        created: info.created,
        baseline: info.baseline,
      };
    }
  } catch (e) {
    result = {
      source,
      label: meta.label,
      rowsParsed: 0,
      candidates: 0,
      created: 0,
      baseline: false,
      error: e instanceof Error ? e.message : String(e),
      implausible: e instanceof ImplausibleSourceError,
    };
  }
  result.deferred = deferredInfo;
  result.capped = cappedCc;
  result.durationMs = Date.now() - startedAt;

  const checkRunId = await insertCheckRun({
    source_type: result.source,
    source_url: meta.url,
    rows_parsed: result.rowsParsed,
    proposals_created: result.created,
    status: result.error ? "error" : "ok",
    message: result.error
      ? result.error
      : result.baseline
        ? `Baseline recorded from ${result.rowsParsed} row(s) — future changes will be reported`
        : `${result.rowsParsed} row(s) scanned, ${result.candidates} relevant, ${result.created} new proposal(s)`,
    run_id: runId,
    triggered_by: trigger,
    duration_ms: result.durationMs,
  }).catch(async (e: unknown) => {
    await emitEvent({
      level: "ERROR",
      category: "update",
      code: "update.checkrun.write_failed",
      status: "failed",
      trigger,
      runId,
      sourceType: result.source,
      message: `${meta.label}: run result could not be stored — ${e instanceof Error ? e.message : String(e)}`,
      dedupKey: "update.checkrun.write_failed",
    });
    return null;
  });
  result.checkRunId = checkRunId;
  await logSourceEvents(result, runId, trigger, meta.label);

  return result;
}

/** Digits/ids stripped so the same failure folds into one open log entry. */
function foldKey(message: string): string {
  return message.replace(/\d+/g, "#").slice(0, 160);
}

async function logSourceEvents(r: SourceResult, runId: string, trigger: RunTrigger, label: string) {
  const common = {
    category: "update" as const,
    trigger,
    sourceType: r.source,
    runId,
    checkRunId: r.checkRunId,
    durationMs: r.durationMs,
  };
  if (r.error) {
    const code = r.implausible ? "update.source.implausible" : "update.source.failed";
    await emitEvent({
      ...common,
      level: "ERROR",
      code,
      status: "failed",
      message: r.implausible
        ? `${label}: parse result rejected as implausible, nothing written — ${r.error}`
        : `${label}: ${r.error}`,
      details: { source: r.source, label, error: r.error },
      dedupKey: `${code}:${r.source}:${foldKey(r.error)}`,
    });
    return;
  }
  if ((r.deferred ?? 0) > 0) {
    await emitEvent({
      ...common,
      level: "WARN",
      code: "update.source.deferred",
      status: "partial",
      message: `${label}: ${r.deferred} change(s) beyond the per-run limit held back — they come up again in the next run`,
      details: {
        source: r.source,
        deferred: r.deferred,
        candidates: r.candidates,
        created: r.created,
      },
      dedupKey: `update.source.deferred:${r.source}`,
    });
  }
  if ((r.capped ?? 0) > 0) {
    await emitEvent({
      ...common,
      level: "WARN",
      code: "update.source.capped",
      status: "partial",
      message: `${label}: ${r.created} new proposal(s) stored, ${r.capped} more beyond the per-run cap follow in the next run`,
      details: { source: r.source, capped: r.capped, created: r.created },
      dedupKey: `update.source.capped:${r.source}`,
    });
  }
}

export async function runUpdateCheck(
  trigger: RunTrigger = "manual",
  opts: { runId?: string } = {},
) {
  const runId = opts.runId ?? randomUUID();
  const startedAt = Date.now();
  const results: SourceResult[] = [];
  for (const source of UPDATE_SOURCE_ORDER) {
    results.push(await runUpdateCheckForSource(source, { runId, trigger }));
  }

  const totals = results.reduce(
    (acc, r) => ({
      rowsParsed: acc.rowsParsed + r.rowsParsed,
      candidates: acc.candidates + r.candidates,
      created: acc.created + r.created,
    }),
    { rowsParsed: 0, candidates: 0, created: 0 },
  );

  const failed = results.filter((r) => r.error);
  const status =
    failed.length === 0 ? "success" : failed.length === results.length ? "failed" : "partial";
  await emitEvent({
    level: "INFO",
    category: "update",
    code: "update.run.completed",
    status,
    trigger,
    runId,
    durationMs: Date.now() - startedAt,
    message:
      `Update run (${trigger}): ${results.length - failed.length}/${results.length} source(s) ok, ` +
      `${totals.created} new proposal(s)` +
      (failed.length ? ` — failed: ${failed.map((r) => r.label).join(", ")}` : ""),
    details: {
      sources: results.map((r) => ({
        source: r.source,
        ok: !r.error,
        rows: r.rowsParsed,
        candidates: r.candidates,
        created: r.created,
        deferred: r.deferred ?? 0,
        capped: r.capped ?? 0,
        ms: r.durationMs ?? null,
      })),
    },
  });

  return { ...totals, runId, status, sources: results };
}

// ------------------------------------------------------------ approval (v2.54)
//
// Code review 10/16/17 + Restfehler B. Agreed 03.10.2026:
//  - one transaction: proposal row locked (FOR UPDATE), card + override locked,
//    card change, override change, history and status commit together;
//    a second parallel approval waits and then finds the proposal handled;
//  - 16: a field with a manual value that differs from the proposed one is a
//    conflict — the admin chooses "source" (manual value removed) or "manual"
//    (field left as it is);
//  - 17: when the visible value changed since the proposal was found, the
//    approval needs an explicit confirmation; history stores the value that
//    was really overwritten;
//  - creating a record and linking it to the proposal happen in the same
//    transaction, so a failure cannot leave an unlinked copy behind.

export type ApproveOptions = {
  /** Per field with a manual value: take the source value or keep the manual one. */
  resolutions?: Record<string, "source" | "manual">;
  /** The admin saw that the value changed since detection and approves anyway. */
  confirmStale?: boolean;
};

export type ApprovalFieldState = {
  field: string;
  label: string;
  /** Value when the proposal was found. */
  detected: string;
  /** Value a reader sees now (base + manual edit). */
  current: string;
  proposed: string;
  /** Manual value on top of the base row, or null. */
  manual: string | null;
  /** Visible value changed since detection (and is not already the proposed value). */
  stale: boolean;
  /** A manual value differs from the proposed one. */
  manualConflict: boolean;
  /** Already shows the proposed value — nothing to write. */
  alreadyApplied: boolean;
};

export type ApproveResult =
  | {
      ok: true;
      linkedExisting?: string;
      createdId?: string;
      alreadyApproved?: boolean;
      keptManual?: string[];
      applied?: string[];
    }
  | { ok: false; conflict: { message: string; fields: ApprovalFieldState[] } };

const sv = (v: unknown) => String(v ?? "").trim();

/** Live state of each proposed field change against the current record. */
export function fieldStates(
  changes: FieldChange[],
  base: Record<string, unknown>,
  overridePatch: Record<string, unknown> | null,
): ApprovalFieldState[] {
  const patch = overridePatch ?? {};
  return changes.map((c) => {
    const hasManual = Object.prototype.hasOwnProperty.call(patch, c.field);
    const manual = hasManual ? sv(patch[c.field]) : null;
    const current = manual ?? sv(base[c.field]);
    const proposed = sv(c.new);
    const alreadyApplied = current === proposed;
    return {
      field: c.field,
      label: c.label,
      detected: sv(c.old),
      current,
      proposed,
      manual,
      stale: !alreadyApplied && current !== sv(c.old),
      manualConflict: manual !== null && manual !== proposed,
      alreadyApplied,
    };
  });
}

export async function approveProposal(
  id: string,
  country: string,
  userId?: string | null,
  opts: ApproveOptions = {},
): Promise<ApproveResult> {
  if (!isLocalDbBackend()) {
    return (await approveProposalLegacy(id, country, userId)) as ApproveResult;
  }
  return await withTransaction((q) => approveInTx(q, id, country, userId ?? null, opts));
}

function isLocalDbBackend(): boolean {
  return !!process.env["DB_HOST"];
}

async function approveInTx(
  q: TxQuery,
  id: string,
  country: string,
  userId: string | null,
  opts: ApproveOptions,
): Promise<ApproveResult> {
  const [proposal] = await q<ProposalRow & { status: string }>(
    `SELECT * FROM public.jrc_update_proposals WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status === "approved") return { ok: true, alreadyApproved: true };
  if (proposal.status !== "pending") throw new Error("Proposal already handled");

  const changes = proposal.changes?.fields ?? [];
  const deviceType = DEVICE_TYPES.has(proposal.payload?.["Device type"] ?? "")
    ? (proposal.payload?.["Device type"] as string)
    : "Card";
  const createsRecord = !proposal.card_id && (proposal.kind !== "info" || deviceType !== "Card");
  const finish = async () => {
    const done = await q(
      `UPDATE public.jrc_update_proposals
          SET status = 'approved', reviewed_at = now(), reviewed_by = $2
        WHERE id = $1 AND status = 'pending'
        RETURNING id`,
      [id, uuidOrNullLocal(userId)],
    );
    if (done.length !== 1) throw new Error("Proposal already handled");
  };

  // ---- informational finding → verification note of the country's records
  if (proposal.kind === "info" && !createsRecord && !proposal.card_id) {
    const payload = proposal.payload ?? {};
    const note = [
      `[${proposal.source_label}] ${proposal.title}`,
      Object.entries(payload)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    ]
      .filter(Boolean)
      .join(" — ");
    const target = (proposal.country || country).trim();
    if (!target) {
      throw new Error(
        "This finding has no country, so there is nothing to note it on. " +
          "Enter the country it belongs to, or dismiss the proposal.",
      );
    }
    const affected = await q<{ id: string; verification_note: string | null }>(
      `SELECT id, verification_note FROM public.tachograph_cards WHERE country = $1 FOR UPDATE`,
      [target],
    );
    if (affected.length === 0) {
      throw new Error(`No records for "${target}" — the note would have nowhere to go.`);
    }
    const history = [];
    for (const card of affected) {
      const existingNote = (card.verification_note ?? "").trim();
      if (existingNote.includes(note)) continue;
      const next = existingNote ? `${existingNote}\n${note}` : note;
      await q(`UPDATE public.tachograph_cards SET verification_note = $2 WHERE id = $1`, [
        card.id,
        next,
      ]);
      history.push({
        card_id: card.id,
        field: "verification_note",
        old_value: existingNote,
        new_value: next,
        origin: "jrc_proposal",
        source_label: proposal.source_label ?? "",
        source_url: proposal.source_url ?? "",
        proposal_id: id,
        changed_by: userId,
      });
    }
    await insertFieldHistoryTx(q, history);
    await finish();
    return { ok: true };
  }

  // ---- field changes on an existing record
  if (proposal.card_id) {
    const [card] = await q(`SELECT * FROM public.tachograph_cards WHERE id = $1 FOR UPDATE`, [
      proposal.card_id,
    ]);
    if (!card) throw new Error("The record this proposal refers to no longer exists.");
    const [ov] = await q<{ patch: Record<string, string> }>(
      `SELECT patch FROM public.tachograph_card_overrides WHERE card_id = $1 FOR UPDATE`,
      [proposal.card_id],
    );
    const overridePatch: Record<string, string> = { ...(ov?.patch ?? {}) };
    const states = fieldStates(changes, card, overridePatch);
    const resolutions = opts.resolutions ?? {};
    const open = states.filter(
      (s) =>
        !s.alreadyApplied &&
        ((s.stale && !opts.confirmStale) || (s.manualConflict && !resolutions[s.field])),
    );
    if (open.length > 0) {
      const parts = [];
      if (open.some((s) => s.manualConflict && !resolutions[s.field]))
        parts.push("a manual value differs from the proposed one — choose which to keep");
      if (open.some((s) => s.stale && !opts.confirmStale))
        parts.push("the record changed since this proposal was found — confirm to apply anyway");
      return { ok: false, conflict: { message: parts.join("; "), fields: states } };
    }

    const basePatch: Record<string, string> = {};
    const dropFromOverride: string[] = [];
    const keptManual: string[] = [];
    const history = [];
    for (const st of states) {
      if (st.alreadyApplied) continue;
      if (st.manualConflict && resolutions[st.field] === "manual") {
        keptManual.push(st.field);
        continue;
      }
      let value = st.proposed;
      if (st.field === "country") value = normalizeCountry(value);
      basePatch[st.field] = value;
      if (st.manual !== null) dropFromOverride.push(st.field);
      history.push({
        card_id: proposal.card_id,
        field: st.field,
        old_value: st.current,
        new_value: value,
        origin: "jrc_proposal",
        source_label:
          (proposal.source_label ?? "") + (st.manual !== null ? " · replaced manual value" : ""),
        source_url: proposal.source_url ?? "",
        proposal_id: id,
        changed_by: userId,
      });
    }
    if (typeof basePatch["country"] === "string") {
      basePatch["country_flag"] = flagEmoji(basePatch["country"]);
      if (Object.prototype.hasOwnProperty.call(overridePatch, "country_flag"))
        dropFromOverride.push("country_flag");
    }
    const cols = Object.keys(basePatch);
    if (cols.length > 0) {
      await q(
        `UPDATE public.tachograph_cards SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`,
        [proposal.card_id, ...cols.map((c) => basePatch[c])],
      );
    }
    if (dropFromOverride.length > 0 && ov) {
      for (const f of dropFromOverride) delete overridePatch[f];
      if (Object.keys(overridePatch).length === 0) {
        await q(`DELETE FROM public.tachograph_card_overrides WHERE card_id = $1`, [
          proposal.card_id,
        ]);
      } else {
        await q(
          `UPDATE public.tachograph_card_overrides SET patch = $2, updated_at = now() WHERE card_id = $1`,
          [proposal.card_id, JSON.stringify(overridePatch)],
        );
      }
    }
    await insertFieldHistoryTx(q, history);
    await finish();
    return { ok: true, keptManual, applied: history.map((h) => h.field) };
  }

  // ---- new record (or link to the existing one)
  const name = normalizeCountry(country || proposal.country);
  if (!name && deviceType === "Card") throw new Error("Country is required for a new card entry");
  const cardsNow = await withOverrides(
    await q<CardRow & { id: string }>(
      `SELECT id, country, generation, type_approval_number, current_manufacturer,
              tachograph_application_os, jrc_interoperability_status, jrc_certificate_source,
              data_reference_date, device_type
         FROM public.tachograph_cards`,
    ),
  );
  const existing = proposal.jrc_type_approval
    ? matchCard(
        { typeApproval: proposal.jrc_type_approval, generation: proposal.generation } as JrcRow,
        cardsNow.filter(
          (c) =>
            (c.device_type || "Card") === deviceType && normalizeCountry(c.country ?? "") === name,
        ),
      )
    : undefined;
  if (existing) {
    await q(`UPDATE public.jrc_update_proposals SET card_id = $2 WHERE id = $1`, [id, existing.id]);
    await finish();
    return { ok: true, linkedExisting: existing.id };
  }
  const row: Record<string, string> = {
    country: name,
    country_flag: flagEmoji(name),
    device_type: deviceType,
    generation: proposal.generation,
    current_manufacturer: proposal.jrc_manufacturer,
    current_manufacturer_normalized: proposal.jrc_manufacturer,
    tachograph_application_os: proposal.jrc_card_name,
    type_approval_number: proposal.jrc_type_approval,
    jrc_interoperability_status: [
      proposal.jrc_certificate,
      proposal.jrc_date ? `issued ${proposal.jrc_date}` : "",
      proposal.jrc_eov ? `EOV ${proposal.jrc_eov}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    jrc_certificate_source: proposal.source_url,
  };
  const cols = Object.keys(row);
  const [inserted] = await q<{ id: string }>(
    `INSERT INTO public.tachograph_cards (${cols.map((c) => `"${c}"`).join(",")})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    cols.map((c) => row[c]),
  );
  const newId = String(inserted?.id ?? "");
  if (!newId) throw new Error("Creating the record returned no id");
  await q(`UPDATE public.jrc_update_proposals SET card_id = $2 WHERE id = $1`, [id, newId]);
  // Code review 19 (partly): a created record gets history too.
  await insertFieldHistoryTx(
    q,
    cols
      .filter((c) => c !== "country_flag" && sv(row[c]) !== "")
      .map((c) => ({
        card_id: newId,
        field: c,
        old_value: "",
        new_value: row[c]!,
        origin: "jrc_proposal",
        source_label: `${proposal.source_label ?? ""} · record created`,
        source_url: proposal.source_url ?? "",
        proposal_id: id,
        changed_by: userId,
      })),
  );
  await finish();
  return { ok: true, createdId: newId };
}

const UUID_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNullLocal(v: unknown): string | null {
  const s = sv(v);
  return UUID_LOCAL.test(s) ? s : null;
}

/** Pre-v2.54 path, kept for the hosted (Supabase) backend without transactions. */
async function approveProposalLegacy(id: string, country: string, userId?: string | null) {
  const proposal = await getProposal(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending") throw new Error("Proposal already handled");

  const changes = proposal.changes?.fields ?? [];
  const deviceType = DEVICE_TYPES.has(proposal.payload?.["Device type"] ?? "")
    ? (proposal.payload?.["Device type"] as string)
    : "Card";

  // A vehicle unit or motion sensor becomes a record of its own, even when the
  // proposal was filed as informational. Proposals created before the device
  // type existed are still marked "info", and they are never re-proposed —
  // their fingerprint is remembered — so approving one has to do the right
  // thing rather than fall into the note path, where it wrote nothing at all.
  const createsRecord = !proposal.card_id && (proposal.kind !== "info" || deviceType !== "Card");

  if (proposal.kind === "info" && !createsRecord && !proposal.card_id) {
    // Informational sources have no direct card column. Applying them records
    // the finding on the verification note of the matching country's cards.
    const payload = proposal.payload ?? {};
    const note = [
      `[${proposal.source_label}] ${proposal.title}`,
      Object.entries(payload)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    ]
      .filter(Boolean)
      .join(" — ");

    // Without a country there is nothing to attach the note to. Saying so is
    // the point: silently marking the proposal approved while writing nothing
    // is how a finding disappears without anyone noticing.
    const target = (proposal.country || country).trim();
    if (!target) {
      throw new Error(
        "This finding has no country, so there is nothing to note it on. " +
          "Enter the country it belongs to, or dismiss the proposal.",
      );
    }
    const affected = await getCardVerificationNotes(target);
    if (affected.length === 0) {
      throw new Error(`No records for "${target}" — the note would have nowhere to go.`);
    }
    for (const card of affected) {
      const existingNote = (card.verification_note ?? "").trim();
      if (existingNote.includes(note)) continue;
      await updateCardVerificationNote(card.id, existingNote ? `${existingNote}\n${note}` : note);
    }
  } else if (proposal.card_id) {
    const patch: Record<string, string> = {};
    for (const c of changes) patch[c.field] = c.new;
    // A country coming from a JRC table cell can carry stray or non-breaking
    // whitespace. Stored unnormalised it still *looks* right in the UI but
    // misses the ISO lookup, and the card keeps the flag of its previous
    // country. Normalise here, and keep country_flag in step so the stored
    // emoji can never contradict the country field.
    if (typeof patch["country"] === "string") {
      patch["country"] = normalizeCountry(patch["country"]);
      patch["country_flag"] = flagEmoji(patch["country"]);
    }
    if (Object.keys(patch).length > 0) {
      // The old values come from the proposal itself: buildProposals recorded
      // what the card held when the difference was detected.
      const oldByField = new Map(changes.map((c) => [c.field, c.old ?? ""]));
      await updateCardFields(proposal.card_id, patch);
      await insertFieldHistory(
        Object.entries(patch).map(([field, value]) => ({
          card_id: proposal.card_id as string,
          field,
          old_value: String(oldByField.get(field) ?? ""),
          new_value: value,
          origin: "jrc_proposal",
          source_label: proposal.source_label ?? "",
          source_url: proposal.source_url ?? "",
          proposal_id: id,
        })),
      );
    }
  } else {
    const name = normalizeCountry(country || proposal.country);
    // A card belongs to a country — that is what the record is about. A vehicle
    // unit or motion sensor is a product of a vendor; the certification scheme
    // is not the country it is used in (the same trap as reading the country
    // off an eNN prefix), so an empty country is the honest answer there.
    if (!name && deviceType === "Card") {
      throw new Error("Country is required for a new card entry");
    }
    // v2.50 (code review 11): a record with this approval for this country may
    // already exist (an earlier approval of this very proposal, or a manual
    // entry). Link to it instead of inserting a second copy.
    const cardsNow = (await dbGetCardsForJrc()) as CardRow[];
    const existing = proposal.jrc_type_approval
      ? matchCard(
          { typeApproval: proposal.jrc_type_approval, generation: proposal.generation } as JrcRow,
          // Same device type AND same country (v2.51): a new vehicle unit must
          // never be linked to a card that happens to share the number.
          cardsNow.filter(
            (c) =>
              (c.device_type || "Card") === deviceType &&
              normalizeCountry(c.country ?? "") === name,
          ),
        )
      : undefined;
    if (existing) {
      await setProposalCardId(id, existing.id);
      await updateProposalStatus(id, "approved", userId);
      return { ok: true, linkedExisting: existing.id };
    }
    const newId = await insertCard({
      country: name,
      country_flag: flagEmoji(name),
      // Cards, vehicle units and motion sensors share the table; the source
      // reports which one this is. Anything else stays a card.
      device_type: deviceType,
      generation: proposal.generation,
      current_manufacturer: proposal.jrc_manufacturer,
      current_manufacturer_normalized: proposal.jrc_manufacturer,
      tachograph_application_os: proposal.jrc_card_name,
      type_approval_number: proposal.jrc_type_approval,
      jrc_interoperability_status: [
        proposal.jrc_certificate,
        proposal.jrc_date ? `issued ${proposal.jrc_date}` : "",
        proposal.jrc_eov ? `EOV ${proposal.jrc_eov}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      jrc_certificate_source: proposal.source_url,
    });
    if (newId) await setProposalCardId(id, newId);
  }

  await updateProposalStatus(id, "approved", userId);
  return { ok: true };
}

export async function rejectProposal(id: string, userId?: string | null) {
  await updateProposalStatus(id, "rejected", userId);
  return { ok: true };
}

/**
 * Puts a handled proposal back on the pending list.
 *
 * Dismissing was a one-way door: a proposal waved away in a hurry, or approved
 * against the wrong card, could only be looked at afterwards, never acted on
 * again. Re-running the check does not bring it back either — the fingerprint
 * is remembered precisely so that findings are not proposed twice.
 *
 * Reopening an approved proposal does not undo what it wrote; it only offers
 * the decision again. The change history records what the earlier approval did.
 */
export async function reopenProposal(id: string) {
  const proposal = await getProposal(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status === "pending") return { ok: true, alreadyPending: true };
  await updateProposalStatus(id, "pending");
  return { ok: true, alreadyPending: false };
}
