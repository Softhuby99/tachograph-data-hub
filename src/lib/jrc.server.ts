// Server-only helpers: fetch + parse the JRC pages and diff them against the
// tachograph_cards table.

import {
  JRC_SOURCES,
  cellText,
  extractRows,
  fetchPage,
  generationFromAttrs,
  parseKeyManagement,
  parseOtherCertificates,
  parsePublicKeyCertificates,
  parseSecurityUpdates,
  type SourceKey,
} from "./jrc-sources.server";

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


function parseJrcDate(value: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function normApproval(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Keep only the most recent JRC entry per type approval number. */
export function latestPerApproval(rows: JrcRow[]): JrcRow[] {
  const best = new Map<string, JrcRow>();
  for (const row of rows) {
    const key = normApproval(row.typeApproval);
    if (!key) continue;
    const current = best.get(key);
    if (!current || parseJrcDate(row.date) > parseJrcDate(current.date)) {
      best.set(key, row);
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
    return haystack.length > 0 && haystack.includes(key);
  });
}

export function diffRow(
  row: JrcRow,
  card: CardRow,
): FieldChange[] {
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
    // Only consider JRC entries published after the data reference date —
    // older rows are already reflected in the dataset.
    if (sinceMs && parseJrcDate(row.date) < sinceMs) continue;
    const card = matchCard(row, cards);
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
      title: card
        ? `${card.country} · ${row.typeApproval}`
        : `New entry · ${row.typeApproval}`,
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
};

const MAX_INFO_PER_SOURCE = 40;

async function collectInfoEntries(
  source: Exclude<SourceKey, "card_status" | "other_certificates">,
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

  if (source === "key_management") {
    const rows = parseKeyManagement(html);
    return {
      rowsParsed: rows.length,
      entries: rows.map((r) => ({
        key: r.country,
        fingerprint: [r.stateAuthority, r.policyApproved, r.tcc, r.kmwc, r.vuc, r.kmvu, r.km].join("|"),
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
      fingerprint: [r.versions, r.typeApprovals, r.vulnerableVersions, r.updateVersions, r.versionsAfter, r.approvalsAfter, r.mandatoryFrom, r.deadline].join("|"),
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


export async function runJrcCheck() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const rows = await fetchJrcRows();
  const { data: cards, error } = await supabaseAdmin
    .from("tachograph_cards")
    .select(
      "id,country,generation,type_approval_number,current_manufacturer,tachograph_application_os,jrc_interoperability_status,jrc_certificate_source,data_reference_date",
    );
  if (error) throw new Error(error.message);

  const cardRows = (cards ?? []) as (CardRow & { data_reference_date: string })[];
  const sinceMs = cardRows.reduce((acc, c) => {
    const t = Date.parse(c.data_reference_date ?? "");
    return Number.isNaN(t) ? acc : Math.max(acc, t);
  }, 0);

  const candidates = buildProposals(rows, cardRows, sinceMs);

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("jrc_update_proposals")
    .select("fingerprint");
  if (exErr) throw new Error(exErr.message);
  const known = new Set((existing ?? []).map((e) => e.fingerprint as string));

  const fresh = candidates.filter((c) => !known.has(c.fingerprint));
  if (fresh.length > 0) {
    const { error: insErr } = await supabaseAdmin
      .from("jrc_update_proposals")
      .insert(fresh);
    if (insErr) throw new Error(insErr.message);
  }

  await supabaseAdmin.from("jrc_check_runs").insert({
    source_url: JRC_CARD_STATUS_URL,
    rows_parsed: rows.length,
    proposals_created: fresh.length,
    status: "ok",
    message: `${rows.length} JRC rows scanned, ${candidates.length} newer than the dataset, ${fresh.length} new proposal(s)`,
  });

  return {
    rowsParsed: rows.length,
    candidates: candidates.length,
    created: fresh.length,
  };
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

  if (proposal.card_id) {
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
