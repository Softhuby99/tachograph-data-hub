# Plan: Kritikpunkte aus der Code-Prüfung umsetzen

## Paket 1 — Datenqualität (höchste Priorität)

**1. Länderliste mit Notlösung für unbekannte Nummern**
- `src/lib/ta-country.ts`: Wenn eine Typgenehmigungsnummer (z.B. neu ausgegebene e-Nummer) nicht in der festen Tabelle steht, wird das Land neu aus der Nummer selbst abgeleitet — das e-Kennzeichen (e1, e2, e4 …) ist international genormt und lässt sich sicher auf das Land mappen. Ergänzend landet der Treffer in der Konfidenz „aus Kennzeichen abgeleitet" und wird in der Gegenprüfung unter Tools sichtbar, damit neue Nummern auffallen statt still ohne Land zu bleiben.
- Gleiche Notlösung in der Offline-Version (`standalone/index.html`).

**2. Zertifikatserkennung: erster Fund im Text gewinnt**
- `src/lib/cc.server.ts` (`certificateFromText`): Aktuell werden die Muster der Reihe nach geprüft und das erste passende Muster gewinnt — egal wo im Text es steht. Umstellung: alle Muster sammeln ihre Funde mit Textposition, der früheste Fund im Dokument gewinnt. Damit verschwinden falsch zugeordnete Nummern (z.B. Chip-Zertifikat statt Karten-Zertifikat), soweit die Position im Dokument es hergibt. Zusätzlich bleibt die bestehende Regel, dass ein Karten-Profil Vorrang hat.

**3. Update-Quellen beim Start protokollieren**
- Beim automatischen Update-Lauf wird geloggt, welche Quelle (JRC-Seiten, Common-Criteria-Portal) erfolgreich war und welche fehlschlug — sichtbar im Update-Verlauf und im Container-Log. So erkennst du sofort, wenn eine Quelle still ausfällt, statt dich auf veraltete Daten zu verlassen.

## Paket 2 — Sicherheit

**4. Lokal-Modus: Schreiben nur mit gesetztem Token**
- `docker/entrypoint.sh`: Ohne gesetztes Admin-Token läuft die lokale Anwendung künftig nur lesend; jeder Schreibversuch bekommt eine klare Meldung, wie der Token gesetzt wird (statt stiller Vollzugriff).

**5. Proxy: Redirects auf erlaubte Hosts beschränken**
- Die Weiterleitungen des eingebauten Web-Zugriffs (Update-Prüfung) folgen nur noch Zielen auf der bekannten Liste erlaubter Seiten; alle anderen werden abgelehnt und geloggt.

**6. Rate-Limit-Log zur Warnung erweitern**
- Wenn die Schutzschwelle für Anfragen erreicht wird, erscheint ein Warnhinweis im Log (bisher stilles Verwerfen).

**7. Ohne Datenbank-Passwort hart abbrechen**
- `docker/entrypoint.sh`: Der fest eingebaute Ersatzwert `tdh` entfällt. Fehlt das Passwort in der Umgebung, startet der Container nicht und sagt im Log klar, was fehlt.

## Paket 3 — Kleinigkeiten

**8. Electron-Offline-App**
- `standalone/main.cjs`: Dieselbe Host-Allowlist wie in der Web-Version für ausgehende Abrufe; temporäre Dateien landen unter `app.getPath('userData')` statt im Installationsordner.

**9. Lint-Lauf**
- Einmal `npx eslint . --fix`; die zwei verbleibenden echten Befunde einzeln prüfen und beheben.

## Nicht in diesem Plan (separat)

**10. Eingescannte Bescheide lesen (OCR)**
- Kann nicht zur Laufzeit in der App passieren (Worker-Umgebung). Vorschlag: Vorverarbeitung außerhalb der App, Ergebnis als Datei ins Projekt legen — profitieren Online- und Offline-Version. Auf Wunsch als eigener Folgeauftrag.

## Versionierung & Auslieferung
- Version wird auf **2.13** erhöht (Web + Offline einheitlich).
- Nach Freigabe: GitHub-Build anstoßen; du lädst das neue Image wie gehabt per `docker pull` und startest den Container neu. Die Offline-EXE entsteht im selben Workflow-Lauf.

## Technische Details
- Angefasste Dateien: `src/lib/ta-country.ts`, `src/lib/cc.server.ts`, `src/lib/jrc.server.ts` (Logging), `docker/entrypoint.sh`, `src/main.cjs` bzw. `standalone/main.cjs`, `standalone/index.html`, Versionsdatei `src/lib/version.ts`.
- Keine Datenbank-Schemaänderungen nötig; keine bestehenden Daten werden überschrieben — die Notlösung aus Paket 1 füllt nur leere Länderfelder.
