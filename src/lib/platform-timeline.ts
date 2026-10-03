// v2.55: Platform Timeline — model (pure, shared by view and export).
//
// Agreed 02.10.2026 (claude/platform-timeline-plan-2026-10-02.md):
//  - unit = security platform line spanning several certificate families,
//    assigned in the admin-maintained platform line table;
//  - a country's point in time = the type approval date (Date / Status);
//  - cards only; all approvals including superseded / delisted ones;
//  - cards without a certificate are shown as "derived" only when a platform /
//    chip / OS text matches a pattern of the line — never via the manufacturer.

import {
  firstDate,
  parseCertificate,
  certLabel,
  SUFFIX_KIND,
  type CertRef,
} from "@/lib/cert-family";

export type PlatformLine = {
  id: string;
  name: string;
  vendor: string;
  families: string[];
  patterns: string[];
  note: string;
  sort: number;
};

export type TimelineStatus = "current" | "superseded" | "delisted" | "unmatched" | "unknown";

export type TimelineCardInput = {
  id: string;
  country?: string | null;
  device_type?: string | null;
  generation?: string | null;
  type_approval_number?: string | null;
  current_manufacturer?: string | null;
  date_status?: string | null;
  security_certificate?: string | null;
  certificate_issued_date?: string | null;
  certificate_expiry_date?: string | null;
  certified_security_platform?: string | null;
  chip_platform_vendor?: string | null;
  chip_certificate?: string | null;
  tachograph_application_os?: string | null;
  application?: string | null;
};

export type TimelineApproval = {
  cardId: string;
  country: string;
  /** Countries named in the record ("Bulgaria, Poland" → two). */
  countries: string[];
  date: Date | null;
  generation: string;
  typeApproval: string;
  manufacturer: string;
  certText: string;
  cert: CertRef | null;
  certLabel: string;
  family: string;
  status: TimelineStatus;
  derived: boolean;
  /** Family this country used before (platform change within the line). */
  switchedFrom: string;
};

export type TimelineMilestone = { suffix: string; kind: string; date: Date | null };

export type TimelineFamily = {
  family: string;
  issued: Date | null;
  expiry: Date | null;
  milestones: TimelineMilestone[];
  approvals: TimelineApproval[];
  colorIndex: number;
};

export type TimelineLine = {
  key: string;
  name: string;
  vendor: string;
  note: string;
  assigned: boolean;
  families: TimelineFamily[];
  derived: TimelineApproval[];
  /** All approvals (families + derived), newest last. */
  all: TimelineApproval[];
  countries: number;
  firstYear: number | null;
  lastYear: number | null;
};

/** Line colours: neutral, distinct from the generation colours (amber/purple/green). */
export const FAMILY_COLORS = [
  "#38bdf8",
  "#f472b6",
  "#a3a3a3",
  "#818cf8",
  "#fb7185",
  "#2dd4bf",
  "#e2e8f0",
];
export const GEN_COLORS: Record<string, string> = {
  G1: "#f59e0b",
  "G2.1": "#c084fc",
  "G2.2": "#34d399",
};

const s = (v: unknown) => String(v ?? "").trim();

