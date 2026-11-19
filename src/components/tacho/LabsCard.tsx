import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { RecordDetailDialog } from "@/components/tacho/RecordDetailDialog";
import { LAB_PATTERNS, type LabRole } from "@/components/tacho/labs";
import { type TachoCard } from "@/components/tacho/types";

export function LabsCard({ cards }: { cards: TachoCard[] }) {
  // v2.56: the selected lab's countries & evidence show in a panel to the right
  // of the table (scrolls on its own) instead of below it.
  const [open, setOpen] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);

  const labs = useMemo(() => {
    const map: Record<
      string,
      {
        role: LabRole;
        note: string;
        entries: Array<{ card: TachoCard; country: string; generation: string; evidence: string }>;
      }
    > = {};
    for (const c of cards) {
      const fields = [
        c.security_certificate_lab,
        c.security_certificate,
        c.functional_certificate_lab,
        c.jrc_certificate_source,
        c.issued_by_authority,
      ].filter(Boolean);
      for (const lab of LAB_PATTERNS) {
        const hit = fields.find((f) => lab.re.test(String(f)));
        if (!hit) continue;
        if (!map[lab.name]) map[lab.name] = { role: lab.role, note: lab.note, entries: [] };
        map[lab.name].entries.push({
          card: c,
          country: c.country,
          generation: c.generation,
          evidence: String(hit),
        });
      }
    }
    return Object.entries(map)
      .map(([name, v]) => ({
        name,
        ...v,
        entries: [...v.entries].sort(
          (a, b) =>
            (a.country || "").localeCompare(b.country || "") ||
            (a.generation || "").localeCompare(b.generation || ""),
        ),
        count: v.entries.length,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [cards]);

  const unmatched = useMemo(
    () =>
      cards.filter(
        (c) =>
          !LAB_PATTERNS.some((l) =>
            [c.security_certificate_lab, c.functional_certificate_lab, c.security_certificate].some(
              (f) => f && l.re.test(String(f)),
            ),
          ),
      ).length,
    [cards],
  );

  // The largest lab is shown until another one is chosen.
  const current = labs.find((l) => l.name === open) ?? labs[0] ?? null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Laboratories &amp; Certification Bodies — who did what
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Derived from the JRC / certificate fields of each record (security certificate, functional
          certificate, issuing authority). {unmatched} record(s) contain no identifiable lab. Click
          a row to see its countries and evidence.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Lab / Body</th>
                  <th className="py-2 pr-3 font-medium">Used for</th>
                  <th className="py-2 pr-3 text-right font-medium">Records</th>
                </tr>
              </thead>
              <tbody>
                {labs.map((l) => {
                  const active = current?.name === l.name;
                  return (
                    <tr
                      key={l.name}
                      onClick={() => setOpen(l.name)}
                      aria-selected={active}
                      className={
                        "cursor-pointer border-b align-top transition-colors last:border-0 hover:bg-accent/60 " +
                        (active ? "bg-accent" : "")
                      }
                    >
                      <td className="py-2 pl-2 pr-3 font-medium">{l.name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="secondary" className="mb-1">
                          {l.role}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{l.note}</p>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.count}</td>
                    </tr>
                  );
                })}
                {labs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      No laboratory information found in the current data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {current && (
            <div className="rounded-md border bg-muted/30 lg:sticky lg:top-4">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {current.name} — countries &amp; evidence
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {current.entries.length} record{current.entries.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto p-3 text-sm lg:max-h-[70vh]">
                {current.entries.map((e, i) => (
                  <li key={`${e.card.id}-${i}`}>
                    <button
                      type="button"
                      onClick={() => setDetailCard(e.card)}
                      title="Open record"
                      className="flex w-full flex-wrap items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
                    >
                      <span className="font-medium">{e.country || "—"}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {e.generation || "—"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{e.evidence}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </Card>
  );
}
