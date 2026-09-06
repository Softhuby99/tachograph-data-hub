# Plan: Kritikpunkte aus der Code-Prüfung umsetzen (überarbeitet)

## Paket 1 — Datenqualität

**1.1 Länderauflösung — Präfix füllt das Länderfeld NICHT**
Das `eNN`-Kennzeichen benennt die genehmigende Behörde, nicht das Land der Karte (in rund drei von vier belegten Fällen weichen beide ab). Reihenfolge künftig:
1. Kartenname aus der JRC-Zeile auf Ländernamen und Zwei-Buchstaben-Kürzel prüfen, mit Firmennamen-Filter (Austria Card, IDEMIA The Netherlands, Thales DIS <Land>, Imprimerie Nationale, Bundesdruckerei, Trüb AG, Polska Wytwórnia, National Bank of …) → Konfidenz „belegt".
2. Typgenehmigungs-PDF: Punkt 2 „Name of model", ersatzweise Punkt 1 „Manufacturing mark" → „belegt".
3. Sonst Land leer lassen. Das Präfix wird separat als „Typgenehmigung erteilt von: KBA (e1)" geführt; der Eintrag erscheint in der Gegenprüfung unter Tools als „Land nicht belegt".

Unsichere Präfixe (E31, E42, E51, E54–E56, E58) bleiben als „unsicher" gekennzeichnet; E68 (Kirgisistan) und E69 (Israel) werden ergänzt, E31 anhand des belegten Falls `e31-01` (Bosnien und Herzegowina) korrigiert. Gleiche Logik in der Offline-Version.

**1.2 Generator-Skripte ins Projekt**
`tools/jrc_country_resolver.py`, `tools/gen_ta_country.py`, `tools/check_dataset.py`, `tools/cc_tachograph.py`, `tools/ocr_run.py`, `tools/data/laender_alle.csv` sowie die Skripte `gen:ta-country` und `check:dataset`. Damit ist `src/lib/ta-country.ts` erneuerbar statt ein eingefrorener Schnappschuss.

