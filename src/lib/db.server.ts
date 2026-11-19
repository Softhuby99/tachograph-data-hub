// Data access. The one database is the PostgreSQL that runs in the same
// container (DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD); every read
// and write of the app goes through this module.
//
// Who may write is decided before a call gets here (see auth.ts and
// requireAdmin in events.server.ts); this module only owns the data.

import type { Pool } from "pg";

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
    // Loaded on first use: a build or a test that never touches the database
    // must not need the driver.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool: PgPool } = require("pg") as typeof import("pg");
    _pool = new PgPool(poolConfig());
  }
  return _pool!;
}

// ------------------------------------------------------- transactions (v2.54)

export type TxQuery = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

/**
 * Runs fn inside one transaction on one connection (local PostgreSQL only).
 * Code review 10: approving a proposal or saving an edit touches several rows
 * (card, override, history, proposal status) — all or nothing.
 */
export async function withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const q: TxQuery = async (sql, params = []) =>
      (await client.query(sql, params as never[])).rows as never;
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Overrides merged into card rows — the values a reader actually sees. */
export async function withOverrides<T extends { id: string }>(rows: T[]): Promise<T[]> {
  const overrides = await getAllOverrides();
  if (overrides.length === 0) return rows;
  const byId = new Map(overrides.map((o) => [o.card_id, o.patch ?? {}]));
  return rows.map((r) => {
    const patch = byId.get(r.id);
    if (!patch) return r;
    const merged = { ...r } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) merged[k] = v;
    return merged as T;
  });
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
  device_type?: string | null;
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
  /** Last real change (status, country, payload) — not the review marker. */
  updated_at: string;
  /** Set when someone explicitly marked the proposal as read. */
  reviewed_at: string | null;
  reviewed_by: string | null;
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

// ------------------------------------------------------------------ raw cards

const CARD_COLUMNS =
  "id,country,country_flag,device_type,generation,application,current_manufacturer,current_manufacturer_normalized,chip_platform_vendor,security_certificate,chip_certificate,certificate_issued_date,certificate_expiry_date,type_approval_number,certified_security_platform,certificate_holder,date_status,issued_by_authority,jrc_interoperability_status,functional_certificate_lab,security_certificate_lab,tachograph_application_os,distinction_from_manufacturer,jrc_certificate_source,primary_source,latest_tender,winner_contractor,procurement_status,procurement_scope,tender_source,verification_note,data_reference_date,created_at,updated_at";

export async function getAllCards(): Promise<Record<string, unknown>[]> {
  const { rows } = await pool().query(
    `SELECT ${CARD_COLUMNS} FROM public.tachograph_cards ORDER BY country`,
  );
  // node-postgres decodes DATE/TIMESTAMP columns as Date objects. The browser
  // gets strings: React
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

export async function getCardsForJrc(): Promise<CardRow[]> {
  const cols =
    "id,country,generation,type_approval_number,current_manufacturer,tachograph_application_os,jrc_interoperability_status,jrc_certificate_source,data_reference_date,device_type";
  const { rows } = await pool().query(`SELECT ${cols} FROM public.tachograph_cards`);
  return rows as unknown as CardRow[];
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
  const { rows } = await pool().query(`SELECT ${cols} FROM public.tachograph_cards`);
  return rows as never;
}

export async function getCardsForTed(): Promise<Record<string, unknown>[]> {
  const cols =
    "id,country,generation,latest_tender,winner_contractor,procurement_status,tender_source";
  const { rows } = await pool().query(`SELECT ${cols} FROM public.tachograph_cards`);
  return rows;
}

/**
 * edited_by / changed_by are uuid columns, but the local deployment has no real
 * user: the admin login hands out the marker id "local-user". Writing it straight
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
  const { rows } = await pool().query(
    `SELECT ${CARD_COLUMNS} FROM public.tachograph_cards WHERE id = $1`,
    [id],
  );
  return (rows[0] as Record<string, unknown>) ?? null;
}

/**
 * Appends change-history rows. History is documentation, not part of the
 * transaction that changed the data: a failure here is logged and swallowed so
 * a broken history table can never block an edit.
 */
/** v2.54: history rows written inside a transaction (they commit or roll back with the change). */
export async function insertFieldHistoryTx(
  q: TxQuery,
  entries: FieldHistoryEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const values: unknown[] = [];
  const tuples = entries.map((e, i) => {
    const b = i * 9;
    values.push(
      e.card_id,
      e.field,
      e.old_value ?? "",
      e.new_value ?? "",
      e.origin,
      e.source_label ?? "",
      e.source_url ?? "",
      e.proposal_id ?? null,
      uuidOrNull(e.changed_by),
    );
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
  });
  await q(
    `INSERT INTO public.card_field_history
       (card_id, field, old_value, new_value, origin, source_label, source_url, proposal_id, changed_by)
     VALUES ${tuples.join(",")}`,
    values,
  );
}

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
  } catch (e) {
    console.error("[history] could not record field change:", e);
    // v2.52: also into the operations log (dynamic import: events.server
    // imports this module).
    void import("./events.server").then((m) =>
      m.emitEvent({
        level: "ERROR",
        category: "action",
        code: "action.history.failed",
        status: "failed",
        message: `Field history could not be recorded (${rows.length} change(s)): ${m.errorMessage(e)}`,
        cardId: (rows[0] as { card_id?: string } | undefined)?.card_id ?? null,
        details: {
          fields: rows.map((r) => (r as { field?: string }).field ?? "").slice(0, 20),
          ...m.errorDetails(e),
        },
      }),
    );
  }
}

