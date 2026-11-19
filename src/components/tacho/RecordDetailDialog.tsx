import { flagUrl } from "@/lib/country-flag";
import { expiryOf } from "@/lib/expiry";
import { formatQuantities } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";
import { GROUP1_FIELDS } from "@/components/tacho/constants";
import { ExpiryBadge, Field } from "@/components/tacho/shared";
import { type TachoCard } from "@/components/tacho/types";

/**
 * Market share of manufacturers holding the *current* type approval per
 * country/device-type lane — i.e. only status === "current" counts. A cert
 * that is our most-recent record for its lane but has disappeared from JRC
 * ("delisted") is surfaced separately rather than folded into the total,
 * since it is no longer a live market position.
 */
/** Full-record window, opened from any drill-down list (Overview, Current
 * Status, History) — one implementation so every surface shows the same
 * fields in the same layout. */
export function RecordDetailDialog({
  card,
  onClose,
}: {
  card: TachoCard | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="shrink-0" onClick={onClose}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            {card && flagUrl(card.country, 40) && (
              <img
                src={flagUrl(card.country, 40)!}
                alt=""
                className="h-6 w-9 rounded border object-cover"
              />
            )}
            <span>
              {card?.country} · {card?.type_approval_number || "—"}
            </span>
          </DialogTitle>
        </DialogHeader>
        {card && (
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {GROUP1_FIELDS.map(([k, label]) => {
              const key = k as string;
              let value = String((card as Record<string, unknown>)[key] ?? "");
              if (key === "card_quantities") value = formatQuantities(value);
              if (key === "certificate_expiry_date") {
                return (
                  <Field key={key} label={label} value={value}>
                    <ExpiryBadge expiry={expiryOf(value)} />
                  </Field>
                );
              }
              return <Field key={key} label={label} value={value} />;
            })}
            {card.verification_note && (
              <Field
                label="Verification Note"
                value={card.verification_note}
                className="md:col-span-2"
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
