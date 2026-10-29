// v2.74: approval certificate reader (tools/test_approval_doc.ts, run with `npx tsx`).
import assert from "node:assert/strict";
import {
  buildEnrichment,
  countryFromModelCode,
  deriveChipFromCertificate,
  parseApprovalText,
  resolveTargetCountry,
} from "../src/lib/approval-doc";

// Text of the Slovenian approval e26 23-1 (CETIS G1KZ, 08.09.2026) as pdfjs returns it.
const KZ =
  "REPUBLIKA SLOVENIJA MINISTRSTVO ZA INFRASTRUKTURO IN ENERGETIKO Direktorat za ceste in cestni promet Langusova ulica 4, 1000 Ljubljana T: 01 478 80 00 F: 01 478 81 70 E: gp.mzi@gov.si www.mzie.gov.si Številka: 371-8/2020-2430/87 Datum: 8. 9. 2026 CERTIFIKAT O HOMOLOGACIJI ZA DIGITALNE TAHOGRAFE APPROVAL CERTIFICATE FOR DIGITAL TACHOGRAPHS Naziv pristojnega upravnega organa / Name of competent administration: Republika Slovenija, Ministrstvo za infrastrukturo in energetiko Obvestilo o homologaciji / Notification concerning approval of: ☒ vozniške kartice / a driver's card  kartice servisne delavnice / a workshop card  kartice podjetja / a company card ☒ kartice nadzornika / a controller's card v zvezi z Evropskim sporazumom o delu posadk vozil, ki opravljajo mednarodni cestni prevoz (AETR) z dne 1. julija 1970, konsolidirano besedilo ECE - TRANS - SC1 - 2010, in ki izpolnjuje zahteve iz Priloge IA/IB k Uredbi Sveta (EGS) št. 3821/85 z dne 20. decembra 1985. with regard to the European agreement concerning the work of crews of vehicles engaged in international road transport (AETR) of 1 July 1970, consolidated version ECE-TRANS- SC1-2010 and that meets the requirements set out in Annex IA/IB to Council Regulation (EEC) No. 3821/85 of 20 December 1985. Homologacijska št. / Approval number: e26 23-1 1. Trgovska ali blagovna znamka / Manufacturing brand or trademark: CETIS 2. Ime vzorca / Name of model: CETIS Digital Tachograph G1KZ 3. Ime proizvajalca / Name of manufacturer: CETIS d.d. 4. Naslov proizvajalca / Address of manufacturer: 2/3 Čopova ulica 24, 3000 Celje, Slovenija 5. Predloženo v homologacijo dne / Submitted for approval on: 04. 09. 2026 6. Preskusni laboratorij / Test laboratory a. za potrdilo o funkcionalnosti / for functional certification Fime Services Netherlands B.V. b. za potrdilo o varnosti / for security certification ANSSI Agence nationale de la sécurité des systèmes d’information c. za potrdilo o interoperabilnosti / interoperability certification DT Laboratory 7. Datum in številka potrdila o / Date and number of certificate: a. funkcionalnosti / functional certificate 06. 07. 2026; 2026/02/CETIS b. varnosti / security certificate: 16. 08. 2022 ; ANSSI-CC-2022/38 c. interoperabilnosti / interoperability certificate 03. 09. 2026; JRC_DTLab/A3-183/20-189/2026 8. Datum homologacije / Date of approval: 08. 09. 2026 9. Datum odvzema homologacije / Date of withdrawal of approval: brez / not applicable 10. Vzorec zapisovalne naprave/zapisovalnih naprav, s katero(-imi) se sestavni del lahko uporablja / Model of recording equipment(s) with which the component is designed to be used: Oprema v skladu z izvedbeno uredbe komisije (EU) št. 2016/799 in 2021/1228 Vehicle unit compliant with Commission Implementing Regulation (EU) No. 2016/799 and 2021/1228 11. Kraj / Place: Ljubljana 12. Datum / Date: 08. 09. 2026 13. Priloženi opisni dokumenti / Descriptive documents annexed: 3/3  Functional Certificate 2026/02/CETIS  Agence nationale de la sécurité des systèmes d'information Security Certificate ANSSI-CC-2022/38  Interoperability Certificate JRC_DTLab/A3-183/20-189/2026 14. Pripombe (po potrebi tudi z navedbo mest pečatov) / Remarks (including the position of seals if applicable): Velja samo za vozniško kartico in kartico nadzornika. / Only driver and control cards. V Ljubljani, 08. 09. 2026 Zdravko Igličar sekretar";

