"""
Common Criteria Portal -> Tachograph-Zertifikate mit Sicherheitszertifikats-
nummer und Generation (G1 / G2.1 / G2.2).

Vorgehen
--------
1. https://www.commoncriteriaportal.org/products/index.cfm liefert ALLE
   Kategorien in EINEM serverseitig gerenderten HTML (~8 MB), kein JS/Paging.
   Jede Kategorie ist eine <table id="tblXX"> mit den Spalten
   Product | Vendor | ProductCertificate | Date CertificateIssued |
   CertificateValidityExpirationDate | Compliance | Scheme
   Tachograph-Eintraege liegen in tblIC (Karten/ICs) und tblOD (VU, Sensoren).

2. Die Spalte "ProductCertificate" enthaelt NUR den Linktext "CCRA Certificate",
   keine Nummer. Die echte Nummer steht im verlinkten Zertifikats-PDF
   ("ANSSI-CC-2022/38-R01", "EUCC-ANSSI-2025-03-02", "Certificate number
   CC-22-0635023" (NSCIB), "BSI-DSZ-CC-1158-V4-2025", ...). Das Skript laedt
   das PDF und liest die Nummer per pdftotext heraus -> keine Rateraetsel.

3. Generation wird ueber das Protection Profile bestimmt, gegen das zertifiziert
   wurde (steht sowohl im Portal als auch im Zertifikat):
     BSI-CC-PP-0070  Digital Tachograph - Smart Card (Tachograph Card), 2011
                     = Anhang 1B                       -> G1
     BSI-CC-PP-0091  Digital Tachograph - Tachograph Card (TC PP), 2017
                     = Anhang 1C                       -> G2 (G2.1)
     BSI-CC-PP-0093  Motion Sensor      -> keine Karte
     BSI-CC-PP-0094  Vehicle Unit       -> keine Karte
   G2.2 (Anhang 1C i.d.F. VO (EU) 2021/1228) hat fuer Karten KEIN eigenes PP.
   Ein G2.2-Nachweis stuetzt sich daher auf die ausdrueckliche Nennung von
   "G2V2" in Produktname / Security Target / Zertifikat - genau das prueft das
   Skript, statt es aus dem PP zu unterstellen.

Voraussetzungen: pip install requests beautifulsoup4   +   poppler-utils (pdftotext)
"""
import csv
import os
import re
import subprocess
import sys
import urllib.parse
from datetime import datetime

import requests
from bs4 import BeautifulSoup

URL = "https://www.commoncriteriaportal.org/products/index.cfm"
URL_ARCHIVED = "https://www.commoncriteriaportal.org/products/index.cfm?archived=1"
BASE = "https://www.commoncriteriaportal.org"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; TachoCertMonitor/1.0)"}
PDF_DIR = "cc_certs"

# Reihenfolge wichtig: laengstes Praefix zuerst, sonst matcht "CC-..." zu frueh.
CERT_ID = re.compile(
    r"((?:EUCC-ANSSI|ANSSI-CC|NSCIB-CC|BSI-DSZ-CC)-[0-9A-Za-z/_.\-]{3,40})"
)
# NSCIB/TUEV-NL schreibt "Certificate number CC-22-0635023"
NSCIB_ID = re.compile(r"Certificate number\s+(CC-\d{2}-\d{5,9})", re.I)

