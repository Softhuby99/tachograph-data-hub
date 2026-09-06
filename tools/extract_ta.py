"""Zuordnung: JRC Type Approval  <->  CC-Sicherheitszertifikat  <->  Generation/Land.

Quellen
  JRC  https://dtc.jrc.ec.europa.eu/dtc_card_status.php.html         (Spalte "Type Approval")
       https://dtc.jrc.ec.europa.eu/dtc_other_certificates.php.html  (Spalte "Type approval Certificate")
       Generation kommt aus der Hintergrundfarbe der Annex-Spalte:
       #6f9ccc = Anhang 1B = G1, #2323dc = Anhang 1C = G2.1, #ff9aff = Anhang 1C v2 = G2.2
  TA-PDF  je Zeile verlinkt; enthaelt unter Punkt 7 ("Dates et numeros" / "Dates and numbers")
       das Sicherheitszertifikat und unter Punkt 1/2 Marke und Modellname, in denen das
       Zielland steht ("... pour l'Armenie", "National Bank of Serbia", ...).
"""
import json, os, re, subprocess

PDF_DIR = "ta_pdfs"

# Punkt 1 und 2 des EU-Formulars, mehrsprachig. Wert steht hinter dem Label
# oder - vor allem in den deutschen Bescheiden - in der Folgezeile.
LABELS = {
    1: r"(?:Manufacturing (?:brand )?or (?:commercial )?(?:mark|trademark)|Marque de fabrique ou marque(?: commerciale)?|Hersteller- oder Handelsmarke|Fabrik- oder Handelsmarke|Marca de fabricaci[oó]n|Marchio)",
    2: r"(?:Name of (?:the )?model|Nom du mod[eè]le|Modellbezeichnung|Name des Musters|Nombre del modelo|Nome del modello)",
}

CC_PAT = re.compile(r"((?:EUCC-ANSSI|ANSSI-CC|NSCIB-CC|BSI-DSZ-CC)[-\s]?[0-9A-Za-z/_.\-]{3,30})", re.I)
CC_NSCIB_SHORT = re.compile(r"\bCC[-\s](\d{2})[-\s](\d{5,7})\b")

# Zielland aus Marke/Modell - Bezeichnungen in den Sprachen der Bescheide.
COUNTRIES = {
    "Armenia": ["arménie", "armenie", "armenia", "armenien"],
    "Austria": ["autriche", "austria", "österreich"],
    "Belgium": ["belgique", "belgium", "belgien"],
    "Bulgaria": ["bulgarie", "bulgaria", "bulgarien"],
    "Croatia": ["croatie", "croatia", "kroatien", "hrvatsk"],
    "Cyprus": ["chypre", "cyprus", "zypern"],
    "Czechia": ["tchèque", "tcheque", "czech", "tschech"],
    "Denmark": ["danemark", "denmark", "dänemark"],
    "Estonia": ["estonie", "estonia", "estland"],
    "Finland": ["finlande", "finland", "finnland"],
    "France": ["france", "frankreich"],
    "Georgia": ["géorgie", "georgie", "georgia", "georgien"],
    "Germany": ["allemagne", "germany", "deutschland"],
    "Greece": ["grèce", "grece", "greece", "griechenland"],
    "Hungary": ["hongrie", "hungary", "ungarn"],
    "Iceland": ["islande", "iceland", "island"],
    "Ireland": ["irlande", "ireland", "irland"],
    "Italy": ["italie", "italy", "italien"],
    "Kazakhstan": ["kazakhstan", "kasachstan"],
    "Latvia": ["lettonie", "latvia", "lettland"],
    "Lithuania": ["lituanie", "lithuania", "litauen"],
    "Luxembourg": ["luxembourg", "luxemburg"],
    "Malta": ["malte", "malta"],
    "Moldova": ["moldavie", "moldova", "moldau"],
    "Netherlands": ["pays-bas", "netherlands", "niederlande"],
    "North Macedonia": ["macédoine", "macedoine", "macedonia", "mazedonien"],
    "Norway": ["norvège", "norvege", "norway", "norwegen"],
    "Poland": ["pologne", "poland", "polen", "polsk"],
    "Portugal": ["portugal"],
    "Romania": ["roumanie", "romania", "rumänien", "român"],
    "Serbia": ["serbie", "serbia", "serbien", "srbij"],
    "Slovakia": ["slovaquie", "slovakia", "slowakei", "slovensk"],
    "Slovenia": ["slovénie", "slovenie", "slovenia", "slowenien"],
    "Spain": ["espagne", "spain", "spanien", "españa"],
    "Sweden": ["suède", "suede", "sweden", "schweden"],
    "Switzerland": ["suisse", "switzerland", "schweiz"],
    "Tajikistan": ["tadjikistan", "tajikistan", "tadschikistan"],
    "Türkiye": ["turquie", "türkiye", "turkiye", "turkey", "türkei"],
    "Ukraine": ["ukraine"],
    "United Kingdom": ["royaume-uni", "united kingdom", "vereinigtes königreich"],
    "Uzbekistan": ["ouzbékistan", "uzbekistan", "usbekistan"],
}

