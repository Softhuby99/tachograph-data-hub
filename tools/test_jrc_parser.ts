// v2.77: regression tests for the JRC page parsers. Run: npx tsx tools/test_jrc_parser.ts
// The rows are copied from the live pages (shortened), one per layout that
// went wrong before.
import assert from "node:assert/strict";
import {
  classifyComponent,
  generationFromAttrs,
  parseOtherCertificates,
} from "../src/lib/jrc-sources.server";
import { jrcDateToDe, matchCard, parseJrcCardStatus, parseJrcDate } from "../src/lib/jrc.server";
import { approvalKeys } from "../src/lib/market-status";

const td = (text: string, attrs = "") => `<td class="tableCell"${attrs}>${text}</td>`;
const B = ' bgcolor="#6f9ccc"';
const C = ' bgcolor="#2323DC"';
const C2 = ' bgcolor="#ff9aff"';

const other = `
<table>
<tr><td class="cell_date">Manufacturers / Personalisers</td><td class="cell_date">Card / VU / MS / Component</td><td class="cell_date">Interoperability Certificate</td><td class="cell_date">Type approval Certificate</td><td class="cell_date">Date of approval</td><td class="cell_date">Mandatory security updates</td><td class="cell_date">Annex</td></tr>
<tr>${td("Thales")}${td("Card - Tachograph G2V2 cards for Norway")}${td("JRC DTLab/A3-156/2023")}${td('<a href="PDF_OtherCertificates/e4-0033-01.pdf">e4-0033-01</a>')}${td("19/08/2025")}${td("")}${td("", C2)}
${td("Thales")}${td("Card - Thales Digital Tachograph G2V2 [Version 2.2.1.N]")}${td("JRC DTLab/A3-156/2023")}${td("e4-0036-00")}${td("19/08/2025")}${td("")}${td("", C2)}</tr>
<tr>${td("Stoneridge Electronics AB")}${td("VU - SE5000-8.1 Rev E <br> Transitional VU")}${td("JRC_DTLab/A2-162/2023")}${td('<a href="PDF_OtherCertificates/e5-0002-11.pdf">e5-0002-11</a>')}${td("28/05/2024")}${td("YES, <a href=x>see details</a>")}${td("", C2)}${td("", C2)}</tr>
<tr>${td("Thales")}${td("Tachograph G1 v1.5 AETR cards for Moldova")}${td("JRC_DTLab/A3-152/2022")}${td("e4-AETR-0002-00")}${td("25/07/2022")}${td("", B)}</tr>
<tr>${td("Papiery Powlekane Pasaco Sp. z o.o.")}${td("Paper - Tacho Simple")}${td("N/A")}${td("e1-0009-03")}${td("19.04.2021")}${td("", C)}</tr>
<tr>${td("Tayrol Limited")}${td("Paper TACHO2b")}${td("N/A")}${td("e1-215-02")}${td("10/06/2013")}${td("", B)}</tr>
<tr>${td("Taylor Limited")}${td("TACHO2b")}${td("N/A")}${td("e1-215-03")}${td("17/08/2015")}${td("", B)}</tr>
<tr>${td("CB Electronics Sp. z o.o.")}${td("MS - DTMS-2, version V 2.0")}${td("JRC_DTLab/26-186/2026")}${td("")}${td("")}${td("")}${td("", C2)}</tr>
<tr>${td("AUMOVIO Germany GmbH")}${td("VU - MTCO 1394 Analogue Tachograph")}${td("N/A")}${td("e1-00025-00")}${td("08/10/2026")}${td("")}${td("")}</tr>
</table>
<h2>Legend</h2>
<table class="invis"><tr><td class="cell_a_1b"></td><td class="cell_invis">Annex1B</td><td class="cell_a_1c"></td><td class="cell_invis">Annex1C</td><td class="cell_a_1Cv2"></td><td class="cell_invis">AnnexICv2</td></tr></table>`;

const rows = parseOtherCertificates(other);
const by = (ta: string) => rows.find((r) => r.typeApproval === ta)!;

