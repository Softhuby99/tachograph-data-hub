import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, Loader2, ShieldCheck, Package } from "lucide-react";
import { toast } from "sonner";
import { documentedCountry, countryConflict, approvalAuthorityLabel } from "@/lib/ta-country";
import { flagEmoji, isoForCountry, normalizeCountry } from "@/lib/country-flag";

export type ExportRow = Record<string, unknown>;

// ---- deployment snapshot -------------------------------------------------
//
// The files a fresh deployment starts from are checked into the repository:
// db/seed_cards.sql seeds an empty database, standalone/data.json is baked
// into the offline app at build time. Both were written once and then aged —
// the offline app shipped 216 records while the live database held 295, and
// its frozen `iso` field still pointed at a country that had since been
// corrected. These two exports regenerate both files from the live data, so
// updating them is a commit rather than hand work.

/** Columns of public.tachograph_cards, in the order used by db/seed_cards.sql. */
const SEED_COLUMNS = [
  "id",
  "country",
  "country_flag",
  "generation",
  "application",
  "current_manufacturer",
  "current_manufacturer_normalized",
  "chip_platform_vendor",
  "security_certificate",
  "chip_certificate",
  "certificate_issued_date",
  "certificate_expiry_date",
  "type_approval_number",
  "certified_security_platform",
  "certificate_holder",
  "date_status",
  "issued_by_authority",
  "jrc_interoperability_status",
  "functional_certificate_lab",
  "security_certificate_lab",
  "tachograph_application_os",
  "distinction_from_manufacturer",
  "jrc_certificate_source",
  "primary_source",
  "latest_tender",
  "winner_contractor",
  "procurement_status",
  "procurement_scope",
  "tender_source",
  "verification_note",
  "data_reference_date",
] as const;

const sqlText = (v: unknown) => `'${String(v ?? "").replace(/'/g, "''")}'`;

/**
 * Dataset for the offline app. country_flag and iso are derived from the
 * country here rather than copied through: a value frozen at export time is
 * exactly what made a corrected record keep its old flag.
 */
function buildOfflineData(cards: ExportRow[]): string {
  const rows = cards.map((c) => {
    const country = normalizeCountry(String(c["country"] ?? ""));
    const row: Record<string, unknown> = { ...c, country };
    row["iso"] = isoForCountry(country);
    row["country_flag"] = flagEmoji(country);
    delete row["created_at"];
    delete row["updated_at"];
    return row;
  });
  return JSON.stringify(rows, null, 1);
}

/** Replacement for db/seed_cards.sql: the current cards as INSERT statements. */
function buildSeedSql(cards: ExportRow[]): string {
  const header = [
    "-- Seed data for public.tachograph_cards.",
    "--",
    "-- Generated from a running instance via Tools -> Deployment snapshot.",
    "-- Only loaded into a fresh database; init.sql skips the seed when the",
    "-- schema already exists, so an existing deployment is never overwritten.",
    `-- Generated: ${new Date().toISOString().slice(0, 10)} · ${cards.length} records`,
    "",
  ].join("\n");
  const columns = SEED_COLUMNS.join(", ");
  const statements = cards.map((c) => {
    const country = normalizeCountry(String(c["country"] ?? ""));
    const values = SEED_COLUMNS.map((col) => {
      if (col === "country") return sqlText(country);
      if (col === "country_flag") return sqlText(flagEmoji(country));
      // A date column cannot take an empty string; fall back to the default.
      if (col === "data_reference_date" && !c[col]) return "DEFAULT";
      return sqlText(c[col]);
    });
    return `INSERT INTO public.tachograph_cards (${columns}) VALUES (${values.join(", ")}) ON CONFLICT (id) DO NOTHING;`;
  });
  return `${header}${statements.join("\n")}\n`;
}

