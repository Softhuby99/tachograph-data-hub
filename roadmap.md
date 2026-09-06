# Roadmap — Umsetzung Plan „Kritikpunkte"

- [x] 1.1 Länderauflösung: Helfer in ta-country.ts + Verbraucher umgestellt (jrc.server.ts, jrc.functions.ts, ToolsView, standalone/index.html) — Präfix füllt kein Land mehr, nur dokumentierte Quellen; Authority-Label separat
- [x] 1.2 tools/ (resolver, generator, check, cc_tachograph, ocr_run, CSV) + npm-Skripte — gen_ta_country.py erzeugt 397 Einträge identisch zur bestehenden ta-country.ts; check_dataset.py prüft JSON-Export gegen CSV; npm-Skripte gen:ta-country + check:dataset
- [x] 1.3 cc.server.ts: früheste Textposition gewinnt; BSI-Jahressuffix — certificateFromText sammelt alle Treffer und nimmt die früheste Position; BSI-Jahressuffix greift jetzt unabhängig von der Quelle (auch bei Certificate PDF), sucht zuerst im Zertifikats-PDF-Text
- [x] 1.4 Update-Quellen-Logging (jrc_check_runs pro Quelle) — bereits vollständig: Tabelle hat source_type, insertCheckRun pro Quelle, UI zeigt pro-Quelle-Status (8 Quellen inkl. cc_certificates + ted_procurement)
- [x] 1.5 21 Länderfehler als Vorschläge in Freigabe-Ablauf; Prüfung als Bericht (JSON-Export) — buildProposals erzeugt country-Feldänderung bei Konflikt (bypasses date filter), approval flow wendet sie an; JSON-Export im Tools-Reiter (cards + cross-check report); check_dataset.py schreibt report.json; standalone gespiegelt
- [ ] 1.6 Migration: Freitext aus type_approval_number → Notizspalte, rückrollbar
- [ ] 2.1 jrc-check: Token vor DB, nur Header, nur POST, timing-sicher
- [ ] 2.2 fetch-Proxy: Timeout, Größenlimit, Stream, Cache, redirect manual
- [ ] 2.3 Lokal-Modus: Schreiben nur mit Admin-Token
- [ ] 2.4 DB-Passwort-Default entfernen (entrypoint + db.server)
- [ ] 3.1 standalone main.cjs: Allowlist + userData-Temp
- [ ] 3.2 eslint --fix
- [ ] Version 2.12, Build auslösen
