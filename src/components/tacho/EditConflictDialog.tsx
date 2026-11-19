import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GROUP1_FIELDS } from "@/components/tacho/constants";

export type SaveEditResult =
  | { ok: true; applied?: string[]; cleared?: boolean }
  | { ok: false; conflicts: { field: string; original: string; theirs: string; yours: string }[] };

const FIELD_LABEL = new Map<string, string>(
  GROUP1_FIELDS.map(([k, label]) => [k as string, label]),
);

/**
 * v2.54 (code review 18): someone else saved the same field while this edit
 * was open. Nothing was written; the editor chooses per save.
 */
export function EditConflictDialog({
  conflict,
  onKeepTheirs,
  onOverwrite,
}: {
  conflict: {
    conflicts: { field: string; original: string; theirs: string; yours: string }[];
  } | null;
  onKeepTheirs: () => void;
  onOverwrite: () => void;
}) {
  return (
    <Dialog open={!!conflict} onOpenChange={(o) => !o && onKeepTheirs()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Someone else changed this record meanwhile</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Nothing was saved. These fields were changed by someone else after you started editing:
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 font-medium">When you started</th>
                <th className="px-2 py-1.5 font-medium">Saved now</th>
                <th className="px-2 py-1.5 font-medium">Yours</th>
              </tr>
            </thead>
            <tbody>
              {(conflict?.conflicts ?? []).map((c) => (
                <tr key={c.field} className="border-t align-top">
                  <td className="px-2 py-1.5 font-medium">{FIELD_LABEL.get(c.field) ?? c.field}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{c.original || "—"}</td>
                  <td className="px-2 py-1.5">{c.theirs || "—"}</td>
                  <td className="px-2 py-1.5 font-medium">{c.yours || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onKeepTheirs}>
            Keep saved values
          </Button>
          <Button onClick={onOverwrite}>Overwrite with mine</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
