// v2.77: consistency rules and the repair transaction.
// Run: npx tsx tools/test_consistency.ts
import assert from "node:assert/strict";
import { checkConsistency, type ConsistencyIssue, type ListingRow } from "../src/lib/consistency";
import { applyFixesInTx } from "../src/lib/consistency.server";
import { flagEmoji } from "../src/lib/country-flag";

const card = (id: string, o: Record<string, unknown>) => ({
  id,
  country: "Germany",
  country_flag: flagEmoji("Germany"),
  device_type: "Card",
  generation: "G1",
  type_approval_number: "",
  current_manufacturer: "X",
  date_status: "01.01.2020",
  jrc_interoperability_status: "JRC_DTLab/1",
  ...o,
});
const listed = (o: Partial<ListingRow>): ListingRow => ({
  source_type: "other_certificates",
  raw_type_approval: "",
  manufacturer: "X",
  card_name: "Name",
  certificate: "",
  jrc_date: "",
  eov: "",
  generation: "G1",
  device_type: "Card",
  ...o,
});

const base = [
  card("a", { type_approval_number: "e1-100-00", country_flag: "" }), // flag missing
  card("b", { type_approval_number: "e68-001", country: "Kirgisistan", country_flag: "" }),
  card("c", { type_approval_number: "e13-0001-00", generation: "G1" }), // JRC: G2.1
  card("d", {
    type_approval_number: "e1-84-04",
    device_type: "Vehicle Unit",
    generation: "",
    date_status: "",
  }),
  card("e", { type_approval_number: "e1-0015-00", date_status: "27.10.2020" }), // JRC: 23.10.2020
  card("f", { type_approval_number: "Not identified" }),
  card("g", { type_approval_number: "e2-43" }),
  card("h", { type_approval_number: "e2_43" }), // duplicate of g
  card("i", { type_approval_number: "e5-0001", jrc_interoperability_status: "" }),
  card("j", { type_approval_number: "e1-200-00", date_status: "05.05.2021" }),
];
const overrides = [
  // repeats the stored value -> no-op; the second field is a real edit
  { card_id: "a", patch: { current_manufacturer: "X", date_status: "02.02.2022" } },
  // virtual field without a column: must be left alone
  { card_id: "g", patch: { card_quantities: "100" } },
];
const listing = [
  listed({ raw_type_approval: "e1-100-00", jrc_date: "01/01/2020" }),
  listed({ raw_type_approval: "e68-001", jrc_date: "19/06/2024" }),
  listed({ raw_type_approval: "e13-0001-00", generation: "G2.1", jrc_date: "01/01/2020" }),
  listed({ raw_type_approval: "e1-84-04", device_type: "Vehicle Unit", jrc_date: "12/11/2020" }),
  listed({ raw_type_approval: "e1-0015-00", jrc_date: "23/10/2020" }),
  listed({ raw_type_approval: "e2-43", jrc_date: "01.01.2020" }),
  listed({
    raw_type_approval: "e5-0001",
    certificate: "JRC_DTLab/A3-1/2020",
    jrc_date: "01/01/2020",
    eov: "01/07/2020",
  }),
  // the card status page dates the interoperability certificate — no date repair from it
  listed({ raw_type_approval: "e1-200-00", source_type: "card_status", jrc_date: "01/05/2021" }),
  // listed, no record
  listed({
    raw_type_approval: "e5-0002-11",
    device_type: "Vehicle Unit",
    generation: "G2.2",
    manufacturer: "Stoneridge",
  }),
  // paper is not a record type
  listed({ raw_type_approval: "e1-0009-06", device_type: "Paper" }),
];

const issues = checkConsistency({ base, overrides, listing });
const of = (rule: string, cardId?: string) =>
  issues.filter((i) => i.rule === rule && (cardId === undefined || i.cardId === cardId));
const one = (rule: string, cardId: string): ConsistencyIssue => {
  const found = of(rule, cardId);
  assert.equal(found.length, 1, `${rule} on ${cardId}`);
  return found[0]!;
};

assert.equal(one("flag_mismatch", "a").fix!.new, flagEmoji("Germany"));
assert.ok(one("flag_mismatch", "a").safe);
assert.equal(one("country_spelling", "b").fix!.new, "Kyrgyzstan");
assert.equal(one("flag_mismatch", "b").fix!.new, flagEmoji("Kyrgyzstan"));

const gen = one("generation_vs_jrc", "c");
assert.equal(gen.fix!.new, "G2.1");
assert.equal(gen.safe, false, "a changed generation is never applied in bulk");

const dm = one("date_missing", "d");
assert.equal(dm.fix!.new, "12.11.2020");
assert.ok(dm.safe);