const doc = parseApprovalText(KZ);
assert.equal(doc.approvalNumber, "e26 23-1");
assert.equal(doc.modelName, "CETIS Digital Tachograph G1KZ");
assert.equal(doc.manufacturer, "CETIS d.d.");
assert.equal(doc.brand, "CETIS");
assert.equal(doc.approvalDate, "08.09.2026");
assert.equal(doc.submittedOn, "04.09.2026");
assert.match(doc.authority, /Slovenija, Ministrstvo za infrastrukturo in energetiko/);
assert.deepEqual(doc.certificates.security, { date: "16.08.2022", number: "ANSSI-CC-2022/38" });
assert.deepEqual(doc.certificates.functional, { date: "06.07.2026", number: "2026/02/CETIS" });
assert.deepEqual(doc.certificates.interoperability, {
  date: "03.09.2026",
  number: "JRC_DTLab/A3-183/20-189/2026",
});
assert.equal(doc.labs.functional, "Fime Services Netherlands B.V.");
assert.match(doc.labs.security, /^ANSSI Agence nationale/);
assert.equal(doc.labs.interoperability, "DT Laboratory");
assert.match(doc.remarks, /Only driver and control cards/);

// Other languages / spellings of the keyword.
const de = parseApprovalText(
  "Sicherheitszertifikat: 18.03.2021; BSI-DSZ-CC-1124-2020 c. Interoperabilitätszertifikat 02.02.2021; JRC_DTLab/A3-1/2021",
);
assert.deepEqual(de.certificates.security, { date: "18.03.2021", number: "BSI-DSZ-CC-1124-2020" });
const fr = parseApprovalText(
  "b. certificat de sécurité : 17.03.2025 ; ANSSI-CC-2025/05 c. certificat d'interopérabilité",
);
assert.deepEqual(fr.certificates.security, { date: "17.03.2025", number: "ANSSI-CC-2025/05" });
// "security certification" is the laboratory line, not a certificate.
assert.equal(
  parseApprovalText("for security certification ANSSI c. x").certificates.security,
  null,
);

// The applicant country is not the country of the approval mark.
assert.equal(countryFromModelCode("CETIS Digital Tachograph G1KZ")?.country, "Kazakhstan");
assert.equal(countryFromModelCode("CETIS Smart Tachograph G2V2SI v2.0")?.country, "Slovenia");
assert.equal(
  countryFromModelCode("CETIS Smart Tachograph G2-BIH")?.country,
  "Bosnia and Herzegovina",
);
assert.equal(countryFromModelCode("Thales Digital Tachograph G1 v1.6 [Version 2.2.1.N]"), null);
assert.equal(countryFromModelCode("Smart Tachograph G2V2 ID card"), null);
const t = resolveTargetCountry({
  typeApproval: "e26-23-1",
  jrcCardName: "Control and driver cards from CETIS Digital Tachograph G1KZ",
});
assert.equal(t?.country, "Kazakhstan");
assert.equal(t?.issuer, "Slovenia");
assert.equal(
  resolveTargetCountry({
    typeApproval: "e1-1-1",
    jrcCardName: "Thales Digital Tachograph G1 v1.6",
  }),
  null,
);

