// Dual-backend data access. Branches on DB_HOST:
//  - DB_HOST set  -> local PostgreSQL via `pg` (the self-contained Docker image)
//  - DB_HOST unset -> remote Supabase (Lovable preview/published), via supabaseAdmin
//
// Every call site that previously used supabaseAdmin / context.supabase / the
// browser supabase client goes through here so the same code runs on both
// runtimes. Auth is handled separately (see auth.server.ts); this module only
// owns data, and on Supabase it uses the service-role client (RLS bypassed)
// because the app is an internal tool and the local PostgreSQL has no RLS.

import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

let _pool: Pool | undefined;

function poolConfig() {
  // No default password. An empty one still connects wherever PostgreSQL trusts
  // local connections, so the instance would come up half-configured instead of
  // saying what is missing. Fail loudly here.
  const password = process.env["DB_PASSWORD"] ?? "";
  if (password.length === 0) {
    throw new Error(
      "DB_PASSWORD is not set. The local PostgreSQL backend requires it explicitly " +
        "(e.g. in /opt/TDH/.env) — there is no built-in default.",
    );
  }
  return {
    host: process.env["DB_HOST"] || "localhost",
    port: Number(process.env["DB_PORT"] || "5432"),
    database: process.env["DB_NAME"] || "tdh",
    user: process.env["DB_USER"] || "tdh",
    password,
    max: 8,
    idleTimeoutMillis: 30000,
  };
}

function pool(): Pool {
  if (!_pool) {
    // Lazy import so the `pg` dependency is only loaded on the local runtime.
    // On Cloudflare Workers (preview) this branch is never reached.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool: PgPool } = require("pg") as typeof import("pg");
    _pool = new PgPool(poolConfig());
  }
  return _pool!;
}

export function isLocalDb(): boolean {
  return !!process.env["DB_HOST"];
}

// --------------------------------------------------------------------- types

export type CardRow = {
  id: string;
  country: string;
  generation: string;
  type_approval_number: string;
  current_manufacturer: string;
  tachograph_application_os: string;
  jrc_interoperability_status: string;
  jrc_certificate_source: string;
  data_reference_date: string;
};

export type OverrideRow = { card_id: string; patch: Record<string, string> };

export type ProposalRow = {
  id: string;
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
  changes: { fields: { field: string; label: string; old: string; new: string }[] };
  status: string;
  created_at: string;
};

export type CheckRunRow = {
  id: string;
  created_at: string;
  source_type: string;
  source_url: string;
  rows_parsed: number;
  proposals_created: number;
  status: string;
  message: string;
};

type SupabaseAdmin = SupabaseClient<Database>;

async function supabaseAdmin(): Promise<SupabaseAdmin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseAdmin;
}

// ------------------------------------------------------------------ raw cards

const CARD_COLUMNS =
  "id,country,country_flag,generation,application,current_manufacturer,current_manufacturer_normalized,chip_platform_vendor,security_certificate,chip_certificate,certificate_issued_date,certificate_expiry_date,type_approval_number,certified_security_platform,certificate_holder,date_status,issued_by_authority,jrc_interoperability_status,functional_certificate_lab,security_certificate_lab,tachograph_application_os,distinction_from_manufacturer,jrc_certificate_source,primary_source,latest_tender,winner_contractor,procurement_status,procurement_scope,tender_source,verification_note,data_reference_date,created_at,updated_at";

