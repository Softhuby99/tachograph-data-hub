// v2.84: one name per card supplier — shared by Market Analytics and Reports,
// so both count the same companies.

export const UNKNOWN = "Not known";

const str = (v: unknown) => String(v ?? "").trim();

// The manufacturer field is free text: "AKD", "AKD d.o.o." and "Agencija za
// komercijalnu djelatnost d.o.o (AKD)" are one company. Counted as written,
// they split a supplier's share and turn a renewal into a "supplier change".
// Only spellings of the same company are grouped — no mergers, no parents.

const SUPPLIER_GROUPS: [RegExp, string][] = [
  [/thales|gemalto/i, "Thales"],
  [/idemia|oberthur|morpho/i, "IDEMIA"],
  [/imprimerie nationale|\bin groupe\b/i, "Imprimerie Nationale"],
  [/\bakd\b|agencija za komercijalnu/i, "AKD"],
  [/pwpw|polska wytw/i, "PWPW"],
  [/austria card/i, "Austria Card"],
  [/giesecke|g\s*[+&]\s*d\b/i, "Giesecke+Devrient"],
  [/kraftfahrt-bundesamt|\bkba\b/i, "Kraftfahrt-Bundesamt"],
  [/cardplus/i, "CardPlus"],
  [/fnmt|real casa de la moneda/i, "FNMT-RCM"],
  [/security printing and systems/i, "Security Printing and Systems"],
  [/\btobb\b|union of chambers/i, "TOBB"],
  [/lodvila/i, "Lodvila"],
  [/hungarian banknote/i, "Hungarian Banknote Printing"],
  [/st[áa]tn[íi] tisk[áa]rna cenin/i, "Státní tiskárna cenin"],
];
const SUPPLIER_PLACEHOLDER =
  /^$|to be verified|not publicly documented|not identified|not confirmed|unknown|^[-–—]+$/i;

/** One name per company; UNKNOWN for placeholders. */
export function supplierName(raw: unknown): string {
  // "PWPW S.A. / DEMAX": the first name is the approval holder.
  const first = str(raw).split(/\s+\/\s+/)[0] ?? "";
  if (SUPPLIER_PLACEHOLDER.test(first)) return UNKNOWN;
  for (const [re, name] of SUPPLIER_GROUPS) if (re.test(first)) return name;
  return first;
}
