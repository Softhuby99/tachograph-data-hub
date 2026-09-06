# Roadmap — Umsetzung Plan „Kritikpunkte"

- [~] 1.1 Länderauflösung: Helfer in ta-country.ts fertig (documentedCountry, approvalAuthorityLabel, resolveFromCardName mit Firmenfilter, unsichere Präfixe); E31 in Daten bereits korrekt. OFFEN: Verbraucher umstellen (jrc.server.ts, jrc.functions.ts, ToolsView „Land nicht belegt"), Offline-Spiegelung in standalone/index.html
- [ ] 1.2 tools/ (resolver, generator, check, cc_tachograph, ocr_run, CSV) + npm-Skripte
- [ ] 1.3 cc.server.ts: früheste Textposition gewinnt; BSI-Jahressuffix
- [ ] 1.4 Update-Quellen-Logging (jrc_check_runs pro Quelle)
- [ ] 1.5 21 Länderfehler als Vorschläge in Freigabe-Ablauf; Prüfung als Bericht (JSON-Export)
- [ ] 1.6 Migration: Freitext aus type_approval_number → Notizspalte, rückrollbar
- [ ] 2.1 jrc-check: Token vor DB, nur Header, nur POST, timing-sicher
- [ ] 2.2 fetch-Proxy: Timeout, Größenlimit, Stream, Cache, redirect manual
- [ ] 2.3 Lokal-Modus: Schreiben nur mit Admin-Token
- [ ] 2.4 DB-Passwort-Default entfernen (entrypoint + db.server)
- [ ] 3.1 standalone main.cjs: Allowlist + userData-Temp
- [ ] 3.2 eslint --fix
- [ ] Version 2.12, Build auslösen