/** Human-readable column titles; anything else falls back to a prettified key. */
const COLUMN_LABELS: Record<string, string> = {
  country: "Country",
  country_flag: "Country Flag",
  generation: "Generation",
  application: "Application",
  current_manufacturer: "Current Manufacturer",
  current_manufacturer_normalized: "Current Manufacturer (normalized)",
  chip_platform_vendor: "Chip / Platform Vendor",
  security_certificate: "Security Certificate",
  chip_certificate: "Chip Certificate",
  certificate_issued_date: "Date Certificate Issued",
  certificate_expiry_date: "Certificate Validity Expiration Date",
  type_approval_number: "Type Approval Number",
  certified_security_platform: "Certified Security Platform",
  certificate_holder: "Certificate Holder",
  date_status: "Date / Status",
  issued_by_authority: "Issued by Authority",
  jrc_interoperability_status: "JRC Interoperability Status",
  functional_certificate_lab: "Functional Certificate Lab",
  security_certificate_lab: "Security Certificate Lab",
  tachograph_application_os: "Tachograph Application / OS",
  distinction_from_manufacturer: "Distinction from Manufacturer",
  jrc_certificate_source: "JRC / Certificate Source",
  primary_source: "Primary Source",
  card_quantities: "Card Quantities",
  latest_tender: "Latest Tender / Procurement Procedure",
  winner_contractor: "Winner / Contractor",
  procurement_status: "Procurement Status",
  procurement_scope: "Procurement Scope",
  tender_source: "Tender Source",
  verification_note: "Verification Note",
  data_reference_date: "Last Data Update",
};

const SKIP_COLUMNS = new Set(["id", "created_at", "updated_at"]);

