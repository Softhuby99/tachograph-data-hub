#!/usr/bin/env python3
"""
gen_ta_country – erzeugt src/lib/ta-country.ts aus der CSV-Datei
tools/data/laender_alle.csv (Ausgabe von jrc_country_resolver.py --all).

Die CSV-Spalten:
  type_approval, country, source, confidence, evidence, generation,
  item, ta_pdf, issuer_prefix, issuer_authority, issuer_country,
  issuer_check, issuer_expected, issuer_table_source, issuer_note,
  issuer_authority_raw

Die TypeScript-Datei ist ein eingefrorener Schnappschuss, der mit diesem
Skript erneuerbar ist.  Aufruf:

    python3 tools/gen_ta_country.py                  # Default-CSV
    python3 tools/gen_ta_country.py --csv other.csv   # andere CSV
    python3 tools/gen_ta_country.py -o src/lib/ta-country.ts

Voraussetzungen: nur Python-Standardbibliothek (csv, json, re).
"""
from __future__ import annotations

import argparse
import csv
import subprocess
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "tools" / "data" / "laender_alle.csv"
DEFAULT_OUT = ROOT / "src" / "lib" / "ta-country.ts"

HEADER = """// Generated from the JRC country resolver (jrc_country_resolver.py) run over both
// JRC pages. Maps a type approval number to the issuing/target country, together
// with how that country was determined. "documented" comes from the type approval
// PDF or the JRC card name, "assumed" is derived from the eNN issuer prefix only.
// Never used to overwrite stored card data - only to enrich JRC update proposals
// and to cross-check the dataset.

export type TaCountryEntry = {
  ta: string;
  country: string;
  confidence: "documented" | "assumed";
  basis: string;
  evidence: string;
  generation: string;
  authority: string;
  authorityCountry: string;
  pdf: string;
};

export function normTa(value: string): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

"""