export async function getAllCards(): Promise<Record<string, unknown>[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      `SELECT ${CARD_COLUMNS} FROM public.tachograph_cards ORDER BY country`,
    );
    // node-postgres decodes DATE/TIMESTAMP columns as Date objects, while the
    // hosted backend returns strings. Keep one browser-facing shape: React
    // cannot render a Date object directly (the footer displays the reference
    // date), and that otherwise trips the root error boundary after all three
    // server requests have succeeded.
    return rows.map((row) => ({
      ...row,
      data_reference_date:
        row.data_reference_date instanceof Date
          ? row.data_reference_date.toISOString().slice(0, 10)
          : row.data_reference_date,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    }));
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin.from("tachograph_cards").select("*").order("country");
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function getCardsForJrc(): Promise<CardRow[]> {
  const cols =
    "id,country,generation,type_approval_number,current_manufacturer,tachograph_application_os,jrc_interoperability_status,jrc_certificate_source,data_reference_date";
  if (isLocalDb()) {
    const { rows } = await pool().query(`SELECT ${cols} FROM public.tachograph_cards`);
    return rows as unknown as CardRow[];
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin.from("tachograph_cards").select(cols);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CardRow[];
}

export async function getCardsForCc(): Promise<
  {
    id: string;
    country: string;
    generation: string;
    security_certificate: string;
    certificate_issued_date: string;
    certificate_expiry_date: string;
    current_manufacturer: string;
  }[]
> {
  const cols =
    "id,country,generation,security_certificate,certificate_issued_date,certificate_expiry_date,current_manufacturer";
  if (isLocalDb()) {
    const { rows } = await pool().query(`SELECT ${cols} FROM public.tachograph_cards`);
    return rows as never;
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin.from("tachograph_cards").select(cols);
  if (error) throw new Error(error.message);
  return (data ?? []) as never;
}

export async function getCardsForTed(): Promise<Record<string, unknown>[]> {
  const cols =
    "id,country,generation,latest_tender,winner_contractor,procurement_status,tender_source";
  if (isLocalDb()) {
    const { rows } = await pool().query(`SELECT ${cols} FROM public.tachograph_cards`);
    return rows;
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin.from("tachograph_cards").select(cols);
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * edited_by / changed_by are uuid columns, but the local deployment has no real
 * user: AUTH_MODE=none hands out the marker id "local-user". Writing it straight
 * through made PostgreSQL reject the row with
 * `invalid input syntax for type uuid: "local-user"` — which is what broke the
 * CSV import for every row that matched an existing card, and silently kept the
 * change history empty. Anything that is not a uuid is stored as NULL: an
 * unknown editor is exactly what it is.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return UUID_RE.test(s) ? s : null;
}

// ----------------------------------------------------------- field history

export type FieldHistoryEntry = {
  card_id: string;
  field: string;
  old_value: string;
  new_value: string;
  origin: string;
  source_label?: string;
  source_url?: string;
  proposal_id?: string | null;
  changed_by?: string | null;
};

export type FieldHistoryRow = FieldHistoryEntry & { id: string; created_at: string };

/** The card row as stored, without any override applied. */
export async function getCardById(id: string): Promise<Record<string, unknown> | null> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      `SELECT ${CARD_COLUMNS} FROM public.tachograph_cards WHERE id = $1`,
      [id],
    );
    return (rows[0] as Record<string, unknown>) ?? null;
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("tachograph_cards")
    .select(CARD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown>) ?? null;
}

/**
 * Appends change-history rows. History is documentation, not part of the
 * transaction that changed the data: a failure here is logged and swallowed so
 * a broken history table can never block an edit.
 */
export async function insertFieldHistory(entries: FieldHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    card_id: e.card_id,
    field: e.field,
    old_value: e.old_value ?? "",
    new_value: e.new_value ?? "",
    origin: e.origin,
    source_label: e.source_label ?? "",
    source_url: e.source_url ?? "",
    proposal_id: e.proposal_id ?? null,
    changed_by: uuidOrNull(e.changed_by),
  }));
  try {
    if (isLocalDb()) {
      const values: unknown[] = [];
      const tuples = rows.map((r, i) => {
        const b = i * 9;
        values.push(
          r.card_id,
          r.field,
          r.old_value,
          r.new_value,
          r.origin,
          r.source_label,
          r.source_url,
          r.proposal_id,
          r.changed_by,
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
      });
      await pool().query(
        `INSERT INTO public.card_field_history
           (card_id, field, old_value, new_value, origin, source_label, source_url, proposal_id, changed_by)
         VALUES ${tuples.join(",")}`,
        values,
      );
      return;
    }
    const admin = await supabaseAdmin();
    const { error } = await admin.from("card_field_history").insert(rows as never);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[history] could not record field change:", e);
  }
}

