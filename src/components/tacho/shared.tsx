import { expiryLabel, needsAttention, type Expiry } from "@/lib/expiry";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, AlertTriangle } from "lucide-react";

/** Validity of a certificate in one badge; renders nothing without a date. */
export function ExpiryBadge({ expiry, compact = false }: { expiry: Expiry; compact?: boolean }) {
  if (expiry.state === "unknown" || !expiry.date) return null;
  const critical = expiry.state === "expired" || expiry.state === "critical";
  if (!needsAttention(expiry)) {
    if (compact) return null;
    return (
      <span className="text-xs text-muted-foreground">
        valid until {expiry.date.toISOString().slice(0, 10)}
      </span>
    );
  }
  return (
    <Badge
      variant={critical ? "destructive" : "outline"}
      className={"gap-1 text-xs font-normal " + (critical ? "" : "border-amber-500 text-amber-600")}
      title={`Certificate validity ends ${expiry.date.toISOString().slice(0, 10)}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {compact ? (expiry.state === "expired" ? "expired" : `${expiry.days}d`) : expiryLabel(expiry)}
    </Badge>
  );
}

export function Field({
  label,
  value,
  sub,
  className,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  className?: string;
  /** Rendered next to the value — used for the certificate validity badge. */
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm whitespace-pre-wrap">
        {value?.trim() ? value : <span className="text-muted-foreground">—</span>}
        {children}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function LinkField({
  label,
  value,
  className,
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  const links = (value ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {links.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-col gap-1">
          {links.map((l) =>
            l.startsWith("http") ? (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 break-all text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="break-all">{l}</span>
              </a>
            ) : (
              <span key={l} className="text-sm">
                {l}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
