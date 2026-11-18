// v2.77: consistency check — server side (Tools → Consistency).
//
// The list is computed on request. A repair is never taken from the browser:
// the server recomputes the findings and applies the ones whose ids were sent,
// so a stale page cannot write an outdated value.

import {
  getAllCards,
  getAllOverrides,
  getCurrentListing,
  getKnownFingerprints,
  insertProposals,
  insertFieldHistoryTx,
  isLocalDb,
  withTransaction,
  type ProposalRow,
  type TxQuery,
} from "@/lib/db.server";
import {
  checkConsistency,
  summariseConsistency,
  CONSISTENCY_RULE_LABELS,
  REPAIRABLE_FIELDS,
  type ConsistencyCard,
  type ConsistencyIssue,
  type ConsistencySummary,
} from "@/lib/consistency";
import { flagEmoji, normalizeCountry } from "@/lib/country-flag";
import { documentedCountry, resolveFromCardName } from "@/lib/ta-country";
import { JRC_SOURCES, type SourceKey } from "@/lib/jrc-sources.server";
import { emitEvent } from "@/lib/events.server";

export async function computeConsistency(): Promise<{
  computedAt: string;
  listingUpdatedAt: string | null;
  summary: ConsistencySummary;
  issues: ConsistencyIssue[];
}> {
  const [cards, overrides, listing] = await Promise.all([
    getAllCards(),
    getAllOverrides(),
    getCurrentListing(),
  ]);
  const issues = checkConsistency({
    base: cards as ConsistencyCard[],
    overrides,
    listing,
  });
  const newest = listing.reduce((acc, l) => (l.updated_at > acc ? l.updated_at : acc), "");
  return {
    computedAt: new Date().toISOString(),
    listingUpdatedAt: newest || null,
    summary: summariseConsistency(cards.length, listing.length, issues),
    issues,
  };
}

export type RepairResult = { applied: number; skipped: number; records: number };

/**
 * Applies the repairs with the given ids (or every safe one). One transaction:
 * record, manual edit and history change together or not at all.
 */
export async function applyConsistencyFixes(
  opts: { ids?: string[]; allSafe?: boolean },
  userId: string | null,
): Promise<RepairResult> {
  if (!isLocalDb()) throw new Error("Repairs need the local database.");
  const { issues } = await computeConsistency();
  const wanted = new Set(opts.ids ?? []);
  const chosen = issues.filter(
    (i) => i.fix && i.cardId && (opts.allSafe ? i.safe : wanted.has(i.id)),
  );
  const requested = opts.allSafe ? chosen.length : wanted.size;
  if (chosen.length === 0) return { applied: 0, skipped: requested, records: 0 };

  const byCard = new Map<string, ConsistencyIssue[]>();
  for (const i of chosen) byCard.set(i.cardId!, [...(byCard.get(i.cardId!) ?? []), i]);

  const applied = await withTransaction((q) => applyFixesInTx(q, byCard, userId));

  const byRule: Record<string, number> = {};
  for (const i of chosen) byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
  await emitEvent({
    level: "INFO",
    category: "quality",
    code: "quality.repair.applied",
    status: "success",
    trigger: "manual",
    message: `Consistency check: ${applied} repair(s) applied to ${byCard.size} record(s)`,
    details: { byRule, allSafe: opts.allSafe === true },
  });
  return { applied, skipped: Math.max(0, requested - applied), records: byCard.size };
}

/**
 * The writes of a repair run, inside one transaction. Exported for the tests
 * (tools/test_consistency.ts runs it against a recording query function).
 */