// Chip: the platform other cards with the same certificate AND generation name.
const peers = [
  {
    generation: "G1",
    security_certificate: "ANSSI-CC-2022/38",
    chip_platform_vendor: "Thales G1 v1.6 on Infineon IFX_CCI_000039H",
    certified_security_platform: "Thales G1 platform",
    certificate_issued_date: "16.08.2022",
    certificate_expiry_date: "16.08.2027",
    country: "Türkiye",
  },
  {
    generation: "G1",
    security_certificate: "ANSSI-CC-2022/38",
    chip_platform_vendor: "Thales G1 v1.6 on Infineon IFX_CCI_000039H",
    certified_security_platform: "Thales G1 platform",
    certificate_issued_date: "16.08.2022",
    certificate_expiry_date: "16.08.2027",
    country: "Moldova",
  },
  {
    generation: "G1",
    security_certificate: "ANSSI-CC-2022/38",
    chip_platform_vendor: "CETIS G1 platform; detailed chip to verify",
    certified_security_platform: "CETIS Digital Tachograph G1GE",
    country: "Georgia",
  },
  {
    generation: "G2.2",
    security_certificate: "ANSSI-CC-2022/38",
    chip_platform_vendor: "Tachograph G2V2 on Infineon IFX_CCI_000039H",
    certified_security_platform: "G2V2",
    certificate_expiry_date: "16.08.2027",
    country: "France",
  },
  {
    generation: "G1",
    security_certificate: "BSI-DSZ-CC-0889-2013",
    chip_platform_vendor: "tru/cos",
    country: "Germany",
  },
];
const g1 = deriveChipFromCertificate(peers, "ANSSI-CC-2022/38", "G1", "Card", "16.08.2022");
assert.equal(g1?.certificate_expiry_date, "16.08.2027");
// A different issue date (a re-issue) gives no expiry — it is not guessed.
assert.equal(
  deriveChipFromCertificate(peers, "ANSSI-CC-2022/38", "G1", "Card", "17.03.2025")
    ?.certificate_expiry_date,
  "",
);
assert.equal(g1?.chip_platform_vendor, "Thales G1 v1.6 on Infineon IFX_CCI_000039H");
assert.equal(g1?.support, 2);
assert.equal(g1?.total, 2); // the "to verify" entry is not a platform name
assert.equal(
  deriveChipFromCertificate(peers, "ANSSI-CC-2022/38", "G2.2")?.chip_platform_vendor,
  "Tachograph G2V2 on Infineon IFX_CCI_000039H",
);
assert.equal(deriveChipFromCertificate(peers, "ANSSI-CC-2099/99", "G1"), null);
assert.equal(deriveChipFromCertificate(peers, "to verify", "G1"), null);

// Whole enrichment for the Kazakhstan approval.
const e = buildEnrichment({
  typeApproval: "e26-23-1",
  jrcCardName: "Control and driver cards from CETIS Digital Tachograph G1KZ",
  generation: "G1",
  doc,
  docUrl: "https://dtc.jrc.ec.europa.eu/PDF_Card/e26-23-1.pdf",
  cards: peers,
  today: "29.10.2026",
});
assert.equal(e.country, "Kazakhstan");
const byField = Object.fromEntries(e.fields.map((f) => [f.field, f.new]));
assert.equal(byField["security_certificate"], "ANSSI-CC-2022/38");
assert.equal(byField["certificate_issued_date"], "16.08.2022");
assert.equal(byField["chip_platform_vendor"], "Thales G1 v1.6 on Infineon IFX_CCI_000039H");
assert.match(byField["security_certificate_lab"], /ANSSI.*ANSSI-CC-2022\/38 \(16\.08\.2022\)/);
assert.match(
  byField["functional_certificate_lab"],
  /^Fime Services Netherlands B\.V\. — 2026\/02\/CETIS \(06\.07\.2026\)/,
);
assert.match(e.payload["Chip basis"], /Derived \(likely\)/);
assert.match(e.payload["Approval issued by"], /Slovenia/);

// No document: the country from the JRC name still comes through, nothing else is invented.
const none = buildEnrichment({
  typeApproval: "e26-23-1",
  jrcCardName: "CETIS Digital Tachograph G1KZ",
  generation: "G1",
  doc: null,
  docUrl: "",
  cards: peers,
  today: "x",
});
assert.equal(none.country, "Kazakhstan");
assert.equal(none.fields.length, 0);
console.log("approval-doc: ok");
