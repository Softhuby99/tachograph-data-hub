# Tachograph Card Info Tool

Ein durchsuchbares Tool, das alle Infos aus der Excel-Datei zu Tachographen-Karten (G1 / G2.1 / G2.2) pro Land konsolidiert und in einer sauberen GUI anzeigt.

## 1. Datenquelle & Konsolidierung

Die Excel-Datei enthält 10 Sheets. Für das Tool relevant sind:

- **G2V2 Country Overview** (53 Zeilen) – Hauptdaten: Country, Generation, Application, Chip Platform, Type Approval, Date/Status, Authority, JRC Status, Manufacturer, Tachograph App / OS, Latest Tender, Winner, Procurement Status, Tender Source
- **Security Certificates** (53) – Security Certificate, Certificate Holder, Certified Chip Reference, Distinction, JRC Source
- **Systematic Procurement Review** (28) – ergänzende Procurement-Infos
- **Dashboard Lists** – normalisierte Manufacturer-Namen + Filter-Werte
- **Sources & Notes**, **JRC Card History**, **Cross-check Sheets** – als Referenz/Notizen

Alle drei Kern-Sheets werden per **Country + Generation** gejoined zu einer flachen Tabelle `tachograph_cards`. Länderflaggen sind bereits als Emoji im Country-String enthalten (z. B. „Germany 🇩🇪") — Country-Name und Flag werden beim Import getrennt.

## 2. Datenbank (Lovable Cloud / Supabase)

Eine Tabelle reicht, da 1 Zeile = 1 Land+Generation:

```
tachograph_cards
├─ id, country, country_flag, generation, application
├─ current_manufacturer, current_manufacturer_normalized
├─ chip_platform_vendor
├─ security_certificate, chip_certificate (= Certified Chip Reference)
├─ type_approval_number
├─ certified_security_platform
├─ date_status, issued_by_authority
├─ jrc_interoperability_status
├─ functional_certificate_lab
├─ tachograph_application_os
├─ distinction_from_manufacturer
├─ jrc_certificate_source
├─ latest_tender, winner_contractor
├─ procurement_status, tender_source
└─ notes, updated_at
```

Öffentlicher Read-Only-Zugriff via `TO anon` SELECT-Policy (keine sensiblen Daten).
Ein einmaliges Seed-Script importiert das Excel-File einmalig in die DB.

## 3. GUI (eine Seite unter `/`)

**Filter-Bereich (Top):**
- Country (Dropdown mit Flagge, inkl. „All")
- Generation: All / G1 / G2.1 / G2.2
- Application (Dropdown, aus Daten)
- Current Manufacturer (normalisiert, Dropdown)
- Freitext-Suche über alle Felder

**Ergebnisliste:** Karten-Layout, klick auf Karte öffnet Detailansicht.

**Detailansicht — zwei Gruppen wie gewünscht:**

*Antwort Gruppe 1 – Card / Certification*
Country + Flag · Generation · Application · Current Manufacturer (normalized) · Chip Platform (Vendor) · Security Certificate (OS) · Chip Certificate · Type Approval Number · Certified Security Platform / Chip Reference · Date / Status · Issued by · JRC Interoperability Status · Functional Certificate / Laboratory · Tachograph Application / OS · Distinction from Card Manufacturer / Personalizer · JRC / Certificate Source (als Link)

*Antwort Gruppe 2 – Procurement*
Latest Tender / Procurement Procedure · Winner / Contractor · Procurement Status / Assessment · Tender / Procurement Source (als Link)

Quellen-URLs werden als klickbare Links dargestellt, „|"-getrennte Mehrfachlinks aufgesplittet.

## 4. Tech-Details

- TanStack Start + shadcn/ui + Tailwind (bestehender Stack)
- Command-Palette-Style-Filter oben, responsive Grid darunter
- Public server function `listCards` und `getCard(id)` (server publishable client, RLS anon-read)
- Kein Login nötig — öffentliches Info-Tool
- Export-Button: aktuelle Ergebnisse als CSV

## 5. Was du noch bedenken solltest

1. **Datenaktualität** — die Excel-Daten haben Stand 15.07.2026. Ich schlage ein Feld `data_reference_date` + Hinweis im Footer vor, plus eine Admin-Route (später) zum Re-Import per Excel-Upload.
2. **Uneinheitliche Werte** — Manufacturer-Spalte hat teils Zusätze („– card supplier"). Die Sheet **Dashboard Lists** liefert eine `Normalized Manufacturer` Spalte, die ich für Filter nutze und die Rohform für Anzeige behalte.
3. **Leere / „Not publicly documented" Felder** — häufig in Procurement. UI zeigt „—" statt leerem Feld, Filter „Only rows with procurement data".
4. **Mehrere Generationen pro Land** — in den Daten hat jedes Land bisher genau eine aktive Generation. Falls später mehrere Zeilen pro Land nötig sind, unterstützt das Schema das bereits.
5. **Quellen-Nachvollziehbarkeit** — jede Zeile behält ihre Original-URL(s); JRC-Links werden klar getrennt von Procurement-Quellen dargestellt.
6. **Sprache** — Excel-Inhalte sind Englisch, UI-Labels (Gruppentitel etc.) mache ich Deutsch wie in deiner Anfrage; Datenwerte bleiben Englisch. Sag Bescheid, falls du komplett DE oder komplett EN möchtest.
7. **Kein Cross-check-Sheet ins Tool** — die „Uploaded Document Cross-check" / „JRC PDF Cross-check" Sheets sind interne QA-Daten. Ich blende sie standardmäßig aus, kann aber ein „Cross-check status"-Badge pro Land ergänzen, falls gewünscht.
8. **Flaggen-Rendering** — Emoji-Flaggen sehen auf Windows uneinheitlich aus. Optional kann ich stattdessen ein SVG-Flag-Set (`country-flag-icons`) einbinden — sag Bescheid.

Nach deiner Freigabe: DB anlegen → Excel importieren → GUI bauen.
