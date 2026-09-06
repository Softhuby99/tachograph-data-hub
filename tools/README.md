# Tachograph Cards Info – Generator & Checker Tools

Python-Skripte zur Pflege der Länder-Referenzliste und zum Abgleich des
Datensatzes.  Keine der Skripte läuft zur Laufzeit in der Anwendung;
sie werden vorab ausgeführt, und das Ergebnis wird als Datei abgelegt.

## Übersicht

| Skript                       | Zweck                                             |
|------------------------------|---------------------------------------------------|
| `jrc_country_resolver.py`    | Lädt beide JRC-Seiten, liest TA-PDFs, ermittelt Land + Konfidenz. Ausgabe: CSV. |
| `gen_ta_country.py`          | Erzeugt `src/lib/ta-country.ts` aus der CSV.      |
| `check_dataset.py`           | Gleicht die Kartentabelle (JSON-Export) gegen die CSV ab. |
| `cc_tachograph.py`            | Scrapt das Common Criteria Portal, ermittelt Zertifikatsnummer + Generation. |
| `extract_ta.py`              | Zuordnung TA ↔ CC-Zertifikat ↔ Generation/Land aus TA-PDFs. |
| `ocr_run.py`                 | OCR für gescannte Bescheide (tesseract + pdftoppm). |

## Daten

`data/laender_alle.csv` – 397 Typgenehmigungen mit Land, Konfidenz, Belegtext,
Genehmigungsbehörde und PDF-Link.  Erzeugt von `jrc_country_resolver.py --all`.

## npm-Skripte

```bash
# src/lib/ta-country.ts aus der CSV neu erzeugen:
bun run gen:ta-country

# Datensatz gegen die Referenz prüfen (braucht JSON-Export der Kartentabelle):
bun run check:dataset
```

## Workflow

1. `jrc_country_resolver.py --all -o data/laender_alle.csv` (braucht Netz + poppler)
2. `python3 gen_ta_country.py` → erneuert `src/lib/ta-country.ts`
3. Kartentabelle als JSON exportieren → `check_dataset.py --dataset cards.json`

## Voraussetzungen

- Python 3.10+
- `requests`, `beautifulsoup4` (für cc_tachograph.py, jrc_country_resolver.py)
- `poppler-utils` (`pdftotext`, `pdftoppm`) für PDFs
- `tesseract-ocr` (+ `-deu`, `-fra`, `-eng`) für gescannte Bescheide

Der Generator (`gen_ta_country.py`) und der Checker (`check_dataset.py`)
brauchen NUR die Python-Standardbibliothek – kein Netz, keine Abhängigkeiten.
