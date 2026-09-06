#!/usr/bin/env python3
"""
check_dataset – gleicht die Kartentabelle (als JSON-Export) gegen die
Länder-Referenzliste (tools/data/laender_alle.csv) ab.

Der Prüflauf braucht keine Datenbankverbindung.  Stattdessen wird die
Kartentabelle vorab als JSON exportiert und übergeben:

    # Export (z. B. aus der Datenbank oder der Supabase API):
    #   psql -c "COPY (SELECT row_to_json(t) FROM tachograph_cards t) TO STDOUT" > cards.json
    # oder:
    #   curl "$SUPABASE_URL/rest/v1/tachograph_cards?select=*" -H "apikey: $KEY" > cards.json

    python3 tools/check_dataset.py --dataset cards.json
    python3 tools/check_dataset.py --dataset cards.json --csv tools/data/laender_alle.csv
    python3 tools/check_dataset.py --dataset cards.json --report report.json

Was geprüft wird
  1. Land-Widerspruch:  stored country  !=  documented country  (confidence=belegt)
  2. Land nicht belegt:  TA hat nur eine "Annahme" (prefix), keine "belegt"
  3. TA fehlt in Referenzliste

Der Bericht ist maschinenlesbar (JSON) und kann im Build als Gate verwendet
werden, sobald die Offline-Daten daraus neu erzeugt sind.

Voraussetzungen: nur Python-Standardbibliothek.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "tools" / "data" / "laender_alle.csv"


def norm_ta(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def load_reference(csv_path: Path) -> dict[str, dict]:
    """Returns norm_ta -> {country, documented (bool), evidence, basis}."""
    table: dict[str, dict] = {}
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ta = (row.get("type_approval") or "").strip()
            if not ta:
                continue
            table[norm_ta(ta)] = {
                "country": (row.get("country") or "").strip(),
                "documented": (row.get("confidence") or "").strip().lower() in ("belegt", "documented", "1"),
                "evidence": (row.get("evidence") or "").strip(),
                "basis": (row.get("source") or "").strip(),
                "authority": (row.get("issuer_authority") or "").strip(),
                "ta": ta,
            }
    return table


def load_dataset(json_path: Path) -> list[dict]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    # Accept either a bare array or {data: [...]} (Supabase REST shape).
    if isinstance(data, dict):
        for key in ("data", "rows", "results"):
            if key in data and isinstance(data[key], list):
                return data[key]
    if isinstance(data, list):
        return data
    raise ValueError(f"Unexpected JSON shape in {json_path}")


def main():
    ap = argparse.ArgumentParser(description="Check the card dataset against the country reference list.")
    ap.add_argument("--dataset", required=True, help="JSON export of tachograph_cards (array or {data:[...]})")
    ap.add_argument("--csv", default=str(DEFAULT_CSV), help="Path to laender_alle.csv")
    ap.add_argument("--report", default="", help="Write a JSON report to this path")
    ap.add_argument("--strict", action="store_true", help="Exit non-zero if any conflict is found")
    args = ap.parse_args()

    ref = load_reference(Path(args.csv))
    cards = load_dataset(Path(args.dataset))

    conflicts: list[dict] = []
    not_documented: list[dict] = []
    not_in_ref: list[str] = []
    checked = 0

    for card in cards:
        ta = str(card.get("type_approval_number") or "").strip()
        stored = str(card.get("country") or "").strip()
        if not ta or ta.lower().startswith("not identified"):
            continue
        checked += 1
        key = norm_ta(ta)
        hit = ref.get(key)
        if not hit:
            not_in_ref.append(ta)
            continue
        if not hit["documented"]:
            not_documented.append({
                "ta": ta,
                "stored": stored,
                "reference_country": hit["country"],
                "authority": hit["authority"],
                "evidence": hit["evidence"],
            })
            continue
        if not stored:
            continue
        listed = [c.strip().lower() for c in hit["country"].split(",")]
        if stored.lower() not in listed:
            conflicts.append({
                "ta": ta,
                "stored": stored,
                "documented": hit["country"],
                "evidence": hit["evidence"],
                "basis": hit["basis"],
            })

    report = {
        "checked": checked,
        "conflicts": conflicts,
        "not_documented": not_documented,
        "not_in_reference": not_in_ref,
    }

    print(f"Checked: {checked}")
    print(f"Conflicts (documented country differs): {len(conflicts)}")
    print(f"Not documented (prefix only):           {len(not_documented)}")
    print(f"Not in reference list:                   {len(not_in_ref)}")

    for c in conflicts:
        print(f"  CONFLICT  {c['ta']}: stored={c['stored']} documented={c['documented']} ({c['evidence'][:80]})")

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nReport written to {args.report}")

    if args.strict and (conflicts or not_documented):
        sys.exit(1)


if __name__ == "__main__":
    main()