export async function applyFixesInTx(
  q: TxQuery,
  byCard: Map<string, ConsistencyIssue[]>,
  userId: string | null,
): Promise<number> {
  let applied = 0;
  for (const [cardId, list] of byCard) {
    const [card] = await q<Record<string, unknown>>(
      `SELECT * FROM public.tachograph_cards WHERE id = $1 FOR UPDATE`,
      [cardId],
    );
    if (!card) continue;
    const [ov] = await q<{ patch: Record<string, string> }>(
      `SELECT patch FROM public.tachograph_card_overrides WHERE card_id = $1 FOR UPDATE`,
      [cardId],
    );
    const patch: Record<string, string> = { ...(ov?.patch ?? {}) };
    const set: Record<string, string> = {};
    const history = [];
    let overrideChanged = false;

    for (const issue of list) {
      const fix = issue.fix!;
      if (!/^[a-z_]{1,64}$/.test(fix.field)) continue;
      if (fix.kind === "drop_override") {
        if (Object.prototype.hasOwnProperty.call(patch, fix.field)) {
          delete patch[fix.field];
          overrideChanged = true;
          applied += 1;
        }
        continue;
      }
      if (!REPAIRABLE_FIELDS.has(fix.field)) continue;
      const value = fix.field === "country" ? normalizeCountry(fix.new) : fix.new;
      const visible = Object.prototype.hasOwnProperty.call(patch, fix.field)
        ? String(patch[fix.field] ?? "")
        : String(card[fix.field] ?? "");
      set[fix.field] = value;
      // The repaired value must be the visible one: a manual edit of the
      // field would keep hiding it.
      if (Object.prototype.hasOwnProperty.call(patch, fix.field)) {
        delete patch[fix.field];
        overrideChanged = true;
      }
      if (fix.field === "country") {
        set["country_flag"] = flagEmoji(value);
        if (Object.prototype.hasOwnProperty.call(patch, "country_flag")) {
          delete patch["country_flag"];
          overrideChanged = true;
        }
      }
      // The flag follows from the country; it is not a change worth a history row.
      if (fix.field !== "country_flag") {
        history.push({
          card_id: cardId,
          field: fix.field,
          old_value: visible.trim(),
          new_value: value,
          origin: "consistency_fix",
          source_label: CONSISTENCY_RULE_LABELS[issue.rule],
          source_url: "",
          proposal_id: null,
          changed_by: userId,
        });
      }
      applied += 1;
    }

    const cols = Object.keys(set);
    if (cols.length > 0) {
      await q(
        `UPDATE public.tachograph_cards SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`,
        [cardId, ...cols.map((c) => set[c])],
      );
    }
    if (overrideChanged && ov) {
      if (Object.keys(patch).length === 0) {
        await q(`DELETE FROM public.tachograph_card_overrides WHERE card_id = $1`, [cardId]);
      } else {
        await q(
          `UPDATE public.tachograph_card_overrides SET patch = $2, updated_at = now() WHERE card_id = $1`,
          [cardId, JSON.stringify(patch)],
        );
      }
    }
    await insertFieldHistoryTx(q, history);
  }
  return applied;
}

/**
 * JRC entries without a record become "new" proposals in the Update Monitor —
 * the record is created there on approval, like any other new entry.
 */
export async function proposeMissingJrcEntries(ids?: string[]): Promise<{ created: number }> {
  const { issues } = await computeConsistency();
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  const missing = issues.filter(
    (i) => i.rule === "jrc_without_record" && i.jrc && (!wanted || wanted.has(i.id)),
  );
  if (missing.length === 0) return { created: 0 };
  const known = await getKnownFingerprints();
  const items = missing.map((i) => {
    const l = i.jrc!;
    const source = (
      l.source_type in JRC_SOURCES ? l.source_type : "other_certificates"
    ) as SourceKey;
    const meta = JRC_SOURCES[source];
    const country =
      l.device_type === "Card"
        ? (documentedCountry(l.raw_type_approval)?.country ??
          resolveFromCardName(l.card_name)?.country ??
          "")
        : "";
    const payload: Record<string, string> = {
      "Device type": l.device_type,
      Manufacturer: l.manufacturer,
      Name: l.card_name,
      "Type approval certificate": l.raw_type_approval,
      "Date of approval": l.jrc_date,
      "Found by": "Consistency check — listed on JRC, no record in Data",
    };
    if (country) payload["Resolved country"] = country;
    return {
      fingerprint: `consistency:${i.id}`,
      kind: "new",
      card_id: null,
      country,
      generation: l.generation,
      jrc_manufacturer: l.manufacturer,
      jrc_card_name: l.card_name,
      jrc_certificate: l.certificate,
      jrc_date: l.jrc_date,
      jrc_eov: l.eov,
      jrc_type_approval: l.raw_type_approval,
      source_url: meta.url,
      source_type: source,
      source_label: meta.label,
      title: `New entry · ${l.device_type} · ${l.raw_type_approval} — ${l.manufacturer}`,
      payload,
      changes: { fields: [] },
      status: "pending",
    };
  });
  const created = await insertProposals(items as unknown as ProposalRow[], known);
  await emitEvent({
    level: "INFO",
    category: "quality",
    code: "quality.repair.proposed",
    status: "success",
    trigger: "manual",
    message: `Consistency check: ${created} proposal(s) created for JRC entries without a record`,
    details: { requested: missing.length, created },
  });
  return { created };
}