const dv = one("date_vs_jrc", "e");
assert.equal(dv.fix!.new, "23.10.2020");
assert.equal(dv.safe, false);
assert.equal(of("date_vs_jrc", "j").length, 0, "card status dates are not approval dates");

assert.equal(of("placeholder_approval", "f").length, 1);
assert.equal(of("duplicate").length, 2, "g and h are the same approval in two spellings");
assert.equal(
  one("status_missing", "i").fix!.new,
  "JRC_DTLab/A3-1/2020 · issued 01/01/2020 · EOV 01/07/2020",
);

const noop = of("override_noop", "a");
assert.equal(noop.length, 1);
assert.equal(noop[0]!.fix!.field, "current_manufacturer");
assert.equal(of("override_noop", "g").length, 0, "virtual fields are not columns");

const missing = of("jrc_without_record");
assert.equal(missing.length, 1);
assert.equal(missing[0]!.typeApproval, "e5-0002-11");

// nothing to report for a clean, matching record
assert.equal(
  checkConsistency({
    base: [card("z", { type_approval_number: "e1-100-00" })],
    overrides: [],
    listing: [listed({ raw_type_approval: "e1-100-00", jrc_date: "01/01/2020" })],
  }).length,
  0,
);

// ---------------------------------------------------------------- repairs
type Call = { sql: string; params: unknown[] };
function fakeDb(
  cards: Record<string, Record<string, unknown>>,
  patches: Record<string, Record<string, string>>,
) {
  const calls: Call[] = [];
  const q = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (/^SELECT \* FROM public\.tachograph_cards/.test(sql.trim())) {
      const c = cards[String(params[0])];
      return c ? [c] : [];
    }
    if (/^SELECT patch FROM public\.tachograph_card_overrides/.test(sql.trim())) {
      const p = patches[String(params[0])];
      return p ? [{ patch: p }] : [];
    }
    return [];
  };
  return { q: q as never, calls };
}
const group = (list: ConsistencyIssue[]) => {
  const m = new Map<string, ConsistencyIssue[]>();
  for (const i of list) m.set(i.cardId!, [...(m.get(i.cardId!) ?? []), i]);
  return m;
};

{
  // country spelling: country + flag are written, one history row (not for the flag)
  const db = fakeDb({ b: base[1]! }, {});
  const n = await applyFixesInTx(
    db.q,
    group([one("country_spelling", "b"), one("flag_mismatch", "b")]),
    null,
  );
  assert.equal(n, 2);
  const upd = db.calls.find((c) => c.sql.startsWith("UPDATE public.tachograph_cards"))!;
  assert.match(upd.sql, /"country" = \$2, "country_flag" = \$3 WHERE id = \$1/);
  assert.deepEqual(upd.params, ["b", "Kyrgyzstan", flagEmoji("Kyrgyzstan")]);
  const hist = db.calls.filter((c) => c.sql.startsWith("INSERT INTO public.card_field_history"));
  assert.equal(hist.length, 1);
  assert.deepEqual(hist[0]!.params.slice(0, 5), [
    "b",
    "country",
    "Kirgisistan",
    "Kyrgyzstan",
    "consistency_fix",
  ]);
}
{
  // no-op manual edit: only that field leaves the override, the real edit stays
  const db = fakeDb({ a: base[0]! }, { a: { ...overrides[0]!.patch } });
  const n = await applyFixesInTx(db.q, group(of("override_noop", "a")), null);
  assert.equal(n, 1);
  assert.ok(!db.calls.some((c) => c.sql.startsWith("UPDATE public.tachograph_cards")));
  const upd = db.calls.find((c) => c.sql.startsWith("UPDATE public.tachograph_card_overrides"))!;
  assert.deepEqual(JSON.parse(String(upd.params[1])), { date_status: "02.02.2022" });
  assert.ok(!db.calls.some((c) => c.sql.startsWith("INSERT INTO public.card_field_history")));
}
{
  // a repaired field that carries a manual edit: the edit goes, history keeps the visible value
  const db = fakeDb({ c: base[2]! }, { c: { generation: "G2.2" } });
  const issue = { ...gen, fix: { ...gen.fix!, old: "G2.2" } };
  await applyFixesInTx(db.q, group([issue]), "local-user");
  assert.ok(db.calls.some((c) => c.sql.startsWith("DELETE FROM public.tachograph_card_overrides")));
  const hist = db.calls.find((c) => c.sql.startsWith("INSERT INTO public.card_field_history"))!;
  assert.deepEqual(hist.params.slice(0, 4), ["c", "generation", "G2.2", "G2.1"]);
}
{
  // a record that no longer exists is skipped, nothing is written
  const db = fakeDb({}, {});
  assert.equal(await applyFixesInTx(db.q, group([dm]), null), 0);
  assert.equal(db.calls.length, 1);
}

console.log("consistency: ok");