export async function getCardHistory(cardId: string, limit = 200): Promise<FieldHistoryRow[]> {
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

/**
 * v2.77: removes the change history of one record. The record itself and its
 * manual edits stay as they are — only the list of earlier changes goes.
 * Returns how many entries were removed.
 */
export async function deleteCardHistory(cardId: string): Promise<number> {
  const res = await pool().query(`DELETE FROM public.card_field_history WHERE card_id = $1`, [
    cardId,
  ]);
  return res.rowCount ?? 0;
}

/** v2.83: how much change history there is (entries, records that have any). */
export async function getHistoryStats(): Promise<{ entries: number; records: number }> {
  const { rows } = await pool().query(
    `SELECT count(*)::int AS entries, count(DISTINCT card_id)::int AS records
       FROM public.card_field_history`,
  );
  return { entries: Number(rows[0]?.entries ?? 0), records: Number(rows[0]?.records ?? 0) };
}

/**
 * v2.83: removes the change history of ALL records in one go. The records and
 * their manual edits stay as they are. Returns how many entries were removed.
 */
export async function deleteAllCardHistory(): Promise<number> {
  const res = await pool().query(`DELETE FROM public.card_field_history`);
  return res.rowCount ?? 0;
}

// --------------------------------------------------------------- overrides

export async function getAllOverrides(): Promise<OverrideRow[]> {
  const { rows } = await pool().query(
    "SELECT card_id, patch FROM public.tachograph_card_overrides",
  );
  return rows as unknown as OverrideRow[];
}

export async function getOverridePatch(cardId: string): Promise<Record<string, string> | null> {
  const { rows } = await pool().query(
    "SELECT patch FROM public.tachograph_card_overrides WHERE card_id = $1",
    [cardId],
  );
  return (rows[0]?.patch as Record<string, string>) ?? null;
}

export async function saveOverride(
  cardId: string,
  patch: Record<string, string>,
  editedBy: string | null,
): Promise<void> {
  await pool().query(
    `INSERT INTO public.tachograph_card_overrides (card_id, patch, edited_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (card_id) DO UPDATE SET patch = $2, edited_by = $3, updated_at = now()`,
    [cardId, JSON.stringify(patch), uuidOrNull(editedBy)],
  );
}

// ------------------------------------------------- manual edits (v2.54, review 18)

/** Fields a manual edit may set: the card columns plus the virtual card_quantities. */
export const EDITABLE_FIELDS = new Set(
  CARD_COLUMNS.split(",")
    .filter((c) => !["id", "created_at", "updated_at", "data_reference_date"].includes(c))
    .concat(["card_quantities"]),
);

export type EditConflict = { field: string; original: string; theirs: string; yours: string };
export type EditResult =
  | { ok: true; applied: string[]; cleared: boolean }
  | { ok: false; conflicts: EditConflict[] };

const s_ = (v: unknown) => String(v ?? "");

/**
 * Saves a manual edit field by field. `expected` holds what the editor saw
 * when they started; a field that someone else changed in the meantime is a
 * conflict unless both ended up with the same value. Fields the editor did
 * not touch are never written. One transaction with the
 * card and override rows locked; history is written in the same transaction.
 */
export async function applyCardEdit(
  cardId: string,
  changes: Record<string, string>,
  expected: Record<string, string>,
  userId: string | null,
  normalise: (patch: Record<string, string>, base: Record<string, unknown>) => void,
): Promise<EditResult> {
  const run = async (
    read: () => Promise<{ base: Record<string, unknown> | null; patch: Record<string, string> }>,
    write: (next: Record<string, string> | null, history: FieldHistoryEntry[]) => Promise<void>,
  ): Promise<EditResult> => {
    const { base, patch } = await read();
    if (!base) throw new Error("Record not found");
    const current = (f: string) =>
      Object.prototype.hasOwnProperty.call(patch, f) ? s_(patch[f]) : s_(base[f]);
    const conflicts: EditConflict[] = [];
    const apply: Record<string, string> = {};
    for (const [field, yours] of Object.entries(changes)) {
      const original = s_(expected[field]);
      const theirs = current(field);
      if (yours === original) continue; // not touched by this editor
      if (theirs === yours) continue; // already the same value
      if (theirs !== original) {
        conflicts.push({ field, original, theirs, yours });
        continue;
      }
      apply[field] = yours;
    }
    if (conflicts.length > 0) return { ok: false, conflicts };
    if (Object.keys(apply).length === 0) return { ok: true, applied: [], cleared: false };
    normalise(apply, base);
    const next: Record<string, string> = { ...patch };
    const history: FieldHistoryEntry[] = [];
    for (const [field, value] of Object.entries(apply)) {
      const before = current(field);
      if (value === s_(base[field])) delete next[field];
      else next[field] = value;
      if (before !== value)
        history.push({
          card_id: cardId,
          field,
          old_value: before,
          new_value: value,
          origin: "manual",
          changed_by: userId,
        });
    }
    const empty = Object.keys(next).length === 0;
    await write(empty ? null : next, history);
    return { ok: true, applied: Object.keys(apply), cleared: empty };
  };

  return await withTransaction(async (q) =>
    run(
      async () => {
        const [base] = await q(`SELECT * FROM public.tachograph_cards WHERE id = $1 FOR UPDATE`, [
          cardId,
        ]);
        const [ov] = await q<{ patch: Record<string, string> }>(
          `SELECT patch FROM public.tachograph_card_overrides WHERE card_id = $1 FOR UPDATE`,
          [cardId],
        );
        return { base: base ?? null, patch: { ...(ov?.patch ?? {}) } };
      },
      async (next, history) => {
        if (next === null) {
          await q(`DELETE FROM public.tachograph_card_overrides WHERE card_id = $1`, [cardId]);
        } else {
          await q(
            `INSERT INTO public.tachograph_card_overrides (card_id, patch, edited_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (card_id) DO UPDATE SET patch = $2, edited_by = $3, updated_at = now()`,
            [cardId, JSON.stringify(next), uuidOrNull(userId)],
          );
        }
        await insertFieldHistoryTx(q, history);
      },
    ),
  );
}

export async function deleteOverride(cardId: string): Promise<void> {
  await pool().query("DELETE FROM public.tachograph_card_overrides WHERE card_id = $1", [cardId]);
}

// ----------------------------------------------------------- proposals

export async function getAllProposals(): Promise<ProposalRow[]> {
  const { rows } = await pool().query(
    "SELECT * FROM public.jrc_update_proposals ORDER BY created_at DESC",
  );
  return rows as unknown as ProposalRow[];
}

export async function getKnownFingerprints(): Promise<Set<string>> {
  const known = new Set<string>();
  const { rows } = await pool().query("SELECT fingerprint FROM public.jrc_update_proposals");
  for (const r of rows) known.add(r.fingerprint as string);
  return known;
}

export async function insertProposals(items: ProposalRow[], known: Set<string>): Promise<number> {
  const fresh = items.filter((c) => !known.has(c.fingerprint));
  for (const f of fresh) known.add(f.fingerprint);
  if (fresh.length === 0) return 0;
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

export async function getProposal(id: string): Promise<ProposalRow | null> {
  const { rows } = await pool().query("SELECT * FROM public.jrc_update_proposals WHERE id = $1", [
    id,
  ]);
  return (rows[0] as unknown as ProposalRow) ?? null;
}

/**
 * Sets the status of a proposal.
 *
 * Deciding a proposal is also the strongest possible evidence that somebody
 * looked at it, so approve and dismiss set the review marker in the same
 * statement. Reopening deliberately does not touch it: the entry goes back to
 * pending precisely because the earlier decision is in doubt, and the marker
 * still records that it was read.
 */
export async function updateProposalStatus(
  id: string,
  status: string,
  userId?: string | null,
): Promise<void> {
  const marksReviewed = status === "approved" || status === "rejected";
  await pool().query(
    marksReviewed
      ? `UPDATE public.jrc_update_proposals
           SET status = $1, reviewed_at = now(), reviewed_by = $3
         WHERE id = $2`
      : "UPDATE public.jrc_update_proposals SET status = $1 WHERE id = $2",
    marksReviewed ? [status, id, uuidOrNull(userId)] : [status, id],
  );
}

/**
 * Marks proposals as read, or clears the marker again.
 *
 * The handled list had no notion of progress: with dozens of entries there was
 * no way to tell which ones had already been gone through, so every pass
 * started at the top. This is that marker, and nothing else — it never changes
 * the status and never writes to a card.
 */
export async function setProposalsReviewed(
  ids: string[],
  reviewed: boolean,
  userId?: string | null,
): Promise<number> {
  const clean = ids.map((id) => String(id ?? "").trim()).filter((id) => UUID_RE.test(id));
  if (clean.length === 0) return 0;
  const { rowCount } = await pool().query(
    `UPDATE public.jrc_update_proposals
        SET reviewed_at = $2, reviewed_by = $3
      WHERE id = ANY($1::uuid[])`,
    [clean, reviewed ? new Date().toISOString() : null, reviewed ? uuidOrNull(userId) : null],
  );
  return rowCount ?? 0;
}

// ----------------------------------------------------------- snapshots

export async function getSnapshots(
  sourceType: string,
): Promise<{ entry_key: string; fingerprint: string }[]> {
  const { rows } = await pool().query(
    "SELECT entry_key, fingerprint FROM public.jrc_source_snapshots WHERE source_type = $1",
    [sourceType],
  );
  return rows as { entry_key: string; fingerprint: string }[];
}

export async function upsertSnapshots(
  rows: { source_type: string; entry_key: string; fingerprint: string; updated_at: string }[],
): Promise<void> {
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
}

// ----------------------------------------------------------- check runs

export async function insertCheckRun(row: {
  source_type: string;
  source_url: string;
  rows_parsed: number;
  proposals_created: number;
  status: string;
  message: string;
  /** v2.52: run grouping, who started it, how long the source took. */
  run_id?: string | null;
  triggered_by?: string;
  duration_ms?: number | null;
}): Promise<string | null> {
  const { rows } = await pool().query(
    `INSERT INTO public.jrc_check_runs
       (source_type, source_url, rows_parsed, proposals_created, status, message, run_id, triggered_by, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      row.source_type,
      row.source_url,
      row.rows_parsed,
      row.proposals_created,
      row.status,
      row.message,
      row.run_id ?? null,
      row.triggered_by ?? "manual",
      row.duration_ms ?? null,
    ],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

export async function getRecentCheckRuns(limit = 20): Promise<CheckRunRow[]> {
  const { rows } = await pool().query(
    `SELECT * FROM public.jrc_check_runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows as unknown as CheckRunRow[];
}

// ----------------------------------------------------------- card mutations

/** Inserts a card and returns its id, so callers can keep their lookup maps current. */
export async function insertCard(row: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(row);
  const vals = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await pool().query(
    `INSERT INTO public.tachograph_cards (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${vals}) RETURNING id`,
    cols.map((c) => row[c]),
  );
  return String(rows[0]?.id ?? "");
}

// ----------------------------------------------------------- cron config

export async function getCronConfig(): Promise<{ token: string | null } | null> {
  const { rows } = await pool().query("SELECT token FROM public.cron_config WHERE id = true");
  return (rows[0] as { token: string | null }) ?? null;
}

// ------------------------------------------------------- jrc current listing

/**
 * One row per type approval currently shown on a JRC source page, as parsed
 * on the last successful check run. Replaced wholesale per source_type (see
 * replaceCurrentListing) — a reader never sees a half-written listing.
 */
export type CurrentListingRow = {
  source_type: string;
  type_approval_number: string;
  raw_type_approval: string;
  manufacturer: string;
  card_name: string;
  certificate: string;
  jrc_date: string;
  eov: string;
  generation: string;
  device_type: string;
};

export async function getCurrentListing(): Promise<(CurrentListingRow & { updated_at: string })[]> {
  const { rows } = await pool().query(
    `SELECT source_type, type_approval_number, raw_type_approval, manufacturer, card_name,
            certificate, jrc_date, eov, generation, device_type, updated_at
       FROM public.jrc_current_listing`,
  );
  return rows.map((row) => ({
    ...(row as CurrentListingRow),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }));
}

/**
 * Replaces the entire listing for one source_type in one go — this is a
 * mirror of "what JRC shows right now" for that page, not an accumulating
 * log, so a row that has disappeared from JRC must disappear here too.
 * Delete and insert run inside one transaction so a reader never observes
 * the table between the two.
 */
export async function replaceCurrentListing(
  sourceType: string,
  rows: CurrentListingRow[],
): Promise<void> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM public.jrc_current_listing WHERE source_type = $1", [
      sourceType,
    ]);
    const columns: Array<[string, (r: CurrentListingRow) => unknown]> = [
      ["source_type", (r) => r.source_type],
      ["type_approval_number", (r) => r.type_approval_number],
      ["raw_type_approval", (r) => r.raw_type_approval],
      ["manufacturer", (r) => r.manufacturer],
      ["card_name", (r) => r.card_name],
      ["certificate", (r) => r.certificate],
      ["jrc_date", (r) => r.jrc_date],
      ["eov", (r) => r.eov],
      ["generation", (r) => r.generation],
      ["device_type", (r) => r.device_type],
    ];
    const width = columns.length;
    // Chunked: a single very large insert can be silently truncated by the
    // driver/network layer, same reasoning as upsertSnapshots above.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      if (chunk.length === 0) continue;
      const valuesSql = chunk
        .map((_, row) => `(${columns.map((_, c) => `$${row * width + c + 1}`).join(",")})`)
        .join(",");
      const values = chunk.flatMap((r) => columns.map(([, read]) => read(r)));
      await client.query(
        `INSERT INTO public.jrc_current_listing (${columns.map(([c]) => `"${c}"`).join(",")})
         VALUES ${valuesSql}`,
        values,
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------- operations log (v2.52)

/**
 * True when a database is configured. The container always sets DB_HOST
 * (Dockerfile.web); a build or a test run has none. Operations log, settings,
 * scheduler and platform lines ask this first and fall back to the console or
 * to defaults instead of failing on a connection that cannot exist.
 */
export function dbConfigured(): boolean {
  return !!process.env["DB_HOST"];
}

/** Parameterised query for the modules that keep their own tables. */
export async function eventsQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool().query(sql, params as never[]);
  return rows as unknown as T[];
}
