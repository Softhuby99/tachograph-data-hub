import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCardChangeHistory, clearCardChangeHistory } from "@/lib/cards.functions";
import {
  MARKET_STATUS_LABEL,
  MARKET_STATUS_BADGE_CLASS,
  type MarketStatus,
} from "@/lib/market-status";
import { flagUrl } from "@/lib/country-flag";
import { expiryOf } from "@/lib/expiry";
import { formatQuantities } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, FileText, Building2, Pencil, Trash2, History } from "lucide-react";
import { parseCertificate } from "@/lib/cert-family";
import { DEVICE_TYPES, GROUP1_FIELDS } from "@/components/tacho/constants";
import { LAB_PATTERNS, type LabRole } from "@/components/tacho/labs";
import { ExpiryBadge, Field, LinkField } from "@/components/tacho/shared";
import { type TachoCard } from "@/components/tacho/types";

/** Parse the first dd.mm.yyyy (or yyyy-mm-dd) date found in a free-text status field. */
function parseApprovalDate(text: string): Date | null {
  if (!text) return null;
  const dmy = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const ymd = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const y = /\b(19|20)\d{2}\b/.exec(text);
  if (y) return new Date(Number(y[0]), 0, 1);
  return null;
}

const TIMELINE_FIELDS: Array<[keyof TachoCard, string]> = [
  ["application", "Application"],
  ["type_approval_number", "Type Approval Number"],
  ["issued_by_authority", "Issued by Authority"],
  ["date_status", "Date / Status"],
  ["certificate_holder", "Certificate Holder"],
  ["chip_platform_vendor", "Chip / Platform Vendor"],
  ["security_certificate", "Security Certificate"],
  ["certificate_issued_date", "Date Certificate Issued"],
  ["certificate_expiry_date", "Certificate Validity Expiration Date"],
  ["jrc_interoperability_status", "JRC Interoperability Status"],
  ["latest_tender", "Latest Tender"],
  ["procurement_status", "Procurement Status"],
];