FOOTER = r"""
/** True when the stored country contradicts a documented resolution. */
export function countryConflict(typeApproval: string, storedCountry: string) {
  const hit = resolveTaCountry(typeApproval);
  if (!hit || hit.confidence !== "documented") return null;
  const stored = (storedCountry ?? "").trim().toLowerCase();
  if (!stored) return null;
  const listed = hit.country.toLowerCase().split(",").map((s) => s.trim());
  return listed.includes(stored) ? null : hit;
}

/** Only documented resolutions (JRC card name, type approval PDF) may fill a
 * country field. Prefix-derived ("assumed") hits never do — the eNN prefix
 * names the issuing authority, not the card's country. */
export function documentedCountry(typeApproval: string): TaCountryEntry | null {
  const hit = resolveTaCountry(typeApproval);
  return hit && hit.confidence === "documented" ? hit : null;
}

/** Issuer prefix, e.g. "e1" from "e1-0004-00". */
export function taPrefix(typeApproval: string): string {
  const m = /^(e\d{1,2})/i.exec((typeApproval ?? "").trim());
  return m ? m[1]!.toLowerCase() : "";
}

/** Prefixes whose issuing-authority mapping is uncertain (kept, but flagged). */
const UNSAFE_PREFIXES = new Set(["e31", "e42", "e51", "e54", "e55", "e56", "e58"]);

export function prefixUnsafe(typeApproval: string): boolean {
  return UNSAFE_PREFIXES.has(taPrefix(typeApproval));
}

/** "Typgenehmigung erteilt von: <authority> (eNN)". The authority issued the
 * approval; it is NOT evidence for the card's country. */
export function approvalAuthorityLabel(typeApproval: string): string {
  const hit = resolveTaCountry(typeApproval);
  const prefix = taPrefix(typeApproval);
  const auth =
    hit?.authority?.trim() ||
    (hit?.authorityCountry ? `Authority of ${hit.authorityCountry}` : "");
  const suffix = prefix ? ` (${prefix}${prefixUnsafe(typeApproval) ? ", mapping uncertain" : ""})` : "";
  if (auth) return `${auth}${suffix}`;
  return prefix ? prefix : "";
}

// Company / vendor phrases that must be stripped from a JRC card name before
// country matching — "Austria Card", "IDEMIA The Netherlands", "Thales DIS …"
// etc. are manufacturers, not countries.
const COMPANY_NOISE = [
  "austria card", "idemia", "thales", "imprimerie nationale", "bundesdruckerei",
  "trüb ag", "trueb ag", "trüb", "polska wytwórnia", "pwpw", "certsign",
  "gemalto", "oberthur", "morpho", "sagemcom", "giesecke", "g&d",
  "national bank of", "the netherlands", "netherlands bv", "b.v.",
];

// Word-boundary alias -> canonical country. Covers the EU/AETR scope of the
// JRC type approval list.
const COUNTRY_ALIASES: [string, string][] = [
  ["germany", "Germany"], ["deutschland", "Germany"],
  ["france", "France"], ["frankreich", "France"],
  ["poland", "Poland"], ["polen", "Poland"],
  ["netherlands", "Netherlands"], ["niederlande", "Netherlands"],
  ["italy", "Italy"], ["italien", "Italy"],
  ["spain", "Spain"], ["spanien", "Spain"],
  ["austria", "Austria"], ["österreich", "Austria"], ["oesterreich", "Austria"],
  ["belgium", "Belgium"], ["belgien", "Belgium"],
  ["bulgaria", "Bulgaria"], ["bulgarien", "Bulgaria"],
  ["croatia", "Croatia"], ["kroatien", "Croatia"],
  ["cyprus", "Cyprus"], ["zypern", "Cyprus"],
  ["czechia", "Czechia"], ["czech republic", "Czechia"], ["tschechien", "Czechia"],
  ["denmark", "Denmark"], ["dänemark", "Denmark"], ["daenemark", "Denmark"],
  ["estonia", "Estonia"], ["estland", "Estonia"],
  ["finland", "Finland"], ["finnland", "Finland"],
  ["greece", "Greece"], ["griechenland", "Greece"],
  ["hungary", "Hungary"], ["ungarn", "Hungary"],
  ["iceland", "Iceland"], ["island", "Iceland"],
  ["ireland", "Ireland"], ["irland", "Ireland"],
  ["latvia", "Latvia"], ["lettland", "Latvia"],
  ["liechtenstein", "Liechtenstein"],
  ["lithuania", "Lithuania"], ["litauen", "Lithuania"],
  ["luxembourg", "Luxembourg"], ["luxemburg", "Luxembourg"],
  ["malta", "Malta"],
  ["norway", "Norway"], ["norwegen", "Norway"],
  ["portugal", "Portugal"],
  ["romania", "Romania"], ["rumänien", "Romania"], ["rumaenien", "Romania"],
  ["slovakia", "Slovakia"], ["slowakei", "Slovakia"],
  ["slovenia", "Slovenia"], ["slowenien", "Slovenia"],
  ["sweden", "Sweden"], ["schweden", "Sweden"],
  ["switzerland", "Switzerland"], ["schweiz", "Switzerland"],
  ["united kingdom", "United Kingdom"], ["great britain", "United Kingdom"],
  ["turkey", "Türkiye"], ["türkiye", "Türkiye"], ["turkiye", "Türkiye"],
  ["serbia", "Serbia"], ["serbien", "Serbia"],
  ["ukraine", "Ukraine"],
  ["moldova", "Moldova"], ["moldau", "Moldova"],
  ["georgia", "Georgia"], ["georgien", "Georgia"],
  ["armenia", "Armenia"], ["armenien", "Armenia"],
  ["azerbaijan", "Azerbaijan"], ["aserbaidschan", "Azerbaijan"],
  ["kazakhstan", "Kazakhstan"], ["kasachstan", "Kazakhstan"],
  ["russia", "Russia"], ["russland", "Russia"],
  ["belarus", "Belarus"], ["weißrussland", "Belarus"],
  ["kyrgyzstan", "Kyrgyzstan"], ["kirgisistan", "Kyrgyzstan"],
  ["israel", "Israel"],
  ["bosnia", "Bosnia and Herzegovina"], ["bosnien", "Bosnia and Herzegovina"],
  ["albania", "Albania"], ["albanien", "Albania"],
  ["north macedonia", "North Macedonia"], ["macedonia", "North Macedonia"], ["mazedonien", "North Macedonia"],
  ["andorra", "Andorra"],
  ["san marino", "San Marino"],
  ["monaco", "Monaco"],
  ["montenegro", "Montenegro"],
  ["kosovo", "Kosovo"],
  ["uzbekistan", "Uzbekistan"], ["usbekistan", "Uzbekistan"],
  ["turkmenistan", "Turkmenistan"],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolves a country from a JRC card name: company phrases are removed first,
 * then country names are matched on word boundaries.
 *
 * A card name may legitimately name several countries ("PWPW Poland and
 * Bulgaria Tacho G2v2 cards", "PWPW GE and AZ Tach G1 Cards"). Those are
 * returned as a comma-separated list instead of being discarded — letting the
 * user pick one at approval time beats offering no resolution at all.
 */
export function resolveFromCardName(cardName: string): TaCountryEntry | null {
  let text = ` ${(cardName ?? "").toLowerCase()} `;
  for (const noise of COMPANY_NOISE) {
    text = text.split(noise).join(" ");
  }
  const found = new Set<string>();
  for (const [alias, country] of COUNTRY_ALIASES) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text)) found.add(country);
  }
  if (found.size === 0) return null;
  const country = [...found].sort().join(", ");
  return {
    ta: "",
    country,
    confidence: "documented",
    basis: "JRC-Kartenname",
    evidence: (cardName ?? "").slice(0, 160),
    generation: "",
    authority: "",
    authorityCountry: "",
    pdf: "",
  };
}
"""

