# Multi-Source Update Monitoring: All JRC Pages + TED Procurement API

## Goal

Expand the existing JRC update monitor from 1 source to 6 JRC pages + TED procurement API, so the tool checks **every** field it displays for updates and proposes changes for user approval.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  JRC Sources (6 pages)               │
│                                                      │
│  Card Status ──────────► generation, manufacturer,   │
│                           type_approval, cert, EOV   │
│  Other Certificates ────► type_approval (AETR/extra) │
│  Public Key Certs (DT)──► security_cert, chip_cert,   │
│                           date_status, cert_holder    │
│  Key Management Status─► key_lifecycle, TC.C dates   │
│  Mandatory Security ───► security_update_status      │
│  Manufacturer Codes ────► manufacturer normalization  │
└─────────────────────────────────────────────────────┘
          ┌──────────────────────────┐
          │  TED API (procurement)   │
          │  POST /v3/notices/search │
          │  FT="tachograph"         │
          │  + XML fetch per notice  │
          │                          │
          │  ► latest_tender         │
          │  ► winner_contractor    │
          │  ► procurement_status    │
          │  ► tender_source         │
          └──────────────────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │ jrc_update_proposals    │
   │ (extended with          │
   │  source_type column)    │
   └─────────────────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │   UpdatesView (UI)       │
   │   Grouped by source      │
   │   Approve / Dismiss      │
   └─────────────────────────┘
```

## Part 1: Database Schema Changes

**Migration: extend `jrc_update_proposals` with `source_type`**

```sql
ALTER TABLE public.jrc_update_proposals
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'jrc_card_status';

-- source_type values: 'jrc_card_status', 'jrc_other_certs',
-- 'jrc_pubkey_dt', 'jrc_key_mgmt', 'jrc_security_updates',
-- 'ted_procurement'
```

No new table needed — the existing proposals table is reused with a `source_type` discriminator. TED proposals populate the same `changes` JSONB with procurement field names.

## Part 2: JRC Multi-Page Scrapers

New file: `src/lib/jrc-sources.server.ts` — one fetcher+parser per JRC page.

### 2.1 Other Certificates (`dtc_other_certificates.php.html`)
- Table columns: Manufacturers/Personalisers, Card/VU/MS/Component, Interoperability Certificate, Type Approval Certificate, Date of approval, Mandatory security updates, Annex
- Maps to: additional `type_approval_number` entries (especially AETR countries like Tajikistan, Uzbekistan)
- Generation from Annex column (same color mapping)
- Match to existing cards by manufacturer + type approval

### 2.2 Public Key Certificates DT (`dtc_public_key_certificates_dt.php.html`)
- Table columns: Country, End of Validity, Certificate, Equipment type, SHA-1
- Maps to: `security_certificate`, `chip_certificate`, `date_status` (End of Validity), `certified_security_platform` (Equipment type)
- Match by country + generation

### 2.3 Key Management Status DT (`dtc_key_management_status_dt.php.html`)
- Table columns: Country, State Authority Identified, Policy approved, TC.C, KmWC, VU.C, KmVU, Km
- Maps to: key lifecycle dates per country — stored as `verification_note` updates or new `jrc_interoperability_status` enrichment
- Match by country

### 2.4 Mandatory Security Software Updates (`dtc_mandatory_security_software_updates.php.html`)
- Table columns: Brand, Model, Version(s), Type Approval(s), Vulnerable SW versions, SW versions for update, Versions after update, Type Approvals after update, Start date, Deadline
- Maps to: `distinction_from_manufacturer` / `verification_note` — security advisory per model
- Match by type approval number

### 2.5 Manufacturer Codes (`dtc_manufacturer_code.php.html`)
- Simple mapping table: manufacturer name → ERCA code
- Used to improve manufacturer matching across sources, not stored as proposals directly

### 2.6 Card Status (existing — refactored)
- Move existing `parseJrcCardStatus` and `fetchJrcRows` into the new `jrc-sources.server.ts` as `fetchCardStatusRows()`
- `jrc.server.ts` keeps `runJrcCheck` but calls all sources

## Part 3: TED Procurement API Integration

New file: `src/lib/ted.server.ts`

### 3.1 Search
```ts
POST https://api.ted.europa.eu/v3/notices/search
Body: { query: 'FT="tachograph"', fields: ["ND","publication-date"], limit: 100 }
No auth required.
```

### 3.2 XML Fetch + Parse
For each notice ND, fetch `https://ted.europa.eu/en/notice/{ND}/xml` and extract:
- `ISO_COUNTRY` → country (2-letter → full name)
- `AA_NAME/OFFICIALNAME` → buyer (contracting authority)
- `TI_TEXT` (EN) → title
- `SHORT_CONTRACT_DESCRIPTION` → description → procurement_scope
- `ORIGINAL_CPV` → CPV codes
- `TOTAL_FINAL_VALUE/VALUE_COST` → contract value
- `AWARD_OF_CONTRACT/OFFICIALNAME` → winner_contractor
- `DATE_PUB` → latest_tender date
- `TD_DOCUMENT_TYPE` → procurement_status (Contract award notice = "awarded", etc.)

### 3.3 Matching
Match TED notice country (ISO_COUNTRY) to existing `tachograph_cards` records by country name. One TED notice may match multiple card generations in the same country — propose procurement updates to all matching cards.

### 3.4 Filtering
Only propose TED notices published after the dataset's `data_reference_date` (same `sinceMs` logic as JRC).

## Part 4: Orchestrator Update

Update `runJrcCheck` in `jrc.server.ts` → rename to `runUpdateCheck`:

```
1. Fetch all 5 JRC pages (parallel)
2. Fetch TED search results + XMLs (sequential, limited to ~50 notices)
3. Load all tachograph_cards
4. Build proposals from each source with source_type
5. Dedup by fingerprint
6. Insert new proposals
7. Log to jrc_check_runs with per-source counts
```

Server function `checkJrcUpdates` → `checkUpdates` (keep old name for backward compat or alias).

## Part 5: UI Updates

### UpdatesView changes (`src/components/UpdatesView.tsx`)

1. **Source filter chips**: Show/hide proposals by source type (JRC Card Status, JRC Other Certs, JRC PubKey, JRC Key Mgmt, JRC Security, TED Procurement)
2. **Source badge** on each proposal card (colored by source)
3. **TED proposals**: Show procurement-specific diff fields (latest_tender, winner_contractor, procurement_status, tender_source) instead of certificate fields
4. **Check button**: Now triggers all sources, shows per-source result counts in toast
5. **Source links**: Each proposal links to its origin page (JRC page URL or TED notice URL)

### Result counts in toast
```
"Checked 6 sources: 12 proposals (4 card status, 2 other certs, 1 pubkey, 0 key mgmt, 0 security, 5 TED)"
```

## Part 6: Standalone EXE

After web preview is verified, rebuild the standalone `index.html` with:
- New multi-source check button
- TED integration (fetch directly from browser — CORS allows it since TED API is public)
- Updated UpdatesView with source filtering

Rebuild portable EXE.

## Implementation Order

1. Migration (source_type column)
2. `jrc-sources.server.ts` (5 new JRC parsers + refactor existing)
3. `ted.server.ts` (TED search + XML parse)
4. Update `jrc.server.ts` orchestrator + `jrc.functions.ts`
5. Update `UpdatesView.tsx` UI
6. Test in preview
7. Rebuild standalone EXE