function labelFor(key: string) {
  return COLUMN_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildCsv(rows: ExportRow[], columns: string[], delimiter: string) {
  const escape = (v: unknown) => {
    const s = String(v ?? "")
      .replace(/\r?\n/g, " ")
      .trim();
    return /["\n;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(labelFor(c))).join(delimiter)];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(delimiter));
  }
  return "\uFEFF" + lines.join("\r\n");
}

function download(content: string, filename: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Splits one CSV text into rows, honouring quoted fields and ; , or tab. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/)[0] ?? "";
  const counts: Array<[string, number]> = [
    [";", (first.match(/;/g) ?? []).length],
    [",", (first.match(/,/g) ?? []).length],
    ["\t", (first.match(/\t/g) ?? []).length],
  ];
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0]![0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (c === "\r") continue;
    field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Maps a CSV header cell back to a database column name. */
export function keyForHeader(header: string): string | null {
  const h = header.trim();
  if (!h) return null;
  const byLabel = Object.entries(COLUMN_LABELS).find(
    ([, label]) => label.toLowerCase() === h.toLowerCase(),
  );
  if (byLabel) return byLabel[0];
  const snake = h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (snake === "id") return "id";
  if (Object.prototype.hasOwnProperty.call(COLUMN_LABELS, snake)) return snake;
  return snake || null;
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const keys = rows[0]!.map(keyForHeader);
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k) obj[k] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}

export function ToolsView({
  cards,
  filteredCards,
  onImport,
}: {
  cards: ExportRow[];
  filteredCards?: ExportRow[];
  onImport?: (
    rows: Record<string, string>[],
  ) => Promise<{ updated: number; created: number; unchanged: number; errors: string[] }>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    updated: number;
    created: number;
    unchanged: number;
    errors: string[];
  } | null>(null);

  const handleFile = async (file: File) => {
    setResult(null);
    setImporting(true);
    try {
      const rows = csvToObjects(await file.text());
      if (!rows.length) {
        toast.error("No data rows found in the file.");
        return;
      }
      if (!onImport) {
        toast.error("Import is not available here.");
        return;
      }
      const res = await onImport(rows);
      setResult(res);
      toast.success(
        `Import finished: ${res.updated} updated, ${res.created} added, ${res.unchanged} unchanged.`,
      );
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of cards)
      for (const k of Object.keys(row)) if (!SKIP_COLUMNS.has(k)) keys.add(k);
    const preferred = Object.keys(COLUMN_LABELS).filter((k) => keys.has(k));
    const rest = [...keys].filter((k) => !preferred.includes(k)).sort();
    return [...preferred, ...rest];
  }, [cards]);

  const exportRows = (rows: ExportRow[], name: string, delimiter: string) => {
    if (!rows.length) {
      toast.error("Nothing to export.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    download(buildCsv(rows, columns, delimiter), `${name}-${stamp}.csv`);
    toast.success(`${rows.length} row(s) exported.`);
  };

  const lastUpdate = String(cards[0]?.["data_reference_date"] ?? "—");

  const check = useMemo(() => {
    const conflicts: {
      ta: string;
      stored: string;
      resolved: string;
      evidence: string;
      authority: string;
    }[] = [];
    const unknown = new Set<string>();
    let checked = 0;
    for (const row of cards) {
      const ta = String(row["type_approval_number"] ?? "").trim();
      const stored = String(row["country"] ?? "").trim();
      if (!ta || ta.toLowerCase().startsWith("not identified")) continue;
      checked++;
      const documented = documentedCountry(ta);
      if (!documented) {
        // No documented source (only prefix-based or nothing) → "Land nicht belegt"
        unknown.add(ta);
        continue;
      }
      const conflict = countryConflict(ta, stored);
      if (conflict && !conflicts.some((c) => c.ta === ta && c.stored === stored)) {
        conflicts.push({
          ta,
          stored,
          resolved: conflict.country,
          evidence: conflict.evidence,
          authority: conflict.authority,
        });
      }
    }
    return { conflicts, unknown: [...unknown], checked };
  }, [cards]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-primary" /> Export data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download the consolidated card, certification and procurement data as a CSV file (UTF-8,
            opens directly in Excel). {cards.length} record(s) in the database · last data update{" "}
            {lastUpdate}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportRows(cards, "tachograph-cards", ";")}>
              <Download className="mr-2 h-4 w-4" /> Export all ({cards.length}) · semicolon
            </Button>
            <Button
              variant="outline"
              onClick={() => exportRows(cards, "tachograph-cards-comma", ",")}
            >
              <Download className="mr-2 h-4 w-4" /> Export all · comma
            </Button>
            {filteredCards && (
              <>
                <Button
                  variant="secondary"
                  disabled={filteredCards.length === 0}
                  onClick={() => exportRows(filteredCards, "tachograph-cards-filtered", ";")}
                  title="Only the rows the Data tab currently shows"
                >
                  <Download className="mr-2 h-4 w-4" /> Current filter · CSV ({filteredCards.length}
                  )
                </Button>
                <Button
                  variant="secondary"
                  disabled={filteredCards.length === 0}
                  onClick={() => {
                    const stamp = new Date().toISOString().slice(0, 10);
                    download(
                      JSON.stringify(filteredCards, null, 2),
                      `tachograph-cards-filtered-${stamp}.json`,
                      "application/json;charset=utf-8",
                    );
                    toast.success(`${filteredCards.length} row(s) exported as JSON.`);
                  }}
                  title="Only the rows the Data tab currently shows"
                >
                  <Download className="mr-2 h-4 w-4" /> Current filter · JSON (
                  {filteredCards.length})
                </Button>
              </>
            )}
            <Button
              variant="outline"
              onClick={() => {
                if (!cards.length) {
                  toast.error("Nothing to export.");
                  return;
                }
                const stamp = new Date().toISOString().slice(0, 10);
                download(
                  JSON.stringify(cards, null, 2),
                  `tachograph-cards-${stamp}.json`,
                  "application/json;charset=utf-8",
                );
                toast.success(`${cards.length} row(s) exported as JSON.`);
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export all · JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Columns: {columns.map(labelFor).join(" · ")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" /> Deployment snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Regenerates the two files a fresh deployment starts from. Download both, replace them in
            the repository and commit — the next image build ships the current data instead of the
            original snapshot. Neither file affects a running instance: its database keeps its own
            data.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!cards.length) {
                  toast.error("Nothing to export.");
                  return;
                }
                download(buildOfflineData(cards), "data.json", "application/json;charset=utf-8");
                toast.success(`data.json written with ${cards.length} record(s).`);
              }}
            >
              <Download className="mr-2 h-4 w-4" /> standalone/data.json ({cards.length})
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!cards.length) {
                  toast.error("Nothing to export.");
                  return;
                }
                download(buildSeedSql(cards), "seed_cards.sql", "application/sql;charset=utf-8");
                toast.success(`seed_cards.sql written with ${cards.length} record(s).`);
              }}
            >
              <Download className="mr-2 h-4 w-4" /> db/seed_cards.sql ({cards.length})
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Both exports include the manual edits, and derive flag and ISO code from the country
            field so a corrected record cannot carry its old country&apos;s flag into the next
            build.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" /> Import data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload a CSV file (semicolon, comma or tab separated) using the same columns as the
            export. Existing records are matched by their id — or by Country + Type Approval Number
            + Generation — and only changed fields are updated. Rows without a match are added as
            new records. Empty cells are ignored, never used to clear existing values.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {importing ? "Importing…" : "Import CSV"}
          </Button>
          {result && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                {result.updated} record(s) updated · {result.created} added · {result.unchanged}{" "}
                unchanged
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
                  {result.errors.slice(0, 20).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Country cross-check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Compares every type approval number in the database with the documented country sources
            (type approval PDF, JRC card name). Entries resolved only from the eNN issuer prefix
            appear as "country not documented". {check.checked} record(s) checked ·{" "}
            {check.conflicts.length} conflict(s) · {check.unknown.length} type approval(s) without
            documented country.
          </p>
          {check.conflicts.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="mb-2 text-sm font-medium">Conflicts with documented sources</p>
              <ul className="space-y-1 text-xs">
                {check.conflicts.map((c) => (
                  <li key={`${c.ta}-${c.stored}`}>
                    <span className="font-mono">{c.ta}</span> — stored{" "}
                    <span className="font-medium">{c.stored}</span>, documented{" "}
                    <span className="font-medium">{c.resolved}</span>
                    {c.evidence ? ` · ${c.evidence}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {check.unknown.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Country not documented (issuer prefix only):{" "}
              {check.unknown
                .slice(0, 40)
                .map((ta) =>
                  approvalAuthorityLabel(ta) ? `${ta} [${approvalAuthorityLabel(ta)}]` : ta,
                )
                .join(" · ")}
              {check.unknown.length > 40 ? " …" : ""}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!check.conflicts.length) {
                  toast.error("No conflicts to export.");
                  return;
                }
                const rows = check.conflicts.map((c) => ({
                  type_approval_number: c.ta,
                  stored_country: c.stored,
                  documented_country: c.resolved,
                  evidence: c.evidence,
                  authority: c.authority,
                }));
                const cols = Object.keys(rows[0]!);
                download(
                  buildCsv(rows as ExportRow[], cols, ";"),
                  `country-crosscheck-${new Date().toISOString().slice(0, 10)}.csv`,
                );
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export cross-check ({check.conflicts.length}) ·
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const report = {
                  checked: check.checked,
                  conflicts: check.conflicts.map((c) => ({
                    ta: c.ta,
                    stored: c.stored,
                    documented: c.resolved,
                    evidence: c.evidence,
                    authority: c.authority,
                  })),
                  not_documented: check.unknown,
                };
                download(
                  JSON.stringify(report, null, 2),
                  `country-crosscheck-${new Date().toISOString().slice(0, 10)}.json`,
                  "application/json;charset=utf-8",
                );
                toast.success("Cross-check report exported as JSON.");
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export cross-check · JSON
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
