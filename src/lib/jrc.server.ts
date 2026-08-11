// Server-only helpers: fetch + parse the JRC "Card status" page and diff it
// against the tachograph_cards table.

export const JRC_CARD_STATUS_URL =
  "https://dtc.jrc.ec.europa.eu/dtc_card_status.php.html";

const ANNEX_COLOR_TO_GENERATION: Record<string, string> = {
  "6f9ccc": "G1", // Annex 1B
  "2323dc": "G2.1", // Annex 1C
  "ff9aff": "G2.2", // Annex 1C v2
};

export type JrcRow = {
  manufacturer: string;
  cardName: string;
  certificate: string;
  date: string;
  eov: string;
  typeApproval: string;
  generation: string;
};

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    uuml: "ü",
    ouml: "ö",
    auml: "ä",
    Uuml: "Ü",
    Ouml: "Ö",
    Auml: "Ä",
    szlig: "ß",
    eacute: "é",
    egrave: "è",
    agrave: "à",
    ccedil: "ç",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    aacute: "á",
    ntilde: "ñ",
  };
  return input
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => named[name] ?? m);
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseJrcCardStatus(html: string): JrcRow[] {
  const rows: JrcRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)(?=<tr[^>]*>|<\/table>)/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const rowHtml = m[1];
    const cells = Array.from(
      rowHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi),
    ).map((c) => ({ attrs: c[1] ?? "", html: c[2] ?? "" }));
    if (cells.length < 8) continue;

    // A row header block ("Manufacturer | Card | ...") can be glued to the
    // data row; always take the last 8 cells of the block.
    const data = cells.slice(-8);
    const values = data.map((c) => cellText(c.html));
    if (values[0].toLowerCase() === "manufacturer") continue;

    const colorMatch = /bgcolor="#([0-9a-fA-F]{6})"/i.exec(data[7].attrs);
    const generation = colorMatch
      ? (ANNEX_COLOR_TO_GENERATION[colorMatch[1].toLowerCase()] ?? "")
      : "";

    const typeApproval = values[5];
    if (!typeApproval && !values[2]) continue;

    rows.push({
      manufacturer: values[0],
      cardName: values[1],
      certificate: values[2],
      date: values[3],
      eov: values[4],
      typeApproval,
      generation,
    });
  }
  return rows;
}

export async function fetchJrcRows(): Promise<JrcRow[]> {
  const res = await fetch(JRC_CARD_STATUS_URL, {
    headers: { "user-agent": "TachographCardsInfoTool/1.0" },
  });
  if (!res.ok) {
    throw new Error(`JRC request failed [${res.status}]: ${res.statusText}`);
  }
  return parseJrcCardStatus(await res.text());
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
  changes: { fields: FieldChange[] };
  status: string;
};

export function buildProposals(
  rows: JrcRow[],
  cards: CardRow[],
): ProposalInsert[] {
  const out: ProposalInsert[] = [];
  for (const row of latestPerApproval(rows)) {
    const card = matchCard(row, cards);
    const changes = card ? diffRow(row, card) : [];
    if (card && changes.length === 0) continue;
    out.push({
      fingerprint: fingerprintFor(row, card?.id ?? null),
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
      source_url: JRC_CARD_STATUS_URL,
      changes: { fields: changes },
      status: "pending",
    });
  }
  return out;
}

export async function runJrcCheck() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const rows = await fetchJrcRows();
  const { data: cards, error } = await supabaseAdmin
    .from("tachograph_cards")
    .select(
      "id,country,generation,type_approval_number,current_manufacturer,tachograph_application_os,jrc_interoperability_status,jrc_certificate_source",
    );
  if (error) throw new Error(error.message);

  const candidates = buildProposals(rows, (cards ?? []) as CardRow[]);

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
    message: `${candidates.length} candidate(s), ${fresh.length} new`,
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