RESOLVER_FUNC = """
export const TA_COUNTRY: Record<string, TaCountryEntry> = """

RESOLVER_LOOKUP = """
/** Resolves a type approval number (accepts "a / b" combinations). */
export function resolveTaCountry(typeApproval: string): TaCountryEntry | null {
  for (const part of (typeApproval ?? "").split(/[/;]/)) {
    const hit = TA_COUNTRY[normTa(part)];
    if (hit) return hit;
  }
  return null;
}
"""


def norm_ta(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def confidence_map(raw: str) -> str:
    return "documented" if raw.strip().lower() in ("belegt", "documented", "1") else "assumed"


def esc(s: str) -> str:
    """JSON-style string escaping for TS."""
    return json.dumps(s or "", ensure_ascii=False)


def run_prettier(path: Path) -> bool:
    """Format the generated file like the rest of the repo. Returns False when
    prettier is unavailable (the file is still valid, just differently spaced)."""
    for cmd in (["npx", "--no-install", "prettier", "--write", str(path)],
                ["node_modules/.bin/prettier", "--write", str(path)]):
        try:
            res = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, timeout=180)
            if res.returncode == 0:
                return True
        except (OSError, subprocess.SubprocessError):
            continue
    return False


def main():
    ap = argparse.ArgumentParser(description="Generate src/lib/ta-country.ts from the CSV snapshot.")
    ap.add_argument("--csv", default=str(DEFAULT_CSV), help="Path to laender_alle.csv (default: tools/data/laender_alle.csv)")
    ap.add_argument("-o", "--out", default=str(DEFAULT_OUT), help="Output .ts file (default: src/lib/ta-country.ts)")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    out_path = Path(args.out)

    if not csv_path.exists():
        print(f"ERROR: CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    entries: list[tuple[str, dict]] = []
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ta = (row.get("type_approval") or "").strip()
            if not ta:
                continue
            key = norm_ta(ta)
            entry = {
                "ta": ta,
                "country": (row.get("country") or "").strip(),
                "confidence": confidence_map(row.get("confidence", "")),
                "basis": (row.get("source") or "").strip(),
                "evidence": (row.get("evidence") or "").strip(),
                "generation": (row.get("generation") or "").strip(),
                "authority": (row.get("issuer_authority") or "").strip(),
                # issuer_prefix is the country derived from the number, not evidence
                #  about the authority - never use it as a fallback here.
                "authorityCountry": (row.get("issuer_country") or "").strip(),
                "pdf": (row.get("ta_pdf") or "").strip(),
            }
            entries.append((key, entry))

    # Deduplicate: last entry wins (CSV may list composite keys like "e1-00020-00 e5-0440-00")
    table: dict[str, dict] = {}
    for key, entry in entries:
        table[key] = entry

    lines: list[str] = []
    lines.append(HEADER)
    lines.append(RESOLVER_FUNC)
    lines.append("{")
    for key in sorted(table):
        e = table[key]
        lines.append(f'"{key}": {{')
        lines.append(f'  "authority": {esc(e["authority"])},')
        lines.append(f'  "authorityCountry": {esc(e["authorityCountry"])},')
        lines.append(f'  "basis": {esc(e["basis"])},')
        lines.append(f'  "confidence": {esc(e["confidence"])},')
        lines.append(f'  "country": {esc(e["country"])},')
        lines.append(f'  "evidence": {esc(e["evidence"])},')
        lines.append(f'  "generation": {esc(e["generation"])},')
        lines.append(f'  "pdf": {esc(e["pdf"])},')
        lines.append(f'  "ta": {esc(e["ta"])}')
        lines.append("},")
    lines.append("} as Record<string, TaCountryEntry>;")
    lines.append("")
    lines.append(RESOLVER_LOOKUP)
    lines.append(FOOTER)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")

    # The checked-in file is prettier-formatted. Without this step every run
    # would produce a ~9000 line diff and nobody would dare execute it.
    formatted = run_prettier(out_path)
    print(
        f"Generated {len(table)} entries -> {out_path}"
        + ("" if formatted else "  (prettier not run - format the file before committing)")
    )


if __name__ == "__main__":
    main()
