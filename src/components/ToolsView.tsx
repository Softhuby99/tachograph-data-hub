import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";

export type ExportRow = Record<string, unknown>;

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
  return (
    COLUMN_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
  );
}

function buildCsv(rows: ExportRow[], columns: string[], delimiter: string) {
  const escape = (v: unknown) => {
    const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
    return /["\n;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(labelFor(c))).join(delimiter)];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(delimiter));
  }
  return "\uFEFF" + lines.join("\r\n");
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ToolsView({
  cards,
  filteredCards,
}: {
  cards: ExportRow[];
  filteredCards?: ExportRow[];
}) {
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of cards) for (const k of Object.keys(row)) if (!SKIP_COLUMNS.has(k)) keys.add(k);
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
            Download the consolidated card, certification and procurement data as a CSV file
            (UTF-8, opens directly in Excel). {cards.length} record(s) in the database · last data
            update {lastUpdate}.
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
            {filteredCards && filteredCards.length !== cards.length && (
              <Button
                variant="secondary"
                onClick={() => exportRows(filteredCards, "tachograph-cards-filtered", ";")}
              >
                <Download className="mr-2 h-4 w-4" /> Export current filter (
                {filteredCards.length})
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Columns: {columns.map(labelFor).join(" · ")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