**1.3 Zertifikatserkennung**
- `certificateFromText` in `src/lib/cc.server.ts`: alle Muster sammeln ihre Funde mit Textposition; der früheste Fund im Dokument gewinnt (statt „erstes geprüftes Muster gewinnt"). Karten-Profil behält Vorrang.
- BSI-Nummern verlieren derzeit das Jahres-Suffix (`BSI-DSZ-CC-1158-V4` statt `…-2025`) und erzeugen dadurch Dubletten. Das Jahr wird aus dem Report-Kopf ergänzt, wenn die laufende Nummer übereinstimmt.

**1.4 Update-Quellen protokollieren**
Jeder Update-Lauf protokolliert pro Quelle (JRC-Seiten, Common-Criteria-Portal) Erfolg oder Fehlschlag — sichtbar im Update-Verlauf und im Container-Log.

**1.5 Die 21 belegten Länderfehler im Bestand**
Kein automatisches Überschreiben: die widersprüchlichen Datensätze (z. B. e69-AETR-0001-01 → Israel, e1-242-00 → Kasachstan, e4-0009-02 → Dänemark, e1-00021-00 → Griechenland) werden als Vorschläge mit Belegtext in den bestehenden Freigeben/Verwerfen-Ablauf eingespeist und einzeln bestätigt.
Die Prüfung läuft zunächst gegen die Datenbank (nicht gegen die Offline-Daten) und nur als Bericht; erst wenn die Korrekturen bestätigt und die Offline-Daten daraus neu erzeugt sind, wird sie im Build blockierend geschaltet. Der Prüflauf braucht Python und poppler-utils; ohne Netzzugang arbeitet der Generator aus der mitgelieferten CSV-Datei.

**1.6 Freitext im Schlüsselfeld**
9 Datensätze tragen Fließtext („Not published", „Not identified", ein deutscher Kommentar) im Feld für die Typgenehmigungsnummer. Die Migration kopiert den Originalwert zuerst unverändert in die Notizspalte und leert erst danach das Schlüsselfeld — inklusive Rückroll-Schritt, der den Text zurückschreibt. Fachliche Notizen wie „Zuordnung zu Luxemburg in the approval verifizieren" bleiben so erhalten.


## Paket 2 — Sicherheit

**2.1 Geplanter Update-Aufruf (`api/public/jrc-check`)**
- Erst das Umgebungs-Token prüfen; die Datenbankabfrage nur, wenn keines gesetzt ist (sonst löst jeder fremde Aufruf eine Abfrage aus).
- Token nur noch aus Kopfzeilen (`x-cron-secret` / `Authorization: Bearer`), nicht mehr aus der Adresszeile — dort landet es in Logs.
- Nur `POST`; `GET` löst keinen schreibenden Lauf mehr aus.
- Vergleich mit konstanter Laufzeit statt `includes`.

**2.2 Abruf-Weiterleitung (`api/public/fetch`)**
- Zeitlimit 20 s, Größenobergrenze über `Content-Length`, Antwort streamen statt vollständig puffern (die Archivseite des CC-Portals ist ~18 MB), kurzes Zwischenspeichern der großen Portalseiten.
- `redirect: "manual"`; Weiterleitungsziele gegen dieselbe Liste erlaubter Seiten prüfen und sonst ablehnen und protokollieren.

**2.3 Lokal-Modus: Schreiben nur mit gesetztem Token**
Ohne Admin-Token läuft die lokale Anwendung nur lesend; Schreibversuche bekommen eine klare Meldung.

**2.4 Kein Standard-Datenbankpasswort**
Der eingebaute Ersatzwert `tdh` entfällt an **beiden** Stellen: `docker/entrypoint.sh` und `src/lib/db.server.ts`. Fehlt das Passwort, startet die Anwendung nicht und sagt im Log, was fehlt.

*Gestrichen:* der ursprüngliche Punkt „Rate-Limit-Log" — im Code existiert kein Rate-Limit, das Warnen könnte. Falls gewünscht, baue ich eines als eigenen Punkt; bitte kurz sagen.

## Paket 3 — Kleinigkeiten

**3.1 Offline-App** (`standalone/main.cjs`): dieselbe Liste erlaubter Seiten wie in der Web-Version; temporäre Datei nach `app.getPath('userData')` statt in den Systemtemp.

**3.2 Lint**: einmal `eslint . --fix`, die zwei echten Befunde einzeln prüfen.

## Nicht in diesem Plan

Eingescannte Bescheide per Texterkennung auswerten: läuft nicht zur Laufzeit in der Anwendung. `tools/ocr_run.py` kommt mit ins Projekt (1.2); die Auswertung erfolgt vorab, das Ergebnis wird als Datei abgelegt — davon profitieren Online- und Offline-Version. Auf Wunsch als Folgeauftrag.

## Version & Auslieferung
- Version einheitlich auf **2.12** (Web + Offline).
- Danach GitHub-Build; Image per `docker pull` laden und Container neu starten. Die Offline-EXE entsteht im selben Lauf.

## Technische Details
Angefasste Dateien: `src/lib/ta-country.ts` (generiert), `src/lib/jrc.server.ts`, `src/lib/jrc.functions.ts`, `src/lib/cc.server.ts`, `src/lib/db.server.ts`, `src/routes/api/public/jrc-check.ts`, `src/routes/api/public/fetch.ts`, `src/components/ToolsView.tsx`, `src/components/UpdatesView.tsx`, `docker/entrypoint.sh`, `standalone/main.cjs`, `standalone/index.html`, `src/lib/version.ts`, neu `tools/*` und `package.json`-Skripte.
Datenbank: eine Migration für die Notizspalte (1.6). Bestehende Länderangaben werden nie automatisch überschrieben — Korrekturen laufen über den Freigabe-Ablauf.