# Aus dem Dateinamen ableitbare Nummern - nur als Fallback, wenn das
# Zertifikats-PDF fehlt (aeltere Eintraege haben oft nur einen Report) oder
# reine Bildscans ohne Textebene liefert. Die Quelle wird mitgeschrieben.
FILENAME_RULES = [
    (re.compile(r"ANSSI[-_]CC[-_](\d{4})[-_](\d{2,3})(?:[-_]?([SMR]\d{2}))?", re.I),
     lambda m: f"ANSSI-CC-{m.group(1)}/{m.group(2)}" + (f"-{m.group(3).upper()}" if m.group(3) else "")),
    (re.compile(r"NSCIB[- ]?(?:certificate )?[-_]?CC[-_ ]?(\d{2})[-_](\d{5,6})", re.I),
     lambda m: f"NSCIB-CC-{m.group(1)}-{m.group(2)}"),
    (re.compile(r"NSCIB[- ]?(?:certificate )?[-_ ]?(\d{2})-(\d{6})", re.I),
     lambda m: f"NSCIB-CC-{m.group(1)}-{m.group(2)}"),
    (re.compile(r"NSCIB[-_]CC[-_](\d{6,8})(?:[-_](\d{2}))?(?=[-_.]|$)", re.I),
     lambda m: f"NSCIB-CC-{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) and m.group(2) != "CR" else "")),
    (re.compile(r"\bCC-(\d{2})-(\d{6})\b", re.I),
     lambda m: f"NSCIB-CC-{m.group(1)}-{m.group(2)}"),
    (re.compile(r"^(\d{4})(V\d)?[a-c](?:_pdf)?\.pdf$", re.I),
     lambda m: f"BSI-DSZ-CC-{m.group(1)}" + (f"-{m.group(2).upper()}" if m.group(2) else "")),
    (re.compile(r"^(\d{4})_(\d{2})[a-z]{2}\.pdf$", re.I),
     lambda m: f"ANSSI-CC-{m.group(1)}/{m.group(2)}"),
    (re.compile(r"^(\d{4})-(\d{2})-(?:INF|CCRA)", re.I),
     lambda m: f"OC-{m.group(1)}-{m.group(2)} (ES)"),
    (re.compile(r"\bCRP(\d{3})\b", re.I), lambda m: f"CRP{m.group(1)} (UK)"),
]

PP_GEN = {"PP-0070": "G1", "PP-0091": "G2.1"}
NON_CARD_PP = {"PP-0093": "Motion Sensor", "PP-0094": "Vehicle Unit", "PP-0057": "Vehicle Unit"}


def clean_name(raw: str) -> str:
    text = re.sub(r"\s+", " ", raw).strip()
    for marker in ("Certification Report", "Security Target", "Protection Profile"):
        idx = text.find(marker)
        if idx != -1:
            text = text[:idx]
    return text.strip(" -")


def pdf_text(path: str) -> str:
    try:
        out = subprocess.run(["pdftotext", path, "-"], capture_output=True, text=True, timeout=90)
        return re.sub(r"[ \t]+", " ", out.stdout)
    except Exception:
        return ""


def from_filename(*filenames) -> str:
    for fn in filenames:
        if not fn:
            continue
        fn = os.path.basename(urllib.parse.unquote(fn))
        for pattern, build in FILENAME_RULES:
            m = pattern.search(fn)
            if m:
                return build(m)
    return ""


def cert_number(txt: str, product: str, *filenames):
    """-> (Nummer, Quelle). Zertifikatstext schlaegt Dateiname."""
    m = NSCIB_ID.search(txt)
    if m:
        return "NSCIB-" + m.group(1), "Zertifikat"      # Schreibweise des NL-Schemas
    m = CERT_ID.search(txt)
    if m:
        return m.group(1).rstrip(".,;"), "Zertifikat"
    m = CERT_ID.search(product)
    if m:
        return m.group(1).rstrip(".,;"), "Produktname"
    guess = from_filename(*filenames)
    if guess:
        return guess, "Dateiname"
    return "", ""


def generations(pp_refs, product: str, cert_txt: str, issued: str = "") -> str:
    gens = {PP_GEN[pp] for pp in pp_refs if pp in PP_GEN}
    haystack = (product + " " + cert_txt).upper().replace(" ", "")
    if "G2V2" in haystack:
        gens.add("G2.2")
    if not gens:
        for pp in pp_refs:
            if pp in NON_CARD_PP:
                return f"keine Karte ({NON_CARD_PP[pp]})"
        # Anhang 1C (G2) gilt erst ab 15.06.2019; aeltere Karten sind
        # zwangslaeufig Anhang 1B = G1. Als Ableitung gekennzeichnet.
        if issued and issued[:4].isdigit() and int(issued[:4]) < 2018:
            return "G1 (aus Datum abgeleitet, kein PP im Zertifikat)"
    return ", ".join(sorted(gens)) if gens else "unbestimmt"


def scrape(page_url, status):
    resp = requests.get(page_url, headers=HEADERS, timeout=120)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    for table in soup.find_all("table", id=re.compile(r"^tbl")):
        for tr in table.select("tbody tr"):
            tds = tr.find_all("td")
            if len(tds) < 7:
                continue
            product_raw = tds[0].get_text(" ", strip=True)
            if "tachograph" not in product_raw.lower():
                continue

            product = clean_name(product_raw)
            pp_portal = sorted(
                {
                    "PP-" + m
                    for a in tds[0].find_all("a", href=re.compile("ppfiles"))
                    for m in re.findall(r"pp(\d{4})", a["href"])
                }
            )
            cert_a = tds[2].find("a", href=True)
            report_a = tds[0].find("a", href=re.compile("epfiles"))
            cert_txt = ""       # fuer PP-Erkennung (Zertifikat + ggf. Report)
            cert_own_txt = ""   # nur der Text des Zertifikats selbst
            for a in (cert_a, report_a):
                if not a:
                    continue
                local = os.path.join(PDF_DIR, os.path.basename(urllib.parse.unquote(a["href"])))
                if not os.path.exists(local):
                    try:
                        pdf = requests.get(
                            BASE + urllib.parse.quote(urllib.parse.unquote(a["href"]), safe="/:"),
                            headers=HEADERS, timeout=120,
                        )
                        if pdf.status_code == 200 and pdf.content[:4] == b"%PDF":
                            open(local, "wb").write(pdf.content)
                    except requests.exceptions.RequestException:
                        pass
                if os.path.exists(local):
                    t = pdf_text(local)
                    cert_txt += "\n" + t
                    if a is cert_a:
                        cert_own_txt = t
                if a is cert_a and cert_txt.strip():
                    break            # Zertifikat reicht, Report nur als Rueckfall
            # Nummer nur aus dem Zertifikat selbst; der Report-Text nennt
            # regelmaessig FREMDE Zertifikate (z. B. das des Chips) und wuerde
            # falsch zugeordnet. Ohne Zertifikats-PDF entscheidet der Dateiname.
            number, number_src = cert_number(
                cert_own_txt, product,
                cert_a["href"] if cert_a else "", report_a["href"] if report_a else "",
            )
            # Dateiname liefert die Nummer ohne Jahres-Suffix. Der Kopf des
            # Reports traegt die vollstaendige Form; nur uebernehmen, wenn die
            # laufende Nummer uebereinstimmt (sonst waere es ein Fremdzertifikat).
            if number_src == "Dateiname" and number.startswith("BSI-DSZ-CC-"):
                head = cert_txt[:400]
                m = re.search(re.escape(number) + r"(-V\d)?-(\d{4})", head)
                if m:
                    number, number_src = number + (m.group(1) or "") + "-" + m.group(2), "Report-Kopf"

            # Das Zertifikat selbst ist massgeblich: die PP-Links des Portals
            # sind nachweislich unvollstaendig (z. B. ANSSI-CC-2022/36v2-R01,
            # dort fehlt PP-0091, stattdessen ist die VU-PP-0057 verlinkt).
            pp_cert = sorted({f"PP-{m}" for m in re.findall(r"PP-(\d{4})", cert_txt)})
            pp_refs = pp_cert or pp_portal

            results.append(
                {
                    "security_certificate_no": number or "(nicht ermittelbar)",
                    "number_source": number_src or "-",
                    "generation": generations(pp_refs, product, cert_txt, tds[3].get_text(strip=True)),
                    "product": product,
                    "vendor": tds[1].get_text(" ", strip=True),
                    "date_issued": tds[3].get_text(strip=True),
                    "validity_expiration": tds[4].get_text(strip=True),
                    "protection_profiles": " + ".join(pp_refs),
                    "pp_source": "Zertifikat" if pp_cert else "Portal-Link",
                    "pp_portal_listed": " + ".join(pp_portal),
                    "compliance": re.sub(r"\s+", " ", tds[5].get_text(" ", strip=True)),
                    "scheme": tds[6].get_text(" ", strip=True),
                    "category": table.get("id"),
                    "status": status,
                }
            )
    return results


def main():
    os.makedirs(PDF_DIR, exist_ok=True)
    results = scrape(URL, "gueltig")
    results += scrape(URL_ARCHIVED, "archiviert")

    if not results:
        print("Keine Tachograph-Eintraege gefunden.")
        return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = f"cc_tachograph_certificates_{ts}.csv"
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader()
        w.writerows(results)

    cards = [r for r in results if not r["generation"].startswith("keine Karte")]
    print(f"{len(results)} Eintraege ({len(cards)} Karten) -> {out}\n")
    for r in sorted(cards, key=lambda x: x["date_issued"], reverse=True):
        print(
            f"{r['status']:11} | {r['security_certificate_no']:26} | {r['generation']:14} | "
            f"{r['date_issued']} - {r['validity_expiration']} | {r['product'][:46]}"
        )


if __name__ == "__main__":
    main()