export function splitCountries(value: string): string[] {
  const v = s(value);
  if (!v) return [];
  return v
    .split(/\s*(?:,|;|\/|\+|&)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

export function buildPlatformTimeline(
  cards: TimelineCardInput[],
  lines: PlatformLine[],
  statusById?: Map<string, { status: string }>,
): TimelineLine[] {
  const ordered = [...lines].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const byFamily = new Map<string, PlatformLine>();
  for (const l of ordered) for (const f of l.families) if (!byFamily.has(f)) byFamily.set(f, l);

  type Acc = {
    line: PlatformLine | null;
    key: string;
    fams: Map<string, TimelineApproval[]>;
    derived: TimelineApproval[];
  };
  const acc = new Map<string, Acc>();
  const bucket = (key: string, line: PlatformLine | null) => {
    let a = acc.get(key);
    if (!a) {
      a = { line, key, fams: new Map(), derived: [] };
      acc.set(key, a);
    }
    return a;
  };

  for (const c of cards) {
    if ((s(c.device_type) || "Card") !== "Card") continue;
    const certText = s(c.security_certificate);
    const cert = parseCertificate(certText);
    const base: Omit<TimelineApproval, "family" | "derived"> = {
      cardId: c.id,
      country: s(c.country),
      countries: splitCountries(s(c.country)),
      date: firstDate(c.date_status),
      generation: s(c.generation),
      typeApproval: s(c.type_approval_number),
      manufacturer: s(c.current_manufacturer),
      certText,
      cert,
      certLabel: cert ? certLabel(cert) : "",
      status: (statusById?.get(c.id)?.status as TimelineStatus) ?? "unknown",
      switchedFrom: "",
    };
    if (cert) {
      const line = byFamily.get(cert.family) ?? null;
      const a = bucket(line ? `line:${line.id}` : `family:${cert.family}`, line);
      const list = a.fams.get(cert.family) ?? [];
      list.push({ ...base, family: cert.family, derived: false });
      a.fams.set(cert.family, list);
      continue;
    }
    const text = [
      c.certified_security_platform,
      c.chip_platform_vendor,
      c.chip_certificate,
      c.tachograph_application_os,
      c.application,
    ]
      .map(s)
      .join(" ")
      .toLowerCase();
    if (!text.trim()) continue;
    const line = ordered.find((l) =>
      l.patterns.some((p) => p.trim() && text.includes(p.trim().toLowerCase())),
    );
    if (line) bucket(`line:${line.id}`, line).derived.push({ ...base, family: "", derived: true });
  }

  const byDate = (a: TimelineApproval, b: TimelineApproval) =>
    (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) ||
    a.country.localeCompare(b.country);

  const out: TimelineLine[] = [];
  for (const a of acc.values()) {
    const families: TimelineFamily[] = [...a.fams.entries()].map(([family, approvals]) => {
      let issued: Date | null = null;
      let expiry: Date | null = null;
      const ms = new Map<string, Date | null>();
      for (const ap of approvals) {
        const card = cards.find((c) => c.id === ap.cardId);
        const iss = firstDate(card?.certificate_issued_date);
        const exp = firstDate(card?.certificate_expiry_date);
        expiry = maxDate(expiry, exp);
        if (ap.cert?.suffix) ms.set(ap.cert.suffix, minDate(ms.get(ap.cert.suffix) ?? null, iss));
        else issued = minDate(issued, iss);
      }
      if (!issued) {
        for (const ap of approvals) {
          const card = cards.find((c) => c.id === ap.cardId);
          issued = minDate(issued, firstDate(card?.certificate_issued_date));
        }
      }
      return {
        family,
        issued,
        expiry,
        milestones: [...ms.entries()]
          .map(([suffix, date]) => ({ suffix, kind: SUFFIX_KIND[suffix[0] ?? ""] ?? suffix, date }))
          .sort((x, y) => (x.date?.getTime() ?? Infinity) - (y.date?.getTime() ?? Infinity)),
        approvals: approvals.sort(byDate),
        colorIndex: 0,
      };
    });
    families.sort(
      (x, y) =>
        (x.issued?.getTime() ?? x.approvals[0]?.date?.getTime() ?? Infinity) -
          (y.issued?.getTime() ?? y.approvals[0]?.date?.getTime() ?? Infinity) ||
        x.family.localeCompare(y.family),
    );
    families.forEach((f, i) => (f.colorIndex = i % FAMILY_COLORS.length));

    // Platform change: the same country under an earlier family of this line.
    const order = new Map(families.map((f, i) => [f.family, i]));
    const seen = new Map<string, { family: string; time: number }>();
    const timeline = families.flatMap((f) => f.approvals).sort(byDate);
    for (const ap of timeline) {
      for (const country of ap.countries) {
        const prev = seen.get(country);
        if (
          prev &&
          prev.family !== ap.family &&
          (order.get(prev.family) ?? 0) < (order.get(ap.family) ?? 0)
        ) {
          ap.switchedFrom = prev.family;
        }
        seen.set(country, { family: ap.family, time: ap.date?.getTime() ?? 0 });
      }
    }

    const derived = a.derived.sort(byDate);
    const all = [...timeline, ...derived].sort(byDate);
    const years = all.map((x) => x.date?.getUTCFullYear()).filter((y): y is number => !!y);
    const certYears = families
      .flatMap((f) => [f.issued, f.expiry, ...f.milestones.map((m) => m.date)])
      .filter((d): d is Date => !!d)
      .map((d) => d.getUTCFullYear());
    const allYears = [...years, ...certYears];
    out.push({
      key: a.key,
      name: a.line?.name ?? families[0]?.family ?? "—",
      vendor: a.line?.vendor ?? "",
      note: a.line?.note ?? "",
      assigned: !!a.line,
      families,
      derived,
      all,
      countries: new Set(all.flatMap((x) => x.countries)).size,
      firstYear: allYears.length ? Math.min(...allYears) : null,
      lastYear: allYears.length ? Math.max(...allYears) : null,
    });
  }
  // Assigned lines in table order, then unassigned families by size.
  const sortIdx = new Map(ordered.map((l, i) => [`line:${l.id}`, i]));
  return out.sort((x, y) => {
    if (x.assigned !== y.assigned) return x.assigned ? -1 : 1;
    if (x.assigned) return (sortIdx.get(x.key) ?? 0) - (sortIdx.get(y.key) ?? 0);
    return y.all.length - x.all.length || x.name.localeCompare(y.name);
  });
}

/** Line and family a single card belongs to (for links from the record view). */
export function lineKeyForCard(
  card: TimelineCardInput,
  lines: PlatformLine[],
): { lineKey: string; family: string } | null {
  const cert = parseCertificate(card.security_certificate);
  if (!cert) return null;
  const line = lines.find((l) => l.families.includes(cert.family));
  return { lineKey: line ? `line:${line.id}` : `family:${cert.family}`, family: cert.family };
}

/** Same lookup by certificate text (links from the certificate table). */
export function lineKeyForCertificate(
  text: string,
  lines: PlatformLine[],
): { lineKey: string; family: string } | null {
  return lineKeyForCard({ id: "", security_certificate: text }, lines);
}
