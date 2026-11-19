// v2.83: the four marketing reports. Run: npx tsx tools/test_reports.ts
import assert from "node:assert/strict";
import { computeMarketStatus } from "../src/lib/market-status";
import {
  dependencyReport,
  generationLeaders,
  inG22Area,
  marketShareReport,
  movesReport,
  pipelineReport,
  supplierName,
  UNKNOWN,
  type ReportCard,
} from "../src/lib/reports";

// ---- supplier names: spellings of one company, not mergers
assert.equal(supplierName("AKD d.o.o."), "AKD");
assert.equal(supplierName("Agencija za komercijalnu djelatnost d.o.o (AKD)"), "AKD");
assert.equal(supplierName("Polska Wytwórnia Papierów Wartosciowych S.A. - PWPW S.A."), "PWPW");
assert.equal(supplierName("PWPW S.A. / DEMAX"), "PWPW", "the first name holds the approval");
assert.equal(supplierName("Asia Tacho Kart LLC / IDEMIA"), "Asia Tacho Kart LLC");
assert.equal(supplierName("Gemalto"), "Thales");
assert.equal(
  supplierName("Imprimerie Nationale"),
  "Imprimerie Nationale",
  "not merged into IDEMIA",
);
assert.equal(supplierName("To be verified"), UNKNOWN);
assert.equal(supplierName(""), UNKNOWN);
assert.equal(supplierName("CETIS d.d."), "CETIS d.d.");
assert.ok(inG22Area("Germany") && inG22Area("Norway") && !inG22Area("Kazakhstan"));

let n = 0;
const card = (o: Partial<ReportCard>): ReportCard => ({
  id: `c${++n}`,
  device_type: "Card",
  generation: "G1",
  ...o,
});
const today = new Date("2026-11-19T00:00:00Z");

const cards: ReportCard[] = [
  // Germany: KBA (G1) -> KBA (G2.1) -> Thales (G2.2)
  card({
    country: "Germany",
    generation: "G1",
    current_manufacturer: "Kraftfahrt-Bundesamt (KBA)",
    type_approval_number: "e1-181",
    date_status: "01.06.2004",
  }),
  card({
    country: "Germany",
    generation: "G2.1",
    current_manufacturer: "Kraftfahrt-Bundesamt",
    type_approval_number: "e1-0001-00",
    date_status: "01.03.2019",
  }),
  card({
    country: "Germany",
    generation: "G2.2",
    current_manufacturer: "Thales",
    type_approval_number: "e1-00020-00",
    date_status: "14.06.2023",
    security_certificate: "ANSSI-CC-2022/38",
    certificate_expiry_date: "16.08.2027",
    latest_tender: "Award published 2022",
    winner_contractor: "Thales DIS",
    procurement_status: "Award clearly published",
  }),
  // France: Thales throughout; two G2.2 approvals, the newer one counts
  card({
    country: "France",
    generation: "G1",
    current_manufacturer: "Gemalto",
    type_approval_number: "e2-25",
    date_status: "10.05.2005",
  }),
  card({
    country: "France",
    generation: "G2.2",
    current_manufacturer: "Thales",
    type_approval_number: "e2-0040-00",
    date_status: "01.07.2023",
    security_certificate: "ANSSI-CC-2022/38",
    certificate_expiry_date: "16.08.2027",
  }),
  card({
    country: "France",
    generation: "G2.2",
    current_manufacturer: "Thales",
    type_approval_number: "e2-0040-01",
    date_status: "01.02.2026",
    security_certificate: "ANSSI-CC-2022/38-M01",
    certificate_expiry_date: "17.03.2030",
  }),
  // Hungary: in the G2.2 area, no G2.2 approval, certificate expired
  card({
    country: "Hungary",
    generation: "G2.1",
    current_manufacturer: "Hungarian Banknote Printing Co.",
    type_approval_number: "e7-0001-00",
    date_status: "01.09.2020",
    security_certificate: "ANSSI-CC-2018/11",
    certificate_expiry_date: "26.05.2026",
    latest_tender: "Not researched",
  }),
  // Kazakhstan: AETR, new G1 approval from another supplier within the year
  card({
    country: "Kazakhstan",
    generation: "G1",
    current_manufacturer: "PWPW S.A.",
    type_approval_number: "e20-0001",
    date_status: "01.01.2015",
  }),
  card({
    country: "Kazakhstan",
    generation: "G1",
    current_manufacturer: "CETIS d.d.",
    type_approval_number: "e26-23-1",
    date_status: "03.09.2026",
    security_certificate: "ANSSI-CC-2022/38",
    certificate_expiry_date: "16.08.2027",
  }),
  // one record for two countries
  card({
    country: "Bulgaria, Poland",
    generation: "G2.2",
    current_manufacturer: "PWPW S.A.",
    type_approval_number: "e5-0440-00",
    date_status: "08.06.2023",
    security_certificate: "NSCIB-CC-22-0635023",
    certificate_expiry_date: "12.12.2027",
  }),
  // undated placeholder and a vehicle unit: never part of a report
  card({
    country: "Monaco",
    generation: "Not confirmed",
    current_manufacturer: "To be verified",
    type_approval_number: "Not identified",
  }),
  card({
    country: "Germany",
    device_type: "Vehicle Unit",
    generation: "",
    current_manufacturer: "Continental",
    type_approval_number: "e1-84-10",
    date_status: "19.08.2025",
  }),
];
const listing = cards
  .filter((c) => /^e\d/.test(String(c.type_approval_number)))
  .map((c) => ({
    source_type: "card_status",
    type_approval_number: "",
    raw_type_approval: String(c.type_approval_number),
    manufacturer: "",
    device_type: String(c.device_type),
  }));
