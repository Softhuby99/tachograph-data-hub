import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deletePlatformLineFn,
  getPlatformLines,
  savePlatformLineFn,
} from "@/lib/platform.functions";
import { parseCertificate } from "@/lib/cert-family";
import type { PlatformLine } from "@/lib/platform-timeline";

// v2.55: Tools → Platform lines (admin). Which certificate families form one
// security platform line, and which platform / chip / OS texts let a card
// without a certificate be shown as "derived" in it. Saving is admin-checked
// on the server; a family can belong to one line only.

type Draft = {
  id?: string;
  name: string;
  vendor: string;
  families: string;
  patterns: string;
  note: string;
  sort: string;
};

const toDraft = (l?: PlatformLine): Draft => ({
  id: l?.id,
  name: l?.name ?? "",
  vendor: l?.vendor ?? "",
  families: (l?.families ?? []).join(", "),
  patterns: (l?.patterns ?? []).join(", "),
  note: l?.note ?? "",
  sort: String(l?.sort ?? 0),
});
const list = (v: string) =>
  v
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function PlatformLinesView({ cards }: { cards: Record<string, unknown>[] }) {
  const qc = useQueryClient();
  const fetchLines = useServerFn(getPlatformLines);
  const saveFn = useServerFn(savePlatformLineFn);
  const deleteFn = useServerFn(deletePlatformLineFn);
  const q = useQuery({
    queryKey: ["platform_lines"],
    queryFn: async () => (await fetchLines()) as PlatformLine[],
  });
  const lines = q.data ?? [];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState<Draft | null>(null);

  const familyCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      if ((String(c["device_type"] ?? "").trim() || "Card") !== "Card") continue;
      const ref = parseCertificate(c["security_certificate"]);
      if (ref) m.set(ref.family, (m.get(ref.family) ?? 0) + 1);
    }
    return m;
  }, [cards]);
  const assigned = new Set(lines.flatMap((l) => l.families));
  const unassigned = [...familyCounts.entries()]
    .filter(([f]) => !assigned.has(f))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const save = useMutation({
    mutationFn: async (d: Draft) =>
      await saveFn({
        data: {
          id: d.id,
          name: d.name,
          vendor: d.vendor,
          families: list(d.families),
          patterns: list(d.patterns),
          note: d.note,
          sort: Number(d.sort) || 0,
        },
      }),
    onSuccess: (saved) => {
      toast.success(`Platform line "${saved.name}" saved.`);
      setDrafts((all) => {
        const next = { ...all };
        delete next[saved.id];
        return next;
      });
      setAdding(null);
      void qc.invalidateQueries({ queryKey: ["platform_lines"] });
    },
    onError: (e: Error) => toast.error(`Saving failed: ${e.message}`),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => await deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Platform line deleted.");
      void qc.invalidateQueries({ queryKey: ["platform_lines"] });
    },
    onError: (e: Error) => toast.error(`Deleting failed: ${e.message}`),
  });

  const assignTo = (family: string, lineId: string) => {
    const l = lines.find((x) => x.id === lineId);
    if (!l) return;
    save.mutate(toDraft({ ...l, families: [...l.families, family] }));
  };

  const editor = (d: Draft, onChange: (d: Draft) => void, onCancel?: () => void) => (
    <div className="grid gap-2 md:grid-cols-2">
      <label className="text-xs">
        Name
        <Input
          value={d.name}
          onChange={(e) => onChange({ ...d, name: e.target.value })}
          className="mt-1 h-8"
        />
      </label>
      <label className="text-xs">
        Platform vendor
        <Input
          value={d.vendor}
          onChange={(e) => onChange({ ...d, vendor: e.target.value })}
          className="mt-1 h-8"
        />
      </label>
      <label className="text-xs md:col-span-2">
        Certificate families (comma separated, e.g. ANSSI-CC-2022/38)
        <Input
          value={d.families}
          onChange={(e) => onChange({ ...d, families: e.target.value })}
          className="mt-1 h-8"
        />
      </label>
      <label className="text-xs md:col-span-2">
        Platform texts for cards without a certificate (comma separated, case-insensitive)
        <Input
          value={d.patterns}
          onChange={(e) => onChange({ ...d, patterns: e.target.value })}
          className="mt-1 h-8"
        />
      </label>
      <label className="text-xs">
        Note
        <Input
          value={d.note}
          onChange={(e) => onChange({ ...d, note: e.target.value })}
          className="mt-1 h-8"
        />
      </label>
      <label className="text-xs">
        Order
        <Input
          value={d.sort}
          onChange={(e) => onChange({ ...d, sort: e.target.value })}
          className="mt-1 h-8 w-24"
        />
      </label>
      <div className="flex gap-2 md:col-span-2">
        <Button
          size="sm"
          onClick={() => save.mutate(d)}
          disabled={save.isPending || !d.name.trim()}
        >
          <Save className="mr-2 h-4 w-4" /> Save
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-primary" /> Platform lines
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding(toDraft())}
              disabled={!!adding}
            >
              <Plus className="mr-2 h-4 w-4" /> Add line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            A line groups the certificate families of one security platform; the Platform Timeline
            orders them by certificate date. A family belongs to one line only — assigning it here
            removes it from any other line. Platform texts are only used for cards without a
            security certificate (shown as “derived”).
          </p>
          {adding && (
            <div className="rounded-md border p-3">
              {editor(adding, setAdding, () => setAdding(null))}
            </div>
          )}
          {lines.map((l) => {
            const d = drafts[l.id];
            return (
              <div key={l.id} className="rounded-md border p-3">
                {d ? (
                  editor(
                    d,
                    (next) => setDrafts((all) => ({ ...all, [l.id]: next })),
                    () =>
                      setDrafts((all) => {
                        const next = { ...all };
                        delete next[l.id];
                        return next;
                      }),
                  )
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <div>
                      <div className="font-medium">
                        {l.name}
                        {l.vendor && (
                          <span className="ml-2 text-xs text-muted-foreground">{l.vendor}</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs">
                        {l.families.length === 0 ? (
                          <span className="text-muted-foreground">no certificate families</span>
                        ) : (
                          l.families.map((f) => (
                            <span
                              key={f}
                              className="mr-1 inline-block rounded border px-1.5 py-0.5"
                            >
                              {f}{" "}
                              <span className="text-muted-foreground">
                                ({familyCounts.get(f) ?? 0})
                              </span>
                            </span>
                          ))
                        )}
                      </div>
                      {l.patterns.length > 0 && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Platform texts: {l.patterns.join(", ")}
                        </div>
                      )}
                      {l.note && (
                        <div className="mt-1 text-[11px] text-muted-foreground">{l.note}</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDrafts((all) => ({ ...all, [l.id]: toDraft(l) }))}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete platform line "${l.name}"? Its families become "not assigned".`,
                            )
                          )
                            remove.mutate(l.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!q.isLoading && lines.length === 0 && (
            <p className="text-sm text-muted-foreground">No platform lines yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Certificate families not assigned to a line ({unassigned.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unassigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every certificate family in the card records belongs to a line.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Family</th>
                  <th className="py-2 pr-3 text-right font-medium">Card approvals</th>
                  <th className="py-2 pr-3 font-medium">Assign to</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map(([family, n]) => (
                  <tr key={family} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{family}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{n}</td>
                    <td className="py-1.5 pr-3">
                      <select
                        className="h-7 rounded-md border bg-background px-2 text-xs"
                        value=""
                        onChange={(e) => e.target.value && assignTo(family, e.target.value)}
                        disabled={save.isPending || lines.length === 0}
                      >
                        <option value="">choose a line…</option>
                        {lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