export async function getCardHistory(cardId: string, limit = 200): Promise<FieldHistoryRow[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      `SELECT id, card_id, field, old_value, new_value, origin, source_label, source_url,
              proposal_id, changed_by, created_at
         FROM public.card_field_history
        WHERE card_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [cardId, limit],
    );
    return rows.map((row) => ({
      ...(row as FieldHistoryRow),
      created_at:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("card_field_history")
    .select(
      "id, card_id, field, old_value, new_value, origin, source_label, source_url, proposal_id, changed_by, created_at",
    )
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FieldHistoryRow[];
}

// --------------------------------------------------------------- overrides

export async function getAllOverrides(): Promise<OverrideRow[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      "SELECT card_id, patch FROM public.tachograph_card_overrides",
    );
    return rows as unknown as OverrideRow[];
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin.from("tachograph_card_overrides").select("card_id, patch");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OverrideRow[];
}

export async function getOverridePatch(cardId: string): Promise<Record<string, string> | null> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      "SELECT patch FROM public.tachograph_card_overrides WHERE card_id = $1",
      [cardId],
    );
    return (rows[0]?.patch as Record<string, string>) ?? null;
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("tachograph_card_overrides")
    .select("patch")
    .eq("card_id", cardId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.patch as Record<string, string>) ?? null;
}

export async function saveOverride(
  cardId: string,
  patch: Record<string, string>,
  editedBy: string | null,
): Promise<void> {
  if (isLocalDb()) {
    await pool().query(
      `INSERT INTO public.tachograph_card_overrides (card_id, patch, edited_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (card_id) DO UPDATE SET patch = $2, edited_by = $3, updated_at = now()`,
      [cardId, JSON.stringify(patch), uuidOrNull(editedBy)],
    );
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin
    .from("tachograph_card_overrides")
    .upsert({ card_id: cardId, patch, edited_by: uuidOrNull(editedBy) }, { onConflict: "card_id" });
  if (error) throw new Error(error.message);
}

export async function deleteOverride(cardId: string): Promise<void> {
  if (isLocalDb()) {
    await pool().query("DELETE FROM public.tachograph_card_overrides WHERE card_id = $1", [cardId]);
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin.from("tachograph_card_overrides").delete().eq("card_id", cardId);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------- proposals

export async function getAllProposals(): Promise<ProposalRow[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      "SELECT * FROM public.jrc_update_proposals ORDER BY created_at DESC",
    );
    return rows as unknown as ProposalRow[];
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("jrc_update_proposals")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProposalRow[];
}

export async function getKnownFingerprints(): Promise<Set<string>> {
  const known = new Set<string>();
  if (isLocalDb()) {
    const { rows } = await pool().query("SELECT fingerprint FROM public.jrc_update_proposals");
    for (const r of rows) known.add(r.fingerprint as string);
    return known;
  }
  const admin = await supabaseAdmin();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("jrc_update_proposals")
      .select("fingerprint")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const e of data ?? []) known.add(e.fingerprint as string);
    if (!data || data.length < 1000) break;
  }
  return known;
}

export async function insertProposals(items: ProposalRow[], known: Set<string>): Promise<number> {
  const fresh = items.filter((c) => !known.has(c.fingerprint));
  for (const f of fresh) known.add(f.fingerprint);
  if (fresh.length === 0) return 0;
  if (isLocalDb()) {
    // Columns and values come from one list on purpose. They used to be two
    // separate hand-written sequences, and they had drifted apart: 18 columns
    // against 19 placeholders, numbered from $20 instead of $1. Every check run
    // that actually found something failed with "INSERT has more expressions
    // than target columns" — the sources with nothing new looked healthy, which
    // is why it stayed hidden.
    const columns: Array<[string, (p: ProposalRow) => unknown]> = [
      ["fingerprint", (p) => p.fingerprint],
      ["kind", (p) => p.kind],
      ["card_id", (p) => p.card_id],
      ["country", (p) => p.country],
      ["generation", (p) => p.generation],
      ["jrc_manufacturer", (p) => p.jrc_manufacturer],
      ["jrc_card_name", (p) => p.jrc_card_name],
      ["jrc_certificate", (p) => p.jrc_certificate],
      ["jrc_date", (p) => p.jrc_date],
      ["jrc_eov", (p) => p.jrc_eov],
      ["jrc_type_approval", (p) => p.jrc_type_approval],
      ["source_url", (p) => p.source_url],
      ["source_type", (p) => p.source_type],
      ["source_label", (p) => p.source_label],
      ["title", (p) => p.title],
      ["payload", (p) => JSON.stringify(p.payload ?? {})],
      ["changes", (p) => JSON.stringify(p.changes ?? { fields: [] })],
      ["status", (p) => p.status],
    ];
    const width = columns.length;
    const rowsSql = fresh
      .map((_, row) => `(${columns.map((_, i) => `$${row * width + i + 1}`).join(",")})`)
      .join(",");
    const values = fresh.flatMap((f) => columns.map(([, read]) => read(f)));
    await pool().query(
      `INSERT INTO public.jrc_update_proposals (${columns.map(([c]) => `"${c}"`).join(",")})
       VALUES ${rowsSql}
       ON CONFLICT (fingerprint) DO NOTHING`,
      values,
    );
    return fresh.length;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin.from("jrc_update_proposals").insert(fresh as never);
  if (error) throw new Error(error.message);
  return fresh.length;
}

export async function getProposal(id: string): Promise<ProposalRow | null> {
  if (isLocalDb()) {
    const { rows } = await pool().query("SELECT * FROM public.jrc_update_proposals WHERE id = $1", [
      id,
    ]);
    return (rows[0] as unknown as ProposalRow) ?? null;
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("jrc_update_proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ProposalRow) ?? null;
}

export async function updateProposalStatus(id: string, status: string): Promise<void> {
  if (isLocalDb()) {
    await pool().query("UPDATE public.jrc_update_proposals SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin.from("jrc_update_proposals").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------- snapshots

export async function getSnapshots(
  sourceType: string,
): Promise<{ entry_key: string; fingerprint: string }[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      "SELECT entry_key, fingerprint FROM public.jrc_source_snapshots WHERE source_type = $1",
      [sourceType],
    );
    return rows as { entry_key: string; fingerprint: string }[];
  }
  const admin = await supabaseAdmin();
  const out: { entry_key: string; fingerprint: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("jrc_source_snapshots")
      .select("entry_key,fingerprint")
      .eq("source_type", sourceType)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const s of data ?? []) out.push({ entry_key: s.entry_key, fingerprint: s.fingerprint });
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function upsertSnapshots(
  rows: { source_type: string; entry_key: string; fingerprint: string; updated_at: string }[],
): Promise<void> {
  if (isLocalDb()) {
    // chunk 200
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      let idx = 0;
      const valuesSql = chunk.map(() => `($${++idx},$${++idx},$${++idx},$${++idx})`).join(",");
      const values: unknown[] = [];
      for (const r of chunk) values.push(r.source_type, r.entry_key, r.fingerprint, r.updated_at);
      await pool().query(
        `INSERT INTO public.jrc_source_snapshots (source_type, entry_key, fingerprint, updated_at)
         VALUES ${valuesSql}
         ON CONFLICT (source_type, entry_key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = EXCLUDED.updated_at`,
        values,
      );
    }
    return;
  }
  const admin = await supabaseAdmin();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin
      .from("jrc_source_snapshots")
      .upsert(rows.slice(i, i + 200), { onConflict: "source_type,entry_key" });
    if (error) throw new Error(error.message);
  }
}

// ----------------------------------------------------------- check runs

export async function insertCheckRun(row: {
  source_type: string;
  source_url: string;
  rows_parsed: number;
  proposals_created: number;
  status: string;
  message: string;
}): Promise<void> {
  if (isLocalDb()) {
    await pool().query(
      `INSERT INTO public.jrc_check_runs (source_type, source_url, rows_parsed, proposals_created, status, message)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        row.source_type,
        row.source_url,
        row.rows_parsed,
        row.proposals_created,
        row.status,
        row.message,
      ],
    );
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin.from("jrc_check_runs").insert([row] as never);
  if (error) throw new Error(error.message);
}