const ms = computeMarketStatus(cards as never, listing);

// ---- leaders
const leaders = generationLeaders(ms.groups);
assert.equal(
  leaders.get("France")!.get("G2.2")!.typeApproval,
  "e2-0040-01",
  "the newer approval leads",
);
assert.equal(leaders.get("Bulgaria")!.get("G2.2")!.supplier, "PWPW");
assert.equal(leaders.get("Poland")!.get("G2.2")!.supplier, "PWPW");
assert.equal(leaders.has("Monaco"), false, "no generation, no leader");

// a record without a real country belongs to no market
const stray = computeMarketStatus(
  [
    card({
      country: "unknown",
      generation: "G1",
      current_manufacturer: "X",
      type_approval_number: "e1-1",
      date_status: "01.01.2010",
    }),
  ] as never,
  [],
);
assert.equal(generationLeaders(stray.groups).size, 0);

// ---- 1. market share
const share = marketShareReport(cards, ms.groups);
assert.equal(share.countries, 6, "Monaco has no approval of a known generation");
const latest = Object.fromEntries(share.latest.rows.map((r) => [r.name, r.count]));
assert.deepEqual(latest, { Thales: 2, PWPW: 2, "CETIS d.d.": 1, "Hungarian Banknote Printing": 1 });
const g22 = share.generations.find((g) => g.generation === "G2.2")!;
assert.equal(g22.suppliers.total, 4);
assert.equal(g22.suppliers.rows[0]!.count, 2);
assert.equal(Math.round(g22.suppliers.rows[0]!.share * 100), 50);
assert.deepEqual(
  Object.fromEntries(g22.platforms.rows.map((r) => [r.name, r.count])),
  { Thales: 2, STMicroelectronics: 2 },
  "the platform comes from the security certificate",
);
const g1 = share.generations.find((g) => g.generation === "G1")!;
assert.equal(
  g1.suppliers.rows.find((r) => r.name === "Thales")!.count,
  1,
  "Gemalto counts as Thales",
);

// ---- 2. moves
const moves = movesReport(ms.groups, today);
assert.deepEqual(
  moves.recent.map((r) => [r.country, r.typeApproval, r.kind, r.previousSupplier]),
  [
    ["Kazakhstan", "e26-23-1", "switch", "PWPW"],
    ["France", "e2-0040-01", "same", "Thales"],
  ],
  "only approvals of the last 12 months, newest first; the vehicle unit is not a card",
);
assert.deepEqual(
  moves.switches.map((s) => [s.country, s.fromSupplier, s.toSupplier, s.toGeneration]),
  [["Germany", "Kraftfahrt-Bundesamt", "Thales", "G2.2"]],
);
assert.equal(moves.kept, 2, "Germany G1→G2.1 (two spellings of KBA) and France G1→G2.2");
assert.deepEqual(moves.balance, [
  { supplier: "Thales", won: 1, lost: 0, net: 1 },
  { supplier: "Kraftfahrt-Bundesamt", won: 0, lost: 1, net: -1 },
]);

// ---- 3. opportunities
const pipe = pipelineReport(cards, ms.groups, ms.byId, today);
assert.deepEqual(
  pipe.withoutG22.map((c) => [c.country, c.g22Area, c.generation]),
  [
    ["Hungary", true, "G2.1"],
    ["Kazakhstan", false, "G1"],
  ],
  "the G2.2 area first",
);
assert.deepEqual(
  pipe.expiring.map((e) => [e.country, e.bucket]),
  [
    ["Hungary", "expired"],
    ["Germany", "6-12"],
    ["Kazakhstan", "6-12"],
    ["Bulgaria, Poland", "12-18"],
  ],
  "current approvals only; France (2030) is beyond 18 months",
);
assert.deepEqual(pipe.coverage, { current: 5, withExpiry: 5 });
assert.deepEqual(
  pipe.tenders.map((t) => t.country),
  ["Germany"],
  '"not researched" is left out',
);

// ---- 4. dependencies
const deps = dependencyReport(
  cards,
  ms.byId,
  [
    {
      name: "Thales tachograph platform",
      vendor: "Thales",
      families: ["ANSSI-CC-2022/38", "ANSSI-CC-2018/11"],
    },
  ],
  today,
);
assert.equal(deps.cards, 11);
assert.equal(deps.withCertificate, 6);
const top = deps.families[0]!;
assert.equal(top.family, "ANSSI-CC-2022/38", "the maintenance version belongs to its family");
assert.equal(top.line, "Thales tachograph platform");
assert.equal(top.approvals, 4);
assert.equal(top.current, 3);
assert.deepEqual(top.countries, ["France", "Germany", "Kazakhstan"]);
assert.deepEqual(top.suppliers, ["CETIS d.d.", "Thales"]);
assert.equal(top.expiryFrom, "2027-08-16");
assert.equal(top.expiryTo, "2030-03-17");
assert.equal(top.days, 270);
const st = deps.families.find((f) => f.family === "NSCIB-CC-22-0635023")!;
assert.equal(
  st.vendor,
  "STMicroelectronics",
  "without a line the vendor comes from the certificate",
);
assert.deepEqual(st.countries, ["Bulgaria", "Poland"]);

console.log("reports: ok");