assert.equal(rows.length, 9, "header and legend are not entries; the glued row yields two");
// two rows in one <tr>: the first one used to be lost
assert.equal(by("e4-0033-01").kind, "Card");
assert.equal(by("e4-0033-01").name, "Tachograph G2V2 cards for Norway");
assert.equal(by("e4-0033-01").generation, "G2.2");
assert.equal(
  by("e4-0033-01").pdfUrl,
  "https://dtc.jrc.ec.europa.eu/PDF_OtherCertificates/e4-0033-01.pdf",
);
assert.equal(by("e4-0036-00").generation, "G2.2");
assert.equal(by("e4-0036-00").mandatoryUpdates, "");
// two annex cells: columns used to shift by one
const se = by("e5-0002-11");
assert.equal(se.manufacturer, "Stoneridge Electronics AB");
assert.equal(se.kind, "VU");
assert.equal(se.interopCertificate, "JRC_DTLab/A2-162/2023");
assert.equal(se.date, "28/05/2024");
assert.equal(se.mandatoryUpdates, "YES, see details");
assert.equal(se.generation, "G2.2");
// a card row without the "Card - " prefix
assert.equal(by("e4-AETR-0002-00").kind, "Card");
assert.equal(by("e4-AETR-0002-00").generation, "G1");
// paper in three spellings
assert.equal(by("e1-0009-03").kind, "Paper");
assert.equal(by("e1-215-02").kind, "Paper");
assert.equal(by("e1-215-03").kind, "Paper", "an extension inherits the kind of its approval");
// interoperability certificate without a type approval yet
const ms = rows.find((r) => r.name.startsWith("DTMS-2"))!;
assert.equal(ms.kind, "MS");
assert.equal(ms.typeApproval, "");
assert.equal(ms.generation, "G2.2");
// no annex colour (analogue tachograph)
assert.equal(by("e1-00025-00").kind, "VU");
assert.equal(by("e1-00025-00").generation, "");

assert.equal(classifyComponent("DSRC Module R08 (Upgrade)"), "DSRC");
assert.equal(classifyComponent("M1N1-Adapter Generation 2"), "M1N1");
assert.equal(classifyComponent("Blumberg DT 001(Paper)"), "Paper");
assert.equal(classifyComponent("EFAS-4 DU"), "Other");

assert.equal(generationFromAttrs(' class="tableCell" bgcolor="#2323DC"'), "G2.1");
assert.equal(generationFromAttrs(" bgcolor=#6f9ccc"), "G1");
assert.equal(generationFromAttrs(' style="background-color:#ff9aff"'), "G2.2");
assert.equal(generationFromAttrs(' class="cell_a_1Cv2"'), "G2.2");
assert.equal(generationFromAttrs(' class="tableCell"'), "");

// dates
assert.ok(parseJrcDate("19.04.2021") > 0);
assert.equal(parseJrcDate("19.04.2021"), parseJrcDate("19/04/2021"));
assert.equal(parseJrcDate("YES, see details"), 0);
assert.equal(jrcDateToDe("03/09/2026"), "03.09.2026");
assert.equal(jrcDateToDe("19.04.2021"), "19.04.2021");
assert.equal(jrcDateToDe("n/a"), "");

// card status page
const cs = `<table><tr>${td("CETIS d.d.")}${td("Control and driver cards from CETIS Digital Tachograph G1KZ")}${td("JRC_DTLab/A3-183/20-189/2026")}${td("03/09/2026")}${td("03/03/2027")}${td('<a href="PDF_Card/e26-23-1.pdf">e26-23-1</a>')}${td("x")}${td("", B)}</tr></table>`;
const [kz] = parseJrcCardStatus(cs);
assert.equal(kz!.typeApproval, "e26-23-1");
assert.equal(kz!.generation, "G1");
assert.equal(kz!.pdfUrl, "https://dtc.jrc.ec.europa.eu/PDF_Card/e26-23-1.pdf");

// matching: a short approval text must be equal, not contained
const card = (id: string, ta: string) => ({
  id,
  country: "X",
  generation: "G1",
  type_approval_number: ta,
  current_manufacturer: "",
  tachograph_application_os: "",
  jrc_interoperability_status: "",
  jrc_certificate_source: "",
});
const pool = [card("a", "e5-0001-00"), card("b", "0001"), card("c", "e9_02")];
const row = (typeApproval: string) => ({ typeApproval, generation: "G1" }) as never;
assert.equal(matchCard(row("0001"), pool)?.id, "b", '"0001" is not part of e5-0001-00');
assert.equal(matchCard(row("e5-0001-00"), pool)?.id, "a");
assert.equal(matchCard(row("e9_]02"), pool)?.id, "c", "a stray bracket is a typing slip");
assert.equal(approvalKeys("e9_]02").length, 1);

console.log("jrc-parser: ok");
