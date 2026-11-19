import { type CSSProperties } from "react";
import { type PartKind } from "@/lib/market-share";
import { PART_LABEL } from "@/components/tacho/constants";

// v2.59: generation bar split own (chip platform vendor holds the approval) /
// via partner / platform unknown — dark vs. light shades of the bar colour.
const GEN_SPLIT_TONES: Record<"dark" | "purple", Record<PartKind, string>> = {
  dark: { own: "bg-primary", partner: "bg-slate-300 dark:bg-slate-500", unknown: "" },
  purple: { own: "bg-purple-600", partner: "bg-purple-300", unknown: "" },
};

const UNKNOWN_HATCH: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(148,163,184,0.55) 0 3px, rgba(148,163,184,0.15) 3px 6px)",
};

export function GenSplitBar({
  parts,
  width,
  tone,
}: {
  parts?: Record<PartKind, number>;
  width: number;
  tone: "dark" | "purple";
}) {
  const p = parts ?? { own: 0, partner: 0, unknown: 0 };
  const sum = p.own + p.partner + p.unknown || 1;
  return (
    <div className="flex h-full transition-all" style={{ width: `${width}%` }}>
      {(["own", "partner", "unknown"] as PartKind[]).map((k) =>
        p[k] ? (
          <div
            key={k}
            className={`h-full ${GEN_SPLIT_TONES[tone][k]}`}
            style={{ width: `${(p[k] / sum) * 100}%`, ...(k === "unknown" ? UNKNOWN_HATCH : {}) }}
            title={`${PART_LABEL[k]}: ${p[k]}`}
          />
        ) : null,
      )}
    </div>
  );
}

export function GenSplitLegend({ tone }: { tone: "dark" | "purple" }) {
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
      {(["own", "partner", "unknown"] as PartKind[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span
            className={`inline-block h-2.5 w-4 rounded-sm ${GEN_SPLIT_TONES[tone][k]}`}
            style={k === "unknown" ? UNKNOWN_HATCH : undefined}
          />
          {k === "own" ? "own approval" : k === "partner" ? "via partner" : "platform unknown"}
        </span>
      ))}
    </div>
  );
}
