import assert from "node:assert/strict";
import { buildPlatformTrends } from "../src/lib/platform-trends";
import type { TimelineApproval, TimelineLine } from "../src/lib/platform-timeline";
const approval = (patch: Partial<TimelineApproval> = {}): TimelineApproval => ({
  cardId: "a",
  country: "Austria",
  countries: ["Austria"],
  date: new Date("2020-01-01"),
  generation: "G2.1",
  typeApproval: "e1-0015-00",
  manufacturer: "Thales",
  certText: "",
  cert: null,
  certLabel: "",
  family: "f",
  status: "current",
  derived: false,
  switchedFrom: "",
  ...patch,
});
const line = (all: TimelineApproval[], vendor = "Thales"): TimelineLine => ({
  key: vendor,
  name: vendor,
  vendor,
  note: "",
  assigned: true,
  families: [],
  derived: [],
  all,
  countries: 1,
  firstYear: 2020,
  lastYear: 2022,
});
const m = buildPlatformTrends([
  line([
    approval(),
    approval({ cardId: "revision", typeApproval: "e1-0015-01", date: new Date("2021-01-01") }),
    approval({
      cardId: "extension",
      country: "Austria; Greece",
      countries: ["Austria", "Greece"],
      typeApproval: "e1-0015-02",
      date: new Date("2022-01-01"),
    }),
    approval({
      cardId: "partner",
      country: "Germany",
      countries: ["Germany"],
      manufacturer: "Austria Card",
    }),
    approval({ cardId: "missing", date: null }),
    approval({ cardId: "ambiguous", typeApproval: "e1-15-00; e2-16-00" }),
    approval({ cardId: "inferred", derived: true }),
  ]),
  line([approval({ cardId: "other", manufacturer: "Independent Labs" })], "Independent Labs"),
]);
assert.deepEqual(m.vendors, ["Independent Labs", "Thales"]);
assert.equal(m.excluded, 3);
assert.equal(m.rows[0]["new1-in-house"], 1);
assert.equal(m.rows[0]["new1-partner"], 1);
assert.equal(m.rows[1]["new1-in-house"], 0);
assert.equal(m.rows[2]["new1-in-house"], 1);
assert.equal(m.rows[2].total1, 3);
assert.equal(m.rows[2].coverage1, 3);
assert.equal(m.rows[0].total0, 1);
const b = buildPlatformTrends([
  line([approval({ country: "Bosnia and Herzegovina", countries: ["Bosnia", "Herzegovina"] })]),
]);
assert.equal(b.rows[0].coverage0, 1);
const sameCountry = buildPlatformTrends([
  line([
    approval(),
    approval({
      cardId: "g22",
      generation: "G2.2",
      date: new Date("2022-01-01"),
      status: "delisted",
    }),
  ]),
]);
assert.equal(sameCountry.rows[2].coverage0, 1);
assert.equal(sameCountry.rows[2].total0, 2);
assert.deepEqual(buildPlatformTrends([]).vendors, []);
console.log(
  "Platform trends: revision, multi-country, partner, arbitrary vendor, exclusions, historical status and coverage checks passed.",
);
