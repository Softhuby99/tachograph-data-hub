import assert from "node:assert/strict";
import { buildPlatformTimeline, type TimelineCardInput } from "../src/lib/platform-timeline";
const card: TimelineCardInput = {
  id: "spain",
  country: "Spain",
  device_type: "Card",
  security_certificate: "CC-22-0635025",
  current_manufacturer: "Different approval holder",
  date_status: "19.06.2023",
  generation: "G2.2",
  type_approval_number: "e9-0007-00",
};
const [known] = buildPlatformTimeline([card], []);
assert.equal(known.vendor, "STMicroelectronics");
assert.equal(known.assigned, false);
const [unknown] = buildPlatformTimeline(
  [{ ...card, security_certificate: "ANSSI-CC-2099/99", current_manufacturer: "Thales" }],
  [],
);
assert.equal(unknown.vendor, "");
const [assigned] = buildPlatformTimeline(
  [card],
  [
    {
      id: "st",
      name: "ST platform",
      vendor: "Maintained provider",
      families: [known.families[0].family],
      patterns: [],
      note: "",
      sort: 0,
    },
  ],
);
assert.equal(assigned.vendor, "Maintained provider");
assert.equal(assigned.assigned, true);
console.log(
  "Certificate provider fallback: known, unknown and maintained assignment checks passed.",
);
