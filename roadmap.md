# Roadmap — Umsetzung Plan „Kritikpunkte"

- [x] 1.1 Länderauflösung: Helfer in ta-country.ts + Verbraucher umgestellt (jrc.server.ts, jrc.functions.ts, ToolsView, standalone/index.html) — Präfix füllt kein Land mehr, nur dokumentierte Quellen; Authority-Label separat
- [x] 1.2 tools/ (resolver, generator, check, cc_tachograph, ocr_run, CSV) + npm-Skripte — gen_ta_country.py erzeugt 397 Einträge identisch zur bestehenden ta-country.ts; check_dataset.py prüft JSON-Export gegen CSV; npm-Skripte gen:ta-country + check:dataset
- [x] 1.3 cc.server.ts: früheste Textposition gewinnt; BSI-Jahressuffix — certificateFromText sammelt alle Treffer und nimmt die früheste Position; BSI-Jahressuffix greift jetzt unabhängig von der Quelle (auch bei Certificate PDF), sucht zuerst im Zertifikats-PDF-Text
- [x] 1.4 Update-Quellen-Logging (jrc_check_runs pro Quelle) — bereits vollständig: Tabelle hat source_type, insertCheckRun pro Quelle, UI zeigt pro-Quelle-Status (8 Quellen inkl. cc_certificates + ted_procurement)
- [x] 1.5 21 Länderfehler als Vorschläge in Freigabe-Ablauf; Prüfung als Bericht (JSON-Export) — buildProposals erzeugt country-Feldänderung bei Konflikt (bypasses date filter), approval flow wendet sie an; JSON-Export im Tools-Reiter (cards + cross-check report); check_dataset.py schreibt report.json; standalone gespiegelt
- [x] 1.6 Migration: Freitext aus type_approval_number → verification_note (Marker [TA-ORIG:], rückrollbar, idempotent); EU-Stern-Format eNN* ausgenommen; 13 rows bereinigt
- [x] 2.1 jrc-check: Token vor DB, nur Header, nur POST, timing-sicher — bereits vollständig (POST-only, header-only x-cron-secret/Authorization, env secret checked before DB fallback, timingSafeEqual)
- [x] 2.2 fetch-Proxy: Timeout, Größenlimit, Stream, Cache, redirect manual — bereits vollständig (AbortController 15s, MAX_BYTES 5MB, getReader stream, cache-control max-age=3600, redirect: manual mit allowlist-check pro Hop)
- [x] 2.3 Lokal-Modus: Schreiben nur mit Admin-Token — noneAuth prüft x-admin-token gegen ADMIN_TOKEN; attachBearer sendet Token aus localStorage; UI-Admin-Login im Header mit Token-Eingabe
- [x] 2.4 DB-Passwort-Default entfernen (entrypoint + db.server) — kein Default mehr, entrypoint fordert DB_PASSWORD mit :? an
- [x] 3.1 standalone main.cjs: Allowlist + userData-Temp — ALLOWED_FETCH_HOSTS + app.getPath('userData') statt os.tmpdir()
- [x] 3.2 eslint --fix — index.tsx overrides in useMemo gewrappt; restliche warnings in auto-gen shadcn/previewAuthStorage
- [x] Version 2.13