# eNN-Praefix der Homologationsnummer = ausstellendes Land (UNECE).
E_PREFIX = {
    "1": "Germany", "2": "France", "3": "Italy", "4": "Netherlands", "5": "Sweden",
    "6": "Belgium", "7": "Hungary", "8": "Czechia", "9": "Spain", "10": "Serbia",
    "11": "United Kingdom", "12": "Austria", "13": "Luxembourg", "14": "Switzerland",
    "16": "Norway", "17": "Finland", "18": "Denmark", "19": "Romania", "20": "Poland",
    "21": "Portugal", "23": "Greece", "24": "Ireland", "25": "Croatia", "26": "Slovenia",
    "27": "Slovakia", "28": "Belarus", "29": "Estonia", "31": "Bosnia and Herzegovina",
    "32": "Latvia", "34": "Bulgaria", "36": "Lithuania", "37": "Türkiye", "39": "Azerbaijan",
    "40": "North Macedonia", "46": "Ukraine", "49": "Cyprus", "50": "Malta", "56": "Montenegro",
}


def pdf_text(path):
    try:
        return re.sub(r"[ \t]+", " ",
                      subprocess.run(["pdftotext", "-layout", path, "-"],
                                     capture_output=True, text=True, timeout=90).stdout)
    except Exception:
        return ""


def field(text, num):
    """Punkt 1/2 des Formulars; Wert steht hinter dem Label oder darunter."""
    m = re.search(rf"{LABELS[num]}\s*:?\s*(.*)", text, re.I)
    if not m:
        m = re.search(rf"^\s*{num}\s*[.)]\s*(.{{5,240}})$", text, re.M)
        return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
    value = re.sub(r"\s+", " ", m.group(1)).strip(" :.")
    if len(value) < 3:                      # Label allein -> Folgezeilen nehmen
        other = LABELS[2 if num == 1 else 1]
        for line in text[m.end():].splitlines()[:4]:
            line = re.sub(r"\s+", " ", line).strip()
            if len(line) <= 2 or re.match(r"^\d+\s*[.)]", line):
                continue
            if re.search(other, line, re.I) or re.search(LABELS[num], line, re.I):
                continue                      # naechstes Formularlabel, kein Wert
            value = line.strip(" :.")
            break
    return value


def normalise_cc(v: str) -> str:
    """OCR-/Schreibvarianten auf die amtliche Form bringen."""
    v = v.upper().strip().rstrip(".,;)-")
    v = re.sub(r"^NSCIB-CC-(\d{6,8})-CR\d*$", r"NSCIB-CC-\1", v)
    v = re.sub(r"^(ANSSI-CC-\d{4})[-\s](\d{2})\b", r"\1/\2", v)      # 2018-11 -> 2018/11
    v = re.sub(r"^(ANSSI-CC-\d{4})[01]?(\d{2})$", r"\1/\2", v)          # 2022138 -> 2022/38 (OCR)
    v = re.sub(r"^(NSCIB-CC-\d{6,8})-C[R]?-?\d{1,2}-\d{1,2}-\d{4}$", r"\1", v)
    v = re.sub(r"^(ANSSI-CC-\d{4}/\d{2})_?\d*[A-Z]{2}$", r"\1", v)      # ..._21FR
    v = re.sub(r"^(EUCC-ANSSI-\d{4})[-/](\d{2})[-_](\d{2})$", r"\1-\2-\3", v)
    return v


def base_cc(v: str) -> str:
    """Ohne Revisions-Suffix (-R01, -S02, -M01, -MA-01), fuer Dubletten."""
    return re.sub(r"-(?:R|S|M|MA[-_])\d{1,2}$", "", v)


def cc_numbers(text):
    found = []
    for m in CC_PAT.finditer(text):
        found.append(normalise_cc(re.sub(r"\s+", "-", m.group(1))))
    for m in CC_NSCIB_SHORT.finditer(text):
        found.append(f"NSCIB-CC-{m.group(1)}-{m.group(2)}")
    # Pro Basisnummer die spezifischste Variante behalten (mit Revision).
    best = {}
    for v in found:
        if len(v) < 12:
            continue
        b = base_cc(v)
        if b not in best or len(v) > len(best[b]):
            best[b] = v
    return sorted(best.values())


def country_of(*texts):
    hay = " ".join(texts).lower()
    for name, variants in COUNTRIES.items():
        if any(v in hay for v in variants):
            return name, "Marke/Modell"
    return "", ""


def issuing_country(ta_number):
    m = re.match(r"e(\d{1,2})", ta_number.strip(), re.I)
    return E_PREFIX.get(m.group(1), "") if m else ""


def main():
    rows = json.load(open("jrc_rows.json"))
    out = []
    for r in rows:
        text = pdf_text(os.path.join(PDF_DIR, os.path.basename(r["pdf"]))) if r["pdf"] else ""
        mark, model = (field(text, 1), field(text, 2)) if text else ("", "")
        country, src = country_of(mark, model, r["item"])
        if not country:
            country, src = issuing_country(r["type_approval"]), "Ausstellerland (eNN)"
        out.append({
            "type_approval": r["type_approval"],
            "generation": r["generation"],
            "security_certificate_no": "; ".join(cc_numbers(text)),
            "country": country,
            "country_source": src if country else "",
            "manufacturing_mark": mark,
            "name_of_model": model,
            "jrc_manufacturer": r["manufacturer"],
            "jrc_item": r["item"],
            "jrc_date": r["date"],
            "jrc_source": r["source"],
            "ta_pdf": r["pdf"],
            "pdf_has_text": "ja" if len(text.strip()) > 200 else "nein (Scan)",
        })
    json.dump(out, open("ta_mapping.json", "w"), indent=1)
    print(f"{len(out)} Zeilen, davon {sum(1 for o in out if o['security_certificate_no'])} mit Sicherheitszertifikat")


if __name__ == "__main__":
    main()
