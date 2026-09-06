#!/usr/bin/env python3
"""
jrc_country_resolver - ermittelt zu JRC-Tachographen-Eintraegen das Land.

Warum das noetig ist
--------------------
Die JRC-Seiten nennen Hersteller, Kartennamen und Typgenehmigungsnummer, aber
kein Feld "Land". Das Zielland steht - wenn ueberhaupt - im Kartennamen
("DT cards for Andorra", "PWPW PL Tach G2 Cards") oder im Typgenehmigungs-PDF
unter Punkt 1/2 des EU-Formulars ("Marque de fabrique", "Nom du modele",
"Modellbezeichnung"). Sonst bleibt nur das Ausstellerland aus dem eNN-Praefix -
und das ist eine ANNAHME, keine Angabe: eine deutsche Genehmigung (e1) kann
Karten fuer Litauen oder fuer einen AETR-Staat betreffen.

Deshalb liefert dieses Skript nie nur einen Landesnamen, sondern immer auch
Quelle und Konfidenz. Freigaben sollten sich auf confidence="belegt" stuetzen.

Aufrufe
-------
    # Einzelne Typgenehmigung
    python3 jrc_country_resolver.py --ta e2_33

    # Mehrere, mit Kartenname als zusaetzlichem Hinweis
    python3 jrc_country_resolver.py --ta e2-36 --item "AL Digital Tachograph Cards, Albania"

    # Aus der Update-Liste des Tools (Text so einfuegen, wie er in der UI steht)
    pbpaste | python3 jrc_country_resolver.py --stdin
    python3 jrc_country_resolver.py --stdin < vorschlaege.txt

    # Beide JRC-Seiten komplett auswerten -> CSV
    python3 jrc_country_resolver.py --all -o laender.csv

Optionen
--------
    --no-pdf     TA-PDFs nicht laden (nur Kartenname + eNN-Praefix)
    --no-ocr     gescannte PDFs nicht per OCR auswerten
    --cache DIR  Ablage fuer PDFs/OCR-Text (Default: .jrc_cache)

Voraussetzungen: requests; pdftotext (poppler-utils) fuer PDFs;
optional tesseract-ocr (+ -deu/-fra) fuer gescannte Bescheide.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from dataclasses import dataclass, asdict

import requests

JRC_BASE = "https://dtc.jrc.ec.europa.eu/"
JRC_PAGES = {
    "card_status": JRC_BASE + "dtc_card_status.php.html",
    "other_certificates": JRC_BASE + "dtc_other_certificates.php.html",
}
HEADERS = {"User-Agent": "TachographCardsInfoTool/1.0"}

# Annex-Farbcodes der JRC-Tabellen -> Generation
ANNEX_COLOR = {"6f9ccc": "G1", "2323dc": "G2.1", "ff9aff": "G2.2"}

# ---------------------------------------------------------------------------
# eNN/ENN -> Land + benannte Typgenehmigungsbehoerde
#
# Grundlage ist die offizielle Liste der EU-Mitgliedstaaten und
# AETR-Vertragsstaaten (kleines "e" = EU-Typgenehmigung nach VO (EU) 2018/858 /
# 2020/683 Anhang IV, grosses "E" = UN-ECE/AETR).
#
# Vierter Wert: die im JRC-Bescheid tatsaechlich zeichnende Stelle, wenn sie von
# der benannten Behoerde ABWEICHT. Das ist kein Fehler der Liste - fuer
# Fahrtenschreiberkarten zeichnet in einigen Staaten die Metrologie- statt der
# Fahrzeugbehoerde (Polen: Glowny Urzad Miar statt TDT, Slowenien: Ministerium
# statt AVP, Russland: Verkehrsministerium statt Rosstandart).
#
# quelle: "Liste"    = offizielle EU/AETR-Liste
#         "Bescheid" = zusaetzlich durch den Briefkopf echter JRC-Bescheide belegt
#         "unsicher" = Liste und gaengige UNECE-Uebersichten widersprechen sich
#                      und es liegt kein Bescheid vor
# ---------------------------------------------------------------------------
APPROVAL_AUTHORITY: dict[str, tuple[str, str, str, str]] = {
    # Nr:   (Land,                    benannte Behoerde,                                        Quelle,      abweichende Stelle im Bescheid)
    "1":  ("Germany",        "KBA - Kraftfahrt-Bundesamt",                                      "Bescheid", ""),
    "2":  ("France",         "Préfet du Nord / CNRV / DREAL",                                   "Bescheid", "Ministère de l'économie et des finances (DGE) - Préfecture du Nord"),
    "3":  ("Italy",          "MIT - Ministero delle Infrastrutture e dei Trasporti",                  "Bescheid", ""),
    "4":  ("Netherlands",    "RDW - Rijksdienst voor het Wegverkeer",                           "Bescheid", ""),
    "5":  ("Sweden",         "Transportstyrelsen - Swedish Transport Agency",                   "Bescheid", ""),
    "6":  ("Belgium",        "FPS Mobility and Transport",                       "Liste",    ""),
    "7":  ("Hungary",        "KTI - Közlekedéstudományi Kutatóintézet",                           "Liste",    ""),
    "8":  ("Czechia",        "Ministerstvo dopravy",                                            "Bescheid", ""),
    "9":  ("Spain",          "MINCOTUR - Ministerio de Industria y Turismo",                    "Bescheid", ""),
    "10": ("Serbia",         "ABS - Agencija za bezbednost saobraćaja (Road Traffic Safety Agency)",  "Bescheid", ""),
    "11": ("United Kingdom", "VCA - Vehicle Certification Agency",                              "Liste",    ""),
    "12": ("Austria",        "BMK - Bundesministerium für Klimaschutz",                                         "Liste",    ""),
    "13": ("Luxembourg",     "SNCH - Société Nationale de Certification et d'Homologation",     "Bescheid", ""),
    "14": ("Switzerland",    "ASTRA - Bundesamt für Strassen",                                  "Liste",    ""),
    "16": ("Norway",         "Statens vegvesen",                                                "Liste",    ""),
    "17": ("Finland",        "Traficom",                                                        "Liste",    ""),
    "18": ("Denmark",        "Færdselsstyrelsen",                                               "Liste",    ""),
    "19": ("Romania",        "RAR - Registrul Auto Român",                                      "Bescheid", ""),
    "20": ("Poland",         "TDT - Transportowy Dozór Techniczny",                             "Bescheid", "GUM - Główny Urząd Miar"),
    "21": ("Portugal",       "IMT - Instituto da Mobilidade e dos Transportes",                 "Bescheid", ""),
    "22": ("Russia",         "Rosstandart",                                                     "Bescheid", "Ministry of Transport - Agency of Automobile Transport"),
    "23": ("Greece",         "Ministry of Infrastructure and Transport",                        "Liste",    ""),
    "24": ("Ireland",        "NSAI - National Standards Authority of Ireland",                  "Liste",    ""),
    "25": ("Croatia",        "DZM - Državni zavod za mjeriteljstvo",                            "Bescheid", ""),
    "26": ("Slovenia",       "AVP - Javna agencija RS za varnost prometa",                      "Bescheid", "Ministrstvo za infrastrukturo"),
    "27": ("Slovakia",       "Ministerstvo dopravy Slovenskej republiky",                       "Liste",    ""),
    "28": ("Belarus",        "Gosstandart",                                                     "Bescheid", "Ministry of Transport and Communications"),
    "29": ("Estonia",        "Transpordiamet",                                                  "Liste",    ""),
    "31": ("Moldova",        "Ministry of Infrastructure and Regional Development",             "unsicher", "andere Uebersichten fuehren E31 als Bosnien und Herzegowina"),
    "32": ("Latvia",         "CSDD - Ceļu satiksmes drošības direkcija",                        "Liste",    ""),
    "34": ("Bulgaria",       "Executive Agency Road Transport Administration",                  "Liste",    ""),
    "36": ("Lithuania",      "LTSA - Lietuvos transporto saugos administracija",                "Liste",    ""),
    "37": ("Türkiye",        "Sanayi ve Teknoloji Bakanlığı",                                   "Bescheid", ""),
    "39": ("Azerbaijan",     "State Service for Automotive Transport",                          "Liste",    ""),
    "40": ("North Macedonia","Ministry of Economy",                                             "Liste",    ""),
    "42": ("Belgium",        "FPS Mobility and Transport",                                      "unsicher", "gaengige UNECE-Uebersichten fuehren E42 als Europaeische Union, nicht als Belgien"),
    "46": ("Ukraine",        "Ministry of Infrastructure of Ukraine",                           "Liste",    ""),
    "49": ("Cyprus",         "Department of Road Transport",                                    "Liste",    ""),
    "50": ("Malta",          "Transport Malta",                                                 "Liste",    ""),
    "51": ("Kazakhstan",     "Ministry of Transport",                                           "unsicher", "andere Uebersichten fuehren E51 als Republik Korea"),
    "54": ("Andorra",        "Ministry of Economy",                                             "unsicher", "andere Uebersichten fuehren E54 als Albanien"),
    "55": ("Albania",        "General Directorate of Road Transport Services",                  "unsicher", "andere Uebersichten fuehren E55 als Montenegro"),
    "56": ("Montenegro",     "Ministry of Transport and Maritime Affairs",                      "unsicher", "andere Uebersichten fuehren E56 als Moldau"),
    "57": ("San Marino",     "Segreteria di Stato per i Trasporti",                             "Liste",    ""),
    "58": ("Georgia",        "Ministry of Economy and Sustainable Development",                 "unsicher", "andere Uebersichten fuehren E58 als Tunesien"),
    "60": ("Armenia",        "Ministry of Territorial Administration and Infrastructure",       "Liste",    ""),
    # Nicht in der Liste enthalten, aber durch die Bescheide selbst belegt:
    "68": ("Kyrgyzstan",     "Ministry of Transport and Communication of the Kyrgyz Republic",  "Bescheid", "in der offiziellen Liste nicht gefuehrt"),
    "69": ("Israel",         "MOT - Ministry of Transport and Road Safety",                     "Bescheid", "in der offiziellen Liste nicht gefuehrt"),
}

E_PREFIX = {k: v[0] for k, v in APPROVAL_AUTHORITY.items()}


def prefix_info(type_approval: str):
    """-> (Land, benannte Behoerde, Quelle, Abweichung im Bescheid)."""
    m = re.match(r"\s*e(\d{1,2})(?![0-9])", type_approval.strip(), re.I)
    return APPROVAL_AUTHORITY.get(m.group(1), ("", "", "", "")) if m else ("", "", "", "")


# Erkennungsmuster fuer die nationalen Typgenehmigungsstellen, gewonnen aus den
# Briefkoepfen echter Bescheide. Damit laesst sich das eNN-Praefix gegenpruefen,
# statt ihm blind zu vertrauen (so kamen e68=Kirgisistan und e69=Israel heraus,
# die in gaengigen Listen anders oder gar nicht gefuehrt werden).
AUTHORITIES = [
    ("Germany",         r"kraftfahrt-?bundesamt|\bKBA\b|DE-24932 Flensburg"),
    ("France",          r"minist[eè]re de l.[ée]conomie|direction r[ée]gionale de l|DREETS|DIRECCTE|"
                        r"direction g[ée]n[ée]rale des entreprises|pr[ée]fecture du nord|\bPR[ÉE]FET\b"),
    ("Italy",           r"ministero delle infrastrutture|mit\.aoo_pit|provvedimenti interni|motorizzazione|"
                        r"strumenti di misura"),
    ("Netherlands",     r"\bRDW\b|division vehicle regulation"),
    ("Sweden",          r"transportstyrelsen|transport\s*styrelsen|swedish transport agency|\bTSV\s*20"),
    ("Belgium",         r"service public f[ée]d[ée]ral mobilit|FOD Mobiliteit"),
    ("Hungary",         r"nemzeti közlekedési|közlekedési hatóság|innovációs és technológiai|"
                        r"ministry for innovation and technology|ministry for innovation and"),
    ("Czechia",         r"[čc]esk[áa] republika|ministerstvo dopravy"),
    ("Spain",           r"direcci[oó]n general de industria|ministerio de industria|minetur"),
    ("Serbia",          r"republic of serbia|republika srbija|road traffic safety agency"),
    ("United Kingdom",  r"department for transport|\bDVSA\b|vehicle certification agency"),
    ("Austria",         r"bundesministerium f[üu]r (klimaschutz|verkehr)"),
    ("Luxembourg",      r"soci[ée]t[ée] nationale de certification|\bSNCH\b"),
    ("Switzerland",     r"bundesamt f[üu]r strassen|\bASTRA\b|\bOFROU\b"),
    ("Norway",          r"statens vegvesen"),
    ("Finland",         r"traficom"),
    ("Denmark",         r"f[æa]rdselsstyrelsen|trafikstyrelsen"),
    ("Romania",         r"registrul auto rom[âa]n|\bRAR\b"),
    # OCR macht aus "Główny Urząd Miar" gern "Glöwny Urzad Miar" - Umlaut-Varianten zulassen.
    ("Poland",          r"g[łl][oöó]wny\s+urz[ąa]d\s+miar|[śs]wiadectwo homologacji|transportowy doz[óo]r techniczny"),
    ("Portugal",        r"instituto da mobilidade e dos transportes"),
    ("Russia",          r"ministry of transport of the russian|agency of automobile transport"),
    ("Ireland",         r"road safety authority"),
    ("Croatia",         r"republika hrvatska|republic of croatia|dr[žz]avni zavod za mjeriteljstvo|"
                        r"state of.ce for metrology"),
    ("Slovenia",        r"republika slovenija|ministrstvo za infrastrukturo"),
    ("Slovakia",        r"slovensk[áa] republika"),
    ("Belarus",         r"republic of belarus"),
    ("Estonia",         r"transpordiamet|maanteeamet"),
    ("Latvia",          r"\bCSDD\b|ce[ļl]u satiksmes"),
    ("Lithuania",       r"lietuvos transporto|\bLTSA\b"),
    ("Türkiye",         r"sanayi ve teknoloji bakanl|ministry of industry and technology"),
    ("Cyprus",          r"republic of cyprus"),
    ("Malta",           r"transport malta"),
    ("Kyrgyzstan",      r"кыргыз|кьпч|кь1ргь13|kyrgyz|бишкек"),
    ("Israel",          r"\bISRAEL\b|ministry of transport and road safety"),
    ("Kazakhstan",      r"kazakhstan|қазақстан"),
]

COMPETENT_AUTHORITY = re.compile(
    r"(?:Name of (?:the )?competent (?:authority|administration)|"
    r"Nom de l'administration comp[ée]tente|Bezeichnung der zust[äa]ndigen Beh[öo]rde|"
    r"Name der zust[äa]ndigen Beh[öo]rde|Nazwa w[łl]a[śs]ciwej jednostki)\s*:?\s*(.{3,140})", re.I)


# Werte, die zwar hinter dem Formularlabel stehen, aber keine Behoerde benennen:
# Anschriften, Postleitzahlen und Formularfloskeln.
NOT_AN_AUTHORITY = re.compile(
    r"^\d|^[A-Z]{1,2}-?\d{4,5}\b|\b\d{5}\b|^(?:rue|ul\.|str\.|via|calle)\b|"
    r"notification concerning|communication|comunica[çc]|mitteilung|approval certificate",
    re.I)


# Formulartitel und Registraturstempel, die hinter bzw. vor dem Behoerdennamen
# stehen und nicht zu ihm gehoeren.
AUTHORITY_CUT = re.compile(
    r"\b(?:TYPGENEHMIGUNGSBOGEN|APPROVAL CERTIFICATE|TYPE APPROVAL|CERTIFICAT|CERTIFICADO|"
    r"CERTIFIKAT|ŚWIADECTWO|Tip ONAY|Beslut|Notification|Communication|Mitteilung|"
    r"in Bezug auf|with regard to|Nr\.|No:)", re.I)


# Fuer die Landeserkennung taugen auch Anschriften und Registraturnummern
# ("DE-24932 Flensburg", "Provvedimenti interni"). Als NAME der Stelle taugen
# sie nicht - dafuer wird hier gezielt der Institutionsname gesucht.
AUTHORITY_NAME_HINT = {
    "Germany":     r"kraftfahrt-?bundesamt",
    "Italy":       r"ministero delle infrastrutture[^.]{0,60}|direzione generale[^.]{0,60}",
    "Netherlands": r"RDW[^.]{0,60}",
    "Poland":      r"g[łl][óo]wny urz[ąa]d miar",
    "Romania":     r"registrul auto rom[âa]n[^,]{0,20}",
    "Spain":       r"direcci[oó]n general de industria[^.]{0,50}",
    "Belarus":     r"ministry of transport and communications[^.]{0,40}",
}


# Der Rohtext aus dem Briefkopf traegt Anschriften, Seitenzahlen und
# OCR-Splitter mit ("Kraftfahrt-Bundesamt 2 DE-24932 Flensburg"). Fuer die
# Auswertung wird daraus der einheitliche Name der Stelle gesetzt; der Rohtext
# bleibt in issuer_authority_raw erhalten.
CANONICAL_AUTHORITY = {
    "Germany":        "KBA - Kraftfahrt-Bundesamt",
    "France":         "DGE / Préfecture du Nord - Ministère de l'économie et des finances",
    "Italy":          "MIT - Ministero delle Infrastrutture e dei Trasporti",
    "Netherlands":    "RDW - Rijksdienst voor het Wegverkeer",
    "Sweden":         "Transportstyrelsen - Swedish Transport Agency",
    "Czechia":        "Ministerstvo dopravy",
    "Spain":          "MINCOTUR - Ministerio de Industria y Turismo",
    "Serbia":         "ABS - Agencija za bezbednost saobraćaja (Road Traffic Safety Agency)",
    "Luxembourg":     "SNCH - Société Nationale de Certification et d'Homologation",
    "Romania":        "RAR - Registrul Auto Român",
    "Poland":         "GUM - Główny Urząd Miar",
    "Portugal":       "IMT - Instituto da Mobilidade e dos Transportes",
    "Russia":         "Ministry of Transport - Agency of Automobile Transport",
    "Croatia":        "DZM - Državni zavod za mjeriteljstvo",
    "Slovenia":       "Ministrstvo za infrastrukturo",
    "Belarus":        "Ministry of Transport and Communications",
    "Türkiye":        "Sanayi ve Teknoloji Bakanlığı - D.G. for Metrology",
    "Kyrgyzstan":     "Ministry of Transport and Communication of the Kyrgyz Republic",
    "Israel":         "MOT - Ministry of Transport and Road Safety",
    "Hungary":        "KTI - Közlekedéstudományi Kutatóintézet",
    "United Kingdom": "VCA - Vehicle Certification Agency",
    "Austria":        "BMK - Bundesministerium für Klimaschutz",
    "Switzerland":    "ASTRA - Bundesamt für Strassen",
    "Norway":         "Statens vegvesen",
    "Finland":        "Traficom",
    "Denmark":        "Færdselsstyrelsen",
    "Ireland":        "NSAI - National Standards Authority of Ireland",
    "Slovakia":       "Ministerstvo dopravy Slovenskej republiky",
    "Estonia":        "Transpordiamet",
    "Latvia":         "CSDD - Ceļu satiksmes drošības direkcija",
    "Lithuania":      "LTSA - Lietuvos transporto saugos administracija",
    "Bulgaria":       "Executive Agency Road Transport Administration",
    "Greece":         "Ministry of Infrastructure and Transport",
    "Cyprus":         "Department of Road Transport",
    "Malta":          "Transport Malta",
    "Belgium":        "FPS Mobility and Transport",
}


def clean_authority(fragment: str) -> str:
    value = re.sub(r"Ref\.\s*Ares\([^)]*\)\s*-\s*\d{2}/\d{2}/\d{4}", " ", fragment)
    value = re.sub(r"\s+", " ", value).strip(" :.,-")
    cut = AUTHORITY_CUT.search(value)
    if cut and cut.start() > 3:
        value = value[:cut.start()]
    return value.strip(" :.,-")[:120]


def authority_from_text(text: str):
    """-> (Land der ausstellenden Stelle, Name der Stelle).

    Der Name kommt zuerst aus dem Formularfeld "Name of competent
    authority/administration"; taugt der Wert nicht (Anschrift, Formularfloskel,
    abgeschnittenes Label), wird die Briefkopfzeile genommen, in der die Stelle
    erkannt wurde. Der Landesname ist hier ausdruecklich KEIN Rueckfall - dafuer
    gibt es eine eigene Spalte."""
    head_raw = text[:2000]
    head = re.sub(r"\s+", " ", head_raw)

    named = ""
    m = COMPETENT_AUTHORITY.search(text)
    if m:
        value = re.sub(r"\s+", " ", m.group(1)).strip(" :.,-")
        # Ein davorstehendes Label-Fragment abschneiden ("... administracyjnej X")
        value = re.sub(r"^(?:[a-zà-ž]+\s+){0,2}(?=[A-ZÀ-Ž])", "", value)
        if len(value) > 3 and not NOT_AN_AUTHORITY.search(value):
            named = clean_authority(value)

    best = None
    for country, pattern in AUTHORITIES:
        m2 = re.search(pattern, head, re.I)
        if m2 and (best is None or m2.start() < best[0]):
            best = (m2.start(), country, m2)

    if best and not named:
        hint = AUTHORITY_NAME_HINT.get(best[1])
        m3 = re.search(hint, head, re.I) if hint else None
        pos = m3.start() if m3 else best[2].start()
        # Briefkopfausschnitt ab dem Treffer - davor stehen der Ares-Stempel und
        # Registriernummern, dahinter beginnt der Formulartitel.
        named = clean_authority(head[pos:pos + 130])

    country = best[1] if best else ""
    canonical = CANONICAL_AUTHORITY.get(country, named)
    return country, canonical, named


# Landesnamen in den Sprachen, in denen die Bescheide ausgestellt werden.
COUNTRIES = {
    "Albania": ["albanie", "albania", "albanien"],
    "Andorra": ["andorre", "andorra"],
    "Armenia": ["arménie", "armenie", "armenia", "armenien"],
    "Austria": ["autriche", "austria", "österreich", "oesterreich"],
    "Azerbaijan": ["azerbaïdjan", "azerbaidjan", "azerbaijan", "aserbaidschan"],
    "Belarus": ["biélorussie", "bielorussie", "belarus", "weißrussland"],
    "Belgium": ["belgique", "belgium", "belgien"],
    "Bosnia and Herzegovina": ["bosnie", "bosnia", "bosnien"],
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
    "Israel": ["israël", "israel"],
    "Italy": ["italie", "italy", "italien"],
    "Kazakhstan": ["kazakhstan", "kasachstan"],
    "Kyrgyzstan": ["kirghizistan", "kyrgyz", "kirgis"],
    "Latvia": ["lettonie", "latvia", "lettland"],
    "Liechtenstein": ["liechtenstein"],
    "Lithuania": ["lituanie", "lithuania", "litauen"],
    "Luxembourg": ["luxembourg", "luxemburg"],
    "Malta": ["malte", "malta"],
    "Moldova": ["moldavie", "moldova", "moldau"],
    "Monaco": ["monaco"],
    "Montenegro": ["monténégro", "montenegro"],
    "Netherlands": ["pays-bas", "netherlands", "niederlande"],
    "North Macedonia": ["macédoine", "macedoine", "macedonia", "mazedonien"],
    "Norway": ["norvège", "norvege", "norway", "norwegen"],
    "Poland": ["pologne", "poland", "polen", "polsk"],
    "Portugal": ["portugal"],
    "Romania": ["roumanie", "romania", "rumänien", "român"],
    "Russia": ["russie", "russia", "russland"],
    "San Marino": ["saint-marin", "san marino"],
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

# Laenderkuerzel, wie sie in Kartennamen auftauchen ("PWPW PL Tach", "CY Digital
# Tachograph Cards"). Nur als eigenstaendiges Grossbuchstaben-Token verwertet.
ISO2 = {
    "AL": "Albania", "AM": "Armenia", "AT": "Austria", "AZ": "Azerbaijan", "BA": "Bosnia and Herzegovina",
    "BE": "Belgium", "BG": "Bulgaria", "CH": "Switzerland", "CY": "Cyprus", "CZ": "Czechia",
    "DE": "Germany", "DK": "Denmark", "EE": "Estonia", "ES": "Spain", "FI": "Finland",
    "FR": "France", "GE": "Georgia", "GR": "Greece", "HR": "Croatia", "HU": "Hungary",
    "IE": "Ireland", "IS": "Iceland", "IT": "Italy", "LT": "Lithuania", "LU": "Luxembourg",
    "LV": "Latvia", "MD": "Moldova", "ME": "Montenegro", "MK": "North Macedonia", "MT": "Malta",
    "NL": "Netherlands", "NO": "Norway", "PL": "Poland", "PT": "Portugal", "RO": "Romania",
    "RS": "Serbia", "SE": "Sweden", "SI": "Slovenia", "SK": "Slovakia", "TJ": "Tajikistan",
    "TR": "Türkiye", "UA": "Ukraine", "UZ": "Uzbekistan",
}

# Firmennamen, die selbst einen Landesnamen enthalten. Ohne diesen Filter wird
# der Sitz des Herstellers als Zielland gelesen - "Austria Card" hat schon eine
# griechische Karte zu einer oesterreichischen gemacht.
COMPANY_NOISE = re.compile(
    r"austria\s*card|austriacard|thales\s+dis(\s+\w+)?|imprimerie\s+nationale|"
    r"bundesdruckerei|national\s+bank\s+of|polska\s+wyt\w+|idemia\s+the\s+netherlands|"
    r"tr[uü]b\s+ag|gemalto(\s+ag)?|giesecke|morpho|infocamere|tempest|lodvila|"
    r"stmicroelectronics|kraftfahrt-bundesamt|\bdeutsche\s+\w+", re.I)

# Punkt 1 und 2 des EU-Genehmigungsformulars, mehrsprachig.
FORM_LABELS = {
    1: r"(?:Manufacturing (?:brand )?or (?:commercial )?(?:mark|trademark)|"
       r"Marque de fabrique ou marque(?: commerciale)?|Hersteller- oder Handelsmarke|"
       r"Fabrik- oder Handelsmarke|Marca de fabricaci[oó]n|Marchio)",
    2: r"(?:Name of (?:the )?model|Nom du mod[eè]le|Modellbezeichnung|Name des Musters|"
       r"Nombre del modelo|Denominaci[oó]n del modelo|Nome del modello|Naziv modela)",
}

TA_RE = re.compile(r"\be\d{1,2}[-_/]?[\w./-]*", re.I)


@dataclass
class Result:
    type_approval: str
    country: str
    source: str            # woraus das Land stammt
    confidence: str        # "belegt" | "Annahme" | "unbekannt"
    evidence: str          # der Textausschnitt, der die Angabe traegt
    generation: str = ""
    item: str = ""
    ta_pdf: str = ""
    issuer_prefix: str = ""      # Land laut eNN-Praefix
    issuer_authority: str = ""   # Behoerde laut Bescheid (Briefkopf/Formularfeld)
    issuer_country: str = ""     # Land dieser Behoerde
    issuer_check: str = ""       # bestaetigt | ABWEICHUNG | nicht pruefbar
    issuer_expected: str = ""    # Typgenehmigungsstelle laut Praefix-Tabelle
    issuer_table_source: str = ""  # Liste | Bescheid | unsicher
    issuer_note: str = ""          # abweichende Stelle im Bescheid / Quellenkonflikt
    issuer_authority_raw: str = ""  # unveraenderter Briefkopf-/Feldtext als Beleg

    def as_row(self):
        return asdict(self)


# --------------------------------------------------------------------------- #
# Landeserkennung
# --------------------------------------------------------------------------- #

def find_countries(text: str) -> list[str]:
    """Alle Laender, die in text vorkommen - ausgeschriebene Namen und, wenn es
    erkennbar um Karten geht, auch Zwei-Buchstaben-Kuerzel."""
    if not text:
        return []
    hay = text.lower()
    found = [n for n, variants in COUNTRIES.items() if any(v in hay for v in variants)]
    if re.search(r"tacho|karte|card|cards|cartes", hay):
        for tok in re.findall(r"\b([A-Z]{2})\b", text):
            name = ISO2.get(tok)
            if name and name not in found:
                found.append(name)
    return found


def issuing_country(type_approval: str) -> str:
    return prefix_info(type_approval)[0]


# --------------------------------------------------------------------------- #
# PDF / OCR
# --------------------------------------------------------------------------- #

def _pdftotext(path: str) -> str:
    if not shutil.which("pdftotext"):
        return ""
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"],
                             capture_output=True, text=True, timeout=120)
        return re.sub(r"[ \t]+", " ", out.stdout)
    except Exception:
        return ""


def _ocr(path: str, cache_dir: str, max_pages: int = 3) -> str:
    """Gescannte Bescheide (vor allem die deutschen) haben keine Textebene."""
    if not (shutil.which("tesseract") and shutil.which("pdftoppm")):
        return ""
    cached = os.path.join(cache_dir, os.path.basename(path) + ".ocr.txt")
    if os.path.exists(cached):
        return open(cached, encoding="utf-8", errors="ignore").read()
    try:
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["pdftoppm", "-r", "300", "-png", "-f", "1", "-l", str(max_pages),
                            path, os.path.join(d, "p")], check=True, timeout=300)
            parts = []
            for png in sorted(os.listdir(d)):
                r = subprocess.run(["tesseract", os.path.join(d, png), "stdout",
                                    "-l", "deu+eng+fra", "--psm", "6"],
                                   capture_output=True, text=True, timeout=300)
                parts.append(r.stdout)
        text = re.sub(r"[ \t]+", " ", "\n".join(parts))
        open(cached, "w", encoding="utf-8").write(text)
        return text
    except Exception:
        return ""


def fetch_pdf(url: str, cache_dir: str) -> str | None:
    os.makedirs(cache_dir, exist_ok=True)
    local = os.path.join(cache_dir, os.path.basename(urllib.parse.unquote(url)))
    if os.path.exists(local) and os.path.getsize(local) > 1000:
        return local
    try:
        r = requests.get(urllib.parse.quote(url, safe=":/?=&"), headers=HEADERS, timeout=90)
        if r.status_code == 200 and r.content[:4] == b"%PDF":
            open(local, "wb").write(r.content)
            return local
    except requests.exceptions.RequestException:
        pass
    return None


def form_field(text: str, num: int) -> str:
    """Punkt 1/2 des Formulars. Der Wert steht hinter dem Label oder - in den
    zweisprachigen deutschen Boegen - erst unter dem englischen Zweitlabel.
    Wichtig: [ \\t]* statt \\s*, sonst frisst der Ausdruck den Zeilenumbruch und
    liefert das naechste Label als Wert."""
    m = re.search(rf"{FORM_LABELS[num]}[ \t]*:?[ \t]*(.*)", text, re.I)
    if not m:
        m = re.search(rf"^\s*{num}\s*[.)]\s*(.{{5,240}})$", text, re.M)
        return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
    value = re.sub(r"\s+", " ", m.group(1)).strip(" :.")
    if len(value) < 3:
        other = FORM_LABELS[2 if num == 1 else 1]
        for line in text[m.end():].splitlines()[:8]:
            line = re.sub(r"\s+", " ", line).strip()
            if len(line) <= 2 or re.match(r"^\d+\s*[.)]|^\d+\.[a-z]\)", line):
                continue
            if re.search(other, line, re.I) or re.search(FORM_LABELS[num], line, re.I):
                continue
            value = line.strip(" :.")
            break
    return value


def read_ta_pdf(pdf_url: str, cache_dir: str, use_ocr: bool = True):
    """-> (Zielland, Quelle, Belegtext, Behoerdenland, Behoerdenname, Rohtext)."""
    local = fetch_pdf(pdf_url, cache_dir)
    if not local:
        return "", "", "", "", "", ""
    text = _pdftotext(local)
    if len(text.strip()) < 200 and use_ocr:
        text = _ocr(local, cache_dir)
    if not text.strip():
        return "", "", "", "", "", ""

    auth_country, auth_name, auth_raw = authority_from_text(text)

    model = form_field(text, 2)
    hits = find_countries(model)
    if hits:
        return ", ".join(hits), "TA-PDF: Name of model", model[:160], auth_country, auth_name, auth_raw

    mark = form_field(text, 1)
    hits = find_countries(COMPANY_NOISE.sub(" ", mark))
    if hits:
        return ", ".join(hits), "TA-PDF: Manufacturing mark", mark[:160], auth_country, auth_name, auth_raw
    return "", "", "", auth_country, auth_name, auth_raw


# --------------------------------------------------------------------------- #
# Aufloesung
# --------------------------------------------------------------------------- #

def resolve(type_approval: str, item: str = "", pdf_url: str = "",
            cache_dir: str = ".jrc_cache", use_pdf: bool = True,
            use_ocr: bool = True, generation: str = "") -> Result:
    """Reihenfolge fuer das ZIELLAND: Kartenname der JRC-Liste -> TA-PDF ->
    Ausstellerland (Annahme). Unabhaengig davon wird immer die ausstellende
    BEHOERDE aus dem Bescheid gelesen und gegen das eNN-Praefix geprueft."""
    prefix_country, expected_authority, table_source, authority_note = prefix_info(type_approval)
    target, src, ev, auth_country, auth_name, auth_raw = "", "", "", "", "", ""

    if use_pdf and pdf_url:
        target, src, ev, auth_country, auth_name, auth_raw = read_ta_pdf(pdf_url, cache_dir, use_ocr)

    if auth_country and prefix_country:
        check = "bestaetigt" if auth_country == prefix_country else \
                f"ABWEICHUNG: Praefix={prefix_country}, Behoerde={auth_country}"
    elif auth_country and not prefix_country:
        check = f"Praefix unbekannt, Behoerde={auth_country}"
    else:
        check = "nicht pruefbar (kein PDF/keine Behoerde erkannt)"

    # Das Ausstellerland ist die Behoerde, wenn erkannt - sie ist die
    # Primaerquelle; das Praefix ist nur eine Ableitung daraus.
    issuer = auth_country or prefix_country
    prefix_label = re.match(r"e\d{1,2}", type_approval.strip(), re.I)
    base = Result(type_approval, "", "", "unbekannt", "", generation, item, pdf_url,
                  prefix_country, auth_name, auth_country, check,
                  expected_authority, table_source, authority_note, auth_raw)

    hits = find_countries(item)
    if hits:
        base.country, base.source, base.confidence, base.evidence = \
            ", ".join(hits), "JRC-Kartenname", "belegt", item[:160]
        return base
    if target:
        base.country, base.source, base.confidence, base.evidence = target, src, "belegt", ev
        return base
    if issuer:
        note = "AETR-Karte: Zielland ist NICHT das Ausstellerland" if re.search(r"aetr", item, re.I) else ""
        label = "Ausstellerbehoerde" if auth_country else f"eNN-Praefix ({prefix_label.group(0) if prefix_label else '?'})"
        base.country, base.source, base.confidence, base.evidence = issuer, label, "Annahme", note or auth_name
        return base
    return base


# --------------------------------------------------------------------------- #
# JRC-Seiten
# --------------------------------------------------------------------------- #

def jrc_rows(page_url: str) -> list[dict]:
    html = requests.get(page_url, headers=HEADERS, timeout=90).text
    rows = []
    for block in re.finditer(r"<tr[^>]*>([\s\S]*?)(?=<tr[^>]*>|</table>)", html, re.I):
        cells = re.findall(r"<t[dh]([^>]*)>([\s\S]*?)</t[dh]>", block.group(1), re.I)
        if len(cells) < 6:
            continue
        values = [re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", c[1])).replace("&amp;", "&").strip()
                  for c in cells]
        if values[0].lower().startswith("manufacturer"):
            continue
        ta_i = next((i for i, v in enumerate(values) if re.match(r"^e\d{1,2}[-_ ]", v, re.I)), None)
        if ta_i is None:
            continue
        generation = ""
        for attrs in (c[0] for c in cells):
            m = re.search(r'bgcolor="#([0-9a-fA-F]{6})"', attrs)
            if m and m.group(1).lower() in ANNEX_COLOR:
                generation = ANNEX_COLOR[m.group(1).lower()]
        links = [h for c in cells for h in re.findall(r'href="([^"]+)"', c[1])]
        # Eine Tabellenzeile kann Links benachbarter Eintraege enthalten. Den
        # Link nehmen, dessen Dateiname zur Genehmigungsnummer passt - sonst
        # wird der Bescheid eines fremden Eintrags ausgewertet (aufgefallen bei
        # e2-44, dort war e4-0008-00.pdf verlinkt).
        def norm(x):
            return re.sub(r"[^a-z0-9]", "", x.lower())
        ta_norm = norm(values[ta_i])
        best_link, neutral_link = "", ""
        for h in links:
            stem = norm(os.path.splitext(os.path.basename(h))[0])
            if stem == ta_norm or stem.startswith(ta_norm) or ta_norm.startswith(stem):
                best_link = h
                break
            # Dateinamen ohne erkennbare Genehmigungsnummer (z. B. getFile_wtcid171)
            # gehoeren zur Zeile selbst und bleiben als Rueckfall zulaessig.
            if not re.match(r"^e\d{1,2}[0-9a-z]*$", stem):
                neutral_link = neutral_link or h
        best_link = best_link or neutral_link
        rows.append({
            "type_approval": values[ta_i],
            "manufacturer": values[0],
            "item": " ".join(values[1:ta_i]),
            "generation": generation,
            "pdf": JRC_BASE + best_link if best_link else "",
            "pdf_unmatched": JRC_BASE + links[0] if links and not best_link else "",
        })
    return rows


def parse_proposal_text(text: str) -> list[dict]:
    """Liest die Vorschlagsliste, wie sie in der Update-Ansicht steht:
       'New JRC entry - e2_33' ... 'Imprimerie Nationale . DT cards for Andorra . ...'"""
    out, current = [], None
    for raw in text.splitlines():
        line = raw.strip()
        m = re.match(r"New JRC entry\s*[·\-–]\s*(.+)$", line)
        if m:
            current = {"type_approval": m.group(1).strip(), "item": "", "generation": "", "pdf": ""}
            out.append(current)
            continue
        if current and "·" in line and not line.startswith(("Country", "Approve", "Dismiss")):
            parts = [p.strip() for p in line.split("·")]
            current["item"] = " ".join(parts[1:2]) or line      # Kartenname
            current["manufacturer"] = parts[0]
    return [o for o in out if o["type_approval"]]


# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description="Land zu JRC-Typgenehmigungen ermitteln")
    ap.add_argument("--ta", action="append", help="Typgenehmigungsnummer (mehrfach moeglich)")
    ap.add_argument("--item", default="", help="Kartenname als zusaetzlicher Hinweis")
    ap.add_argument("--stdin", action="store_true", help="Vorschlagsliste von stdin lesen")
    ap.add_argument("--all", action="store_true", help="beide JRC-Seiten komplett auswerten")
    ap.add_argument("-o", "--out", help="Ergebnis als CSV schreiben")
    ap.add_argument("--cache", default=".jrc_cache")
    ap.add_argument("--no-pdf", action="store_true")
    ap.add_argument("--no-ocr", action="store_true")
    args = ap.parse_args()

    def jrc_index() -> dict:
        index = {}
        for url in JRC_PAGES.values():
            for r in jrc_rows(url):
                index.setdefault(re.sub(r"[^a-z0-9]", "", r["type_approval"].lower()), r)
        return index

    jobs: list[dict] = []
    if args.all:
        index = {}
        for url in JRC_PAGES.values():
            for r in jrc_rows(url):
                index.setdefault(r["type_approval"], r)
        jobs = list(index.values())
    elif args.stdin:
        jobs = parse_proposal_text(sys.stdin.read())
        index = jrc_index()                      # PDF-Link, Kartenname, Generation nachschlagen
        for j in jobs:
            hit = index.get(re.sub(r"[^a-z0-9]", "", j["type_approval"].lower()))
            if hit:
                j["pdf"] = hit["pdf"]
                j["generation"] = hit["generation"]
                j["item"] = j["item"] or hit["item"]
    elif args.ta:
        jobs = [{"type_approval": t, "item": args.item, "generation": "", "pdf": ""} for t in args.ta]
        if not args.no_pdf:                      # auch hier Kartenname/PDF aus der JRC-Liste holen
            index = jrc_index()
            for j in jobs:
                hit = index.get(re.sub(r"[^a-z0-9]", "", j["type_approval"].lower()))
                if hit:
                    j["pdf"] = hit["pdf"]
                    j["generation"] = hit["generation"]
                    j["item"] = j["item"] or hit["item"]
    else:
        ap.error("Bitte --ta, --stdin oder --all angeben")

    results = [resolve(j["type_approval"], j.get("item", ""), j.get("pdf", ""),
                       args.cache, not args.no_pdf, not args.no_ocr, j.get("generation", ""))
               for j in jobs]

    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(results[0].as_row()))
            w.writeheader()
            w.writerows(r.as_row() for r in results)
        belegt = sum(1 for r in results if r.confidence == "belegt")
        print(f"{len(results)} Eintraege -> {args.out} ({belegt} belegt, {len(results)-belegt} Annahme)")
    else:
        for r in results:
            flag = "OK " if r.confidence == "belegt" else "?? "
            print(f"{flag}{r.type_approval:20} {r.country or '-':22} [{r.confidence}] {r.source}"
                  + (f" | {r.evidence[:55]}" if r.evidence else ""))
            if r.issuer_expected:
                print(f"   Stelle: {r.issuer_expected}  [{r.issuer_table_source}]"
                      + (f" | im Bescheid: {r.issuer_authority[:45]}" if r.issuer_authority else ""))
                if r.issuer_note:
                    print(f"   Hinweis: {r.issuer_note}")
            if r.issuer_check.startswith("ABWEICHUNG"):
                print(f"   !! {r.issuer_check}  ({r.issuer_authority[:70]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