export function ManufacturerTimeline({
  manufacturer,
  cards,
}: {
  manufacturer: string;
  cards: TachoCard[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "name">("date");

  const entries = useMemo(() => {
    const list = cards.map((c) => ({ card: c, date: parseApprovalDate(c.date_status) }));
    if (sortBy === "name") {
      return list.sort((a, b) => a.card.country.localeCompare(b.card.country));
    }
    return list.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.getTime() - b.date.getTime();
    });
  }, [cards, sortBy]);

  const dated = entries.filter((e) => e.date);
  const years = dated.length
    ? `${dated[0].date!.getFullYear()} – ${dated[dated.length - 1].date!.getFullYear()}`
    : "no dates available";

  if (entries.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          Approval timeline — {manufacturer}
          <Badge variant="secondary">{entries.length} countries</Badge>
          <span className="text-xs font-normal text-muted-foreground">{years}</span>
          <div className="ml-auto flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <Button
              type="button"
              size="sm"
              variant={sortBy === "date" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setSortBy("date")}
            >
              Date
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sortBy === "name" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setSortBy("name")}
            >
              Name
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-2 border-l pl-6">
          {entries.map(({ card: c, date }) => {
            const open = openId === c.id;
            const fUrl = flagUrl(c.country, 40);
            return (
              <li key={c.id} className="relative">
                <span className="absolute -left-[27px] top-4 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : c.id)}
                  className={
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent " +
                    (open ? "bg-accent" : "bg-card")
                  }
                >
                  <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                    {date
                      ? date.toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "unknown"}
                  </span>
                  {fUrl ? (
                    <img
                      src={fUrl}
                      alt={`${c.country} flag`}
                      width={32}
                      height={24}
                      loading="lazy"
                      className="h-6 w-8 shrink-0 rounded-sm border object-cover shadow-sm"
                    />
                  ) : (
                    <span className="text-xl leading-none">{c.country_flag}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{c.country}</span>
                  <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">
                    {c.type_approval_number || "—"}
                  </span>
                  <Badge variant="secondary">{c.generation}</Badge>
                </button>
                {open && (
                  <dl className="mt-1 grid gap-x-6 gap-y-2 rounded-md border bg-muted/40 px-4 py-3 text-sm sm:grid-cols-2">
                    {TIMELINE_FIELDS.map(([key, label]) => (
                      <div key={String(key)}>
                        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                        <dd className="break-words">{String(c[key] ?? "") || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

// v2.88: the fields form as many columns as the detail pane has room for
// (container query) — two on a laptop, three or four on a wide screen.
const FIELD_GRID = "grid gap-x-6 gap-y-3 md:grid-cols-2 @5xl:grid-cols-3 @[100rem]:grid-cols-4";
const FIELD_WIDE = "md:col-span-2 @5xl:col-span-full";

export function DetailView({
  card,
  edited,
  canEdit,
  editHint,
  onSave,
  onReset,
  marketStatus,
  onShowTimeline,
}: {
  card: TachoCard;
  edited: boolean;
  canEdit: boolean;
  editHint: string;
  onSave: (patch: Partial<TachoCard>, original?: Record<string, string>) => void;
  onReset: () => void;
  marketStatus?: MarketStatus;
  onShowTimeline?: (certificate: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // v2.54 (code review 18): what the record showed when editing started — the
  // server only writes fields that differ from it and reports a conflict when
  // someone else changed the same field meanwhile.
  const [original, setOriginal] = useState<Record<string, string>>({});

  useEffect(() => {
    setEditing(false);
    setDraft({});
  }, [card.id]);

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const [k] of GROUP1_FIELDS) {
      d[k as string] = String((card as Record<string, unknown>)[k as string] ?? "");
    }
    setDraft(d);
    setOriginal(d);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft({});
  };
  const save = () => {
    onSave(draft as Partial<TachoCard>, original);
    setEditing(false);
  };

  return (
    <div className="@container space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        {flagUrl(card.country, 80) ? (
          <img
            src={flagUrl(card.country, 80)!}
            alt={`${card.country} flag`}
            width={64}
            height={48}
            className="h-12 w-16 shrink-0 rounded-md border object-cover shadow-sm"
          />
        ) : (
          <span className="text-4xl leading-none">{card.country_flag}</span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-2xl font-semibold">
            {card.country || card.tachograph_application_os || card.current_manufacturer || "—"}
            {edited && (
              <Badge variant="outline" className="ml-2 align-middle text-xs">
                edited
              </Badge>
            )}
          </h2>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge>{card.generation || "—"}</Badge>
            {card.tachograph_application_os && (
              <Badge variant="outline">{card.tachograph_application_os}</Badge>
            )}
            {marketStatus && (
              <Badge
                variant="outline"
                className={MARKET_STATUS_BADGE_CLASS[marketStatus]}
                title="Market status — see the Market Analytics tab"
              >
                {MARKET_STATUS_LABEL[marketStatus]}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Group 1 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Card &amp; Certification
            </CardTitle>
            <div className="flex gap-2">
              {!editing && canEdit && (
                <Button size="sm" variant="outline" onClick={startEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                </Button>
              )}
              {!editing && !canEdit && (
                <span className="text-xs text-muted-foreground">{editHint}</span>
              )}
              {editing && (
                <>
                  <Button size="sm" onClick={save}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancel}>
                    Cancel
                  </Button>
                  {edited && (
                    <Button size="sm" variant="ghost" onClick={onReset}>
                      Reset
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className={FIELD_GRID}>
          {GROUP1_FIELDS.map(([k, label]) => {
            const key = k as string;
            let value = String((card as Record<string, unknown>)[key] ?? "");
            if (key === "card_quantities") value = formatQuantities(value);
            if (editing) {
              return (
                <div key={key} className="md:col-span-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  {key === "device_type" ? (
                    // A fixed set of values: typed by hand, "vehicle unit" and
                    // "VU" would end up as separate categories.
                    <Select
                      value={draft[key] || "Card"}
                      onValueChange={(v) => setDraft({ ...draft, [key]: v })}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEVICE_TYPES.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Textarea
                      className="mt-1 min-h-[40px] text-sm"
                      value={draft[key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    />
                  )}
                  {key === "security_certificate" && (
                    // v2.55: the Platform Timeline reads the family from this text.
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      One certificate number as on the type approval, e.g. ANSSI-CC-2022/38-M01,
                      NSCIB-CC-22-0635023, BSI-DSZ-CC-0889. Continuations as -M01 / -R01 / -S02.
                      {draft[key]?.trim() &&
                        (parseCertificate(draft[key])
                          ? ` Recognised: ${parseCertificate(draft[key])!.family}.`
                          : " Not recognised as a certificate number.")}
                    </p>
                  )}
                </div>
              );
            }
            if (key === "jrc_certificate_source" || key === "primary_source") {
              return <LinkField key={key} label={label} value={value} className={FIELD_WIDE} />;
            }
            if (key === "certificate_expiry_date") {
              return (
                <Field key={key} label={label} value={value}>
                  <ExpiryBadge expiry={expiryOf(value)} />
                </Field>
              );
            }
            if (key === "security_certificate" && onShowTimeline && parseCertificate(value)) {
              return (
                <Field key={key} label={label} value={value}>
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => onShowTimeline(value)}
                  >
                    Platform timeline →
                  </button>
                </Field>
              );
            }
            return <Field key={key} label={label} value={value} />;
          })}
          {!editing && (
            <div className={FIELD_WIDE}>
              <CertificationChainPanel card={card} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Group 2 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Procurement
          </CardTitle>
        </CardHeader>
        <CardContent className={FIELD_GRID}>
          <Field
            label="Latest Tender / Procurement Procedure"
            value={card.latest_tender}
            className={FIELD_WIDE}
          />
          <Field label="Winner / Contractor" value={card.winner_contractor} />
          <Field label="Procurement Status / Assessment" value={card.procurement_status} />
          {card.procurement_scope && (
            <Field
              label="Scope / Assessment"
              value={card.procurement_scope}
              className={FIELD_WIDE}
            />
          )}
          <LinkField
            label="Tender / Procurement Source"
            value={card.tender_source}
            className={FIELD_WIDE}
          />
        </CardContent>
      </Card>

      {card.verification_note && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Verification Note
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{card.verification_note}</p>
          </CardContent>
        </Card>
      )}

      <HistoryCard cardId={card.id} canEdit={canEdit} />
    </div>
  );
}

const HISTORY_ORIGINS: Record<string, string> = {
  manual: "Manual edit",
  jrc_proposal: "Approved proposal",
  jrc_sync: "JRC synchronisation",
  csv_import: "CSV import",
  reset: "Manual edits removed",
  data_correction: "Data correction",
  consistency_fix: "Consistency repair",
};

/** v2.77: a readable origin for every entry — "jrc_audit_2026-10-01_cc_fill" was shown as is. */
function historyOrigin(origin: string): string {
  if (HISTORY_ORIGINS[origin]) return HISTORY_ORIGINS[origin];
  const audit = /^jrc_audit_(\d{4})-(\d{2})-(\d{2})/.exec(origin);
  if (audit) return `Data audit ${audit[3]}.${audit[2]}.${audit[1]}`;
  return origin.replace(/_/g, " ");
}

/** Field labels are defined for group 1; fall back to the raw column name. */
const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  GROUP1_FIELDS.map(([k, label]) => [String(k), label]),
);

type HistoryRow = {
  id: string;
  field: string;
  old_value: string;
  new_value: string;
  origin: string;
  source_label: string;
  source_url: string;
  created_at: string;
};

/**
 * Change history of one card. Answers "why does this record say that?" —
 * until now the override table only kept the current values, so a corrected
 * field left no trace of what it held before or where the change came from.
 */
function HistoryCard({ cardId, canEdit }: { cardId: string; canEdit: boolean }) {
  const fetchHistory = useServerFn(getCardChangeHistory);
  const clearHistory = useServerFn(clearCardChangeHistory);
  const qc = useQueryClient();
  const [clearing, setClearing] = useState(false);
  const history = useQuery({
    queryKey: ["card_field_history", cardId],
    queryFn: async (): Promise<HistoryRow[]> =>
      (await fetchHistory({ data: { cardId } })) as HistoryRow[],
  });

  const rows = history.data ?? [];
  if (history.isLoading || rows.length === 0) return null;

  // v2.77: the list of earlier changes can be deleted per record. The values
  // of the record stay as they are.
  const onClear = async () => {
    if (
      !window.confirm(
        `Delete the change history of this record (${rows.length} entr${rows.length === 1 ? "y" : "ies"})?\n\n` +
          "The data of the record is not changed. This cannot be undone.",
      )
    )
      return;
    setClearing(true);
    try {
      const r = await clearHistory({ data: { cardId } });
      toast.success(`Change history deleted (${r.removed} entr${r.removed === 1 ? "y" : "ies"})`);
      await qc.invalidateQueries({ queryKey: ["card_field_history", cardId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The history could not be deleted");
    } finally {
      setClearing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Change History
          <Badge variant="outline" className="ml-1 text-xs font-normal">
            {rows.length}
          </Badge>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs font-normal"
              onClick={onClear}
              disabled={clearing}
              title="Deletes the list of earlier changes of this record. The data itself is not changed."
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {clearing ? "Deleting…" : "Delete history"}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Field</th>
                <th className="py-2 pr-4 font-medium">Change</th>
                <th className="py-2 pr-4 font-medium">Origin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 font-medium">{FIELD_LABELS[r.field] ?? r.field}</td>
                  <td className="py-2 pr-4">
                    <span className="text-muted-foreground line-through">{r.old_value || "—"}</span>{" "}
                    <span aria-hidden>→</span> <span>{r.new_value || "—"}</span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {historyOrigin(r.origin)}
                    {r.source_label && ` · ${r.source_label}`}
                    {r.source_url && (
                      <>
                        {" "}
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          source
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** e-number prefix of a type approval number -> approving authority. */
const E_NUMBER_AUTHORITY: Record<string, string> = {
  e1: "KBA (Germany)",
  e2: "France (ministère chargé des transports / UTAC)",
  e3: "Italy (MIT)",
  e4: "RDW (Netherlands)",
  e5: "Transportstyrelsen / TSV (Sweden)",
  e6: "Belgium (FPS Mobility)",
  e7: "Hungary (NKH/KTI)",
  e8: "Czech Republic (Ministry of Transport)",
  e9: "Spain (Ministerio de Industria)",
  e11: "United Kingdom (VCA/DVSA)",
  e12: "Austria (BMK)",
  e13: "Luxembourg (SNCA)",
  e17: "Finland (Traficom)",
  e19: "Romania (RAR)",
  e20: "Poland (TDT)",
  e21: "Portugal (IMT)",
  e23: "Greece",
  e24: "Ireland (RSA)",
  e25: "Croatia (CVH)",
  e26: "Slovenia",
  e27: "Slovakia",
  e29: "Estonia",
  e32: "Latvia (CSDD)",
  e34: "Bulgaria",
  e36: "Lithuania",
};

type ChainItem = { label: string; value: string; evidence?: string; note?: string };

function certificationChain(card: TachoCard): {
  typeApproval: ChainItem[];
  security: ChainItem[];
  functional: ChainItem[];
} {
  const match = (role: LabRole, fields: Array<[string, string]>): ChainItem[] => {
    const out: ChainItem[] = [];
    for (const lab of LAB_PATTERNS) {
      if (lab.role !== role) continue;
      const hit = fields.find(([, v]) => v && lab.re.test(v));
      if (!hit) continue;
      out.push({ label: lab.name, value: hit[1], evidence: hit[0], note: lab.note });
    }
    return out;
  };

  const ta: ChainItem[] = [];
  const num = (card.type_approval_number || "").trim();
  const eMatch = /\be\s?(\d{1,2})\b/i.exec(num);
  const authority = eMatch ? E_NUMBER_AUTHORITY[`e${eMatch[1]}`] : undefined;
  if (card.issued_by_authority) {
    ta.push({
      label: "Type approval authority",
      value: card.issued_by_authority,
      evidence: "Issued by Authority",
    });
  }
  if (authority) {
    ta.push({
      label: "Derived from approval number",
      value: authority,
      evidence: num,
      note: `The "e${eMatch![1]}" prefix identifies the approving member-state authority.`,
    });
  }
  if (!ta.length && num) {
    ta.push({ label: "Type approval number", value: num, evidence: "no authority identifiable" });
  }

  const security = match("Security evaluation / certification", [
    ["Security Certificate Lab", card.security_certificate_lab],
    ["Security Certificate", card.security_certificate],
    ["Chip Certificate", card.chip_certificate],
    ["Certified Security Platform", card.certified_security_platform],
    ["Date Certificate Issued", card.certificate_issued_date],
    ["Certificate Validity Expiration Date", card.certificate_expiry_date],
  ]);

  const functional = match("Functional & interoperability certificate", [
    ["Functional Certificate Lab", card.functional_certificate_lab],
    ["JRC Interoperability Status", card.jrc_interoperability_status],
    ["JRC / Certificate Source", card.jrc_certificate_source],
    ["Issued by Authority", card.issued_by_authority],
    ["Type Approval Number", card.type_approval_number],
  ]);

  return { typeApproval: ta, security, functional };
}

function ChainGroup({ title, items, empty }: { title: string; items: ChainItem[]; empty: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-2">
          {items.map((it, i) => (
            <li key={`${it.label}-${i}`} className="rounded-md border bg-card px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{it.label}</span>
                {it.evidence && (
                  <Badge variant="outline" className="text-[10px]">
                    {it.evidence}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 break-words text-sm">{it.value}</p>
              {it.note && <p className="mt-0.5 text-xs text-muted-foreground">{it.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CertificationChainPanel({ card }: { card: TachoCard }) {
  const chain = useMemo(() => certificationChain(card), [card]);
  return (
    <div className="mt-4 rounded-md border bg-muted/30 p-3">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">
          Certification chain — who tested / approved what
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <ChainGroup
          title="Type approval"
          items={chain.typeApproval}
          empty="No approving authority identifiable."
        />
        <ChainGroup
          title="Security evaluation (Common Criteria)"
          items={chain.security}
          empty="No security lab / scheme identifiable."
        />
        <ChainGroup
          title="Functional & interoperability"
          items={chain.functional}
          empty="No functional / interoperability body identifiable."
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Derived from the certificate fields of this record; the badge shows the source field the
        match came from. Cross-check details in the Market Analytics → Laboratories section.
      </p>
    </div>
  );
}