export async function getRecentCheckRuns(limit = 20): Promise<CheckRunRow[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      `SELECT * FROM public.jrc_check_runs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows as unknown as CheckRunRow[];
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("jrc_check_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CheckRunRow[];
}

// ----------------------------------------------------------- card mutations

export async function getCardVerificationNotes(
  country: string,
): Promise<{ id: string; verification_note: string }[]> {
  if (isLocalDb()) {
    const { rows } = await pool().query(
      "SELECT id, verification_note FROM public.tachograph_cards WHERE country = $1",
      [country],
    );
    return rows as { id: string; verification_note: string }[];
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin
    .from("tachograph_cards")
    .select("id,verification_note")
    .eq("country", country);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; verification_note: string }[];
}

export async function updateCardVerificationNote(id: string, note: string): Promise<void> {
  if (isLocalDb()) {
    await pool().query("UPDATE public.tachograph_cards SET verification_note = $1 WHERE id = $2", [
      note,
      id,
    ]);
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin
    .from("tachograph_cards")
    .update({ verification_note: note } as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateCardFields(id: string, patch: Record<string, string>): Promise<void> {
  if (isLocalDb()) {
    const cols = Object.keys(patch);
    if (cols.length === 0) return;
    const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(",");
    await pool().query(`UPDATE public.tachograph_cards SET ${sets} WHERE id = $1`, [
      id,
      ...cols.map((c) => patch[c]),
    ]);
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin
    .from("tachograph_cards")
    .update(patch as Record<string, never>)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function insertCard(row: Record<string, unknown>): Promise<void> {
  if (isLocalDb()) {
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`).join(",");
    await pool().query(
      `INSERT INTO public.tachograph_cards (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${vals})`,
      cols.map((c) => row[c]),
    );
    return;
  }
  const admin = await supabaseAdmin();
  const { error } = await admin.from("tachograph_cards").insert(row as never);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------- cron config

export async function getCronConfig(): Promise<{ token: string | null } | null> {
  if (isLocalDb()) {
    const { rows } = await pool().query("SELECT token FROM public.cron_config WHERE id = true");
    return (rows[0] as { token: string | null }) ?? null;
  }
  const admin = await supabaseAdmin();
  const { data, error } = await admin.from("cron_config").select("token").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { token: string | null }) ?? null;
}
