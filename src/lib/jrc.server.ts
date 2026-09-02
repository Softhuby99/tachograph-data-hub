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
  type SourceKey,
} from "./jrc-sources.server";
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
  updateProposalStatus,
  type ProposalRow,
} from "./db.server";

export { JRC_SOURCES } from "./jrc-sources.server";
export type { SourceKey } from "./jrc-sources.server";

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

/** "Other certificates" page, reduced to its Card rows. */
export async function fetchOtherCertificateCardRows(): Promise<JrcRow[]> {
  const rows = parseOtherCertificates(await fetchPage(JRC_SOURCES.other_certificates.url));
  return rows
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
export async function fetchOtherCertificateInfoEntries(): Promise<{
  entries: SnapshotEntry[];
  rowsParsed: number;
}> {
  const rows = parseOtherCertificates(await fetchPage(JRC_SOURCES.other_certificates.url));
  const others = rows.filter((r) => r.component.toLowerCase() !== "card");
  return {
    rowsParsed: rows.length,
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
              r.generation === "G1" ? "Annex 1B" : r.generation === "G2.1" ? "Annex 1C" : "Annex 1C v2"
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
};

export type FieldChange = { field: string; label: string; old: string; new: string };

const FIELD_LABELS: Record<string, string> = {
  generation: "Generation",
  current_manufacturer: "Current Manufacturer",
  tachograph_application_os: "Tachograph Application / OS",
  type_approval_number: "Type Approval Number",
  jrc_interoperability_status: "JRC Interoperability Status",
  jrc_certificate_source: "JRC / Certificate Source",
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
  return cards.find((c) => {
    const haystack = normApproval(c.type_approval_number);
    if (haystack.length === 0 || !haystack.includes(key)) return false;
    // A G1 row must not be swallowed by a G2.x card with the same approval no.
    if (row.generation && c.generation && row.generation !== c.generation) return false;
    return true;
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
    // Rows already represented in the dataset are only re-checked when they
    // were published after the data reference date. Entries with no matching
    // card (typically older G1 approvals missing from the dataset) are always
    // proposed, regardless of their publication date.
    if (card && sinceMs && parseJrcDate(row.date) < sinceMs) continue;
    const changes = card ? diffRow(row, card) : [];
    if (card && changes.length === 0) continue;

    out.push({
      fingerprint: `${source}:${fingerprintFor(row, card?.id ?? null)}`,
      kind: card ? "changed" : "new",
      card_id: card?.id ?? null,
      country: card?.country ?? "",
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
      title: card ? `${card.country} · ${row.typeApproval}` : `New entry · ${row.typeApproval}`,
      payload: {},
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
};

export const UPDATE_SOURCE_ORDER = [
  "card_status",
  "other_certificates",
  "public_key_certificates",
  "key_management",
  "security_updates",
  "manufacturer_codes",
  "ted_procurement",
] as const;

export async function runUpdateCheckForSource(source: SourceKey): Promise<SourceResult> {
  const cardRows = (await dbGetCardsForJrc()) as (CardRow & { data_reference_date: string })[];
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

    let created = 0;
    let candidates = 0;
    if (!baseline) {
      const changed = entries.filter((e) => snapshot.get(e.key) !== e.fingerprint);
      candidates = changed.length;
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
    const snapRowsToWrite = entries.map((e) => ({
      source_type: source,
      entry_key: e.key,
      fingerprint: e.fingerprint,
      updated_at: new Date().toISOString(),
    }));
    await upsertSnapshots(snapRowsToWrite);

    return { candidates, created, baseline };
  };

  try {
    if (source === "card_status" || source === "other_certificates") {
      const rows =
        source === "card_status" ? await fetchJrcRows() : await fetchOtherCertificateCardRows();
      const candidates = buildProposals(rows, cardRows, sinceMs, source);
      let created = await insertProposals(candidates);
      let extraCandidates = 0;
      let extraRows = 0;
      let baseline = false;

      if (source === "other_certificates") {
        // Every non-card entry (VU, MS, DSRC, M1N1, Paper, ...) is tracked as an
        // info proposal, with the Annex generation taken from the legend colour.
        const { entries, rowsParsed } = await fetchOtherCertificateInfoEntries();
        extraRows = rowsParsed;
        const info = await runInfoDiff(entries);
        extraCandidates = info.candidates;
        created += info.created;
        baseline = info.baseline;
      }

      result = {
        source,
        label: meta.label,
        rowsParsed: Math.max(rows.length, extraRows),
        candidates: candidates.length + extraCandidates,
        created,
        baseline,
      };
    } else if (source === "ted_procurement") {
      const { fetchTedNotices, buildTedProposals } = await import("./ted.server");
      const notices = await fetchTedNotices();
      const { data: procCards, error: procErr } = await supabaseAdmin
        .from("tachograph_cards")
        .select(
          "id,country,generation,latest_tender,winner_contractor,procurement_status,tender_source",
        );
      if (procErr) throw new Error(procErr.message);
      const candidates = buildTedProposals(notices, (procCards ?? []) as never, sinceMs);
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
    };
  }

  await supabaseAdmin.from("jrc_check_runs").insert([
    {
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
    },
  ] as never);

  return result;
}

export async function runUpdateCheck() {
  const results: SourceResult[] = [];
  for (const source of UPDATE_SOURCE_ORDER) {
    results.push(await runUpdateCheckForSource(source));
  }

  const totals = results.reduce(
    (acc, r) => ({
      rowsParsed: acc.rowsParsed + r.rowsParsed,
      candidates: acc.candidates + r.candidates,
      created: acc.created + r.created,
    }),
    { rowsParsed: 0, candidates: 0, created: 0 },
  );

  return { ...totals, sources: results };
}

export async function approveProposal(id: string, country: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: proposal, error } = await supabaseAdmin
    .from("jrc_update_proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending") throw new Error("Proposal already handled");

  const changes = (proposal.changes as { fields?: FieldChange[] } | null)?.fields ?? [];

  if (proposal.kind === "info") {
    // Informational sources have no direct card column. Applying them records
    // the finding on the verification note of the matching country's cards.
    const payload = (proposal.payload ?? {}) as Record<string, string>;
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
    if (target) {
      const { data: affected, error: selErr } = await supabaseAdmin
        .from("tachograph_cards")
        .select("id,verification_note")
        .eq("country", target);
      if (selErr) throw new Error(selErr.message);
      for (const card of affected ?? []) {
        const existingNote = (card.verification_note ?? "").trim();
        if (existingNote.includes(note)) continue;
        const { error: upErr } = await supabaseAdmin
          .from("tachograph_cards")
          .update({
            verification_note: existingNote ? `${existingNote}\n${note}` : note,
          } as never)
          .eq("id", card.id);
        if (upErr) throw new Error(upErr.message);
      }
    }
  } else if (proposal.card_id) {
    const patch: Record<string, string> = {};
    for (const c of changes) patch[c.field] = c.new;
    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from("tachograph_cards")
        .update(patch as Record<string, never>)
        .eq("id", proposal.card_id);
      if (upErr) throw new Error(upErr.message);
    }
  } else {
    const name = country.trim();
    if (!name) throw new Error("Country is required for a new entry");
    const { error: insErr } = await supabaseAdmin.from("tachograph_cards").insert({
      country: name,
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
    if (insErr) throw new Error(insErr.message);
  }

  const { error: stErr } = await supabaseAdmin
    .from("jrc_update_proposals")
    .update({ status: "approved" })
    .eq("id", id);
  if (stErr) throw new Error(stErr.message);
  return { ok: true };
}

export async function rejectProposal(id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("jrc_update_proposals")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
