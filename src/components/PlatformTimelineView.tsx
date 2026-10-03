import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { geoMercator, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import worldTopo from "world-atlas/countries-110m.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Download, GitBranch, Pause, Play } from "lucide-react";
import { getPlatformLines } from "@/lib/platform.functions";
import {
  buildPlatformTimeline,
  FAMILY_COLORS,
  GEN_COLORS,
  type PlatformLine,
  type TimelineApproval,
  type TimelineCardInput,
  type TimelineLine,
} from "@/lib/platform-timeline";
import { isoForCountry, normalizeCountry } from "@/lib/country-flag";
import { NAME_ALIASES, MICRO_STATES } from "@/components/WorldMapView";

// v2.55: Market Analytics → Platform Timeline. Per security platform line:
// map with one chronological path per certificate family (year slider + play),
// swim lanes per family (certificate validity, M/R/S milestones, approvals),
// and the table behind it. Everything is computed from the loaded records.

const W = 980;
const H = 540;
const LANE_H = 38;
const LANE_LABEL = 200;

/** Point positions that differ from the atlas centroid (remote territories). */
const POINT_OVERRIDES: Record<string, [number, number]> = {
  France: [2.4, 46.6],
  Norway: [9.5, 61.0],
  Russia: [37.6, 55.8],
  "United Kingdom": [-1.8, 52.8],
};

const STATUS_LABEL: Record<string, string> = {
  current: "active",
  superseded: "superseded",
  delisted: "delisted at JRC",
  unmatched: "not matched",
  unknown: "—",
};

const fmt = (d: Date | null) =>
  d
    ? `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
    : "—";

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export type TimelineFocus = { lineKey?: string; family?: string; nonce: number } | null;

export function PlatformTimelineView({
  cards,
  statusById,
  focus,
  onOpenCard,
}: {
  cards: TimelineCardInput[];
  statusById: Map<string, { status: string }>;
  focus?: TimelineFocus;
  onOpenCard?: (id: string) => void;
}) {
  const fetchLines = useServerFn(getPlatformLines);
  const linesQ = useQuery({
    queryKey: ["platform_lines"],
    queryFn: async () => (await fetchLines()) as PlatformLine[],
  });
  const timeline = useMemo(
    () => buildPlatformTimeline(cards, linesQ.data ?? [], statusById),
    [cards, linesQ.data, statusById],
  );
  const assigned = timeline.filter((l) => l.assigned);
  const unassigned = timeline.filter((l) => !l.assigned);

  const [lineKey, setLineKey] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);
  // A link from the certificate table or a record: open the line that holds
  // the family and highlight it.
  useEffect(() => {
    if (!focus) return;
    const target =
      (focus.lineKey && timeline.find((l) => l.key === focus.lineKey)) ||
      (focus.family && timeline.find((l) => l.families.some((f) => f.family === focus.family)));
    if (target) {
      setLineKey(target.key);
      setHighlight(focus.family ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, timeline]);
  const line = timeline.find((l) => l.key === lineKey) ?? assigned[0] ?? unassigned[0] ?? null;

  const withoutCert = useMemo(
    () =>
      cards.filter((c) => (String(c.device_type ?? "").trim() || "Card") === "Card").length -
      timeline.reduce((n, l) => n + l.all.length, 0),
    [cards, timeline],
  );

  if (linesQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading platform lines…</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-muted-foreground" /> Platform Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A security certificate belongs to a platform (chip + tachograph application) that
            several card manufacturers build on. Choose a platform line: the map shows where its
            cards were type-approved, year by year; the lanes show each certificate with its
            maintenance (M), re-assessment (R) and surveillance (S) steps.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {assigned.map((l) => (
              <Button
                key={l.key}
                size="sm"
                variant={line?.key === l.key ? "default" : "outline"}
                onClick={() => {
                  setLineKey(l.key);
                  setHighlight(null);
                }}
              >
                {l.name}
                <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
                  {l.all.length}
                </Badge>
              </Button>
            ))}
            {unassigned.length > 0 && (
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={line && !line.assigned ? line.key : ""}
                onChange={(e) => {
                  if (e.target.value) {
                    setLineKey(e.target.value);
                    setHighlight(null);
                  }
                }}
              >
                <option value="">Not assigned to a line ({unassigned.length})…</option>
                {unassigned.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name} ({l.all.length})
                  </option>
                ))}
              </select>
            )}
            <label className="ml-auto inline-flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={onlyActive}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              only active approvals
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {withoutCert > 0 &&
              `${withoutCert} card approval(s) have no security certificate and no platform text that identifies a line — they are on the maintenance list under Tools → Data quality. `}
            Lines and their certificate families are maintained under Tools → Platform lines.
          </p>
        </CardContent>
      </Card>

      {line ? (
        <LineDetail
          key={line.key}
          line={line}
          highlight={highlight}
          onlyActive={onlyActive}
          onOpenCard={onOpenCard}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No card approval carries a security certificate yet.
        </p>
      )}
    </div>
  );
}

function LineDetail({
  line,
  highlight,
  onlyActive,
  onOpenCard,
}: {
  line: TimelineLine;
  highlight: string | null;
  onlyActive: boolean;
  onOpenCard?: (id: string) => void;
}) {
  // A family clicked in the legend is emphasised on map and lanes.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [line.key, highlight]);
  highlight = picked ?? highlight;
  const visible = (a: TimelineApproval) => !onlyActive || a.status === "current";
  const dated = line.all.filter((a) => a.date && visible(a));
  const years = dated.map((a) => a.date!.getUTCFullYear());
  const minYear = years.length ? Math.min(...years) : new Date().getUTCFullYear();
  const maxYear = years.length ? Math.max(...years) : new Date().getUTCFullYear();
  const [year, setYear] = useState(maxYear);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setYear(maxYear), [maxYear, line.key]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setYear((y) => {
        if (y >= maxYear) {
          setPlaying(false);
          return maxYear;
        }
        return y + 1;
      });
    }, 900);
    return () => clearInterval(t);
  }, [playing, maxYear]);
  const play = () => {
    if (year >= maxYear) setYear(minYear);
    setPlaying(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {line.name}
              {line.vendor && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {line.vendor}
                </span>
              )}
              {!line.assigned && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  not assigned to a line
                </Badge>
              )}
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {line.all.length} approval(s) · {line.countries} countr
              {line.countries === 1 ? "y" : "ies"}
              {line.firstYear ? ` · ${line.firstYear}–${line.lastYear}` : ""}
            </span>
          </div>
          {line.note && <p className="text-xs text-muted-foreground">{line.note}</p>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => (playing ? setPlaying(false) : play())}
            >
              {playing ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <input
              type="range"
              min={minYear}
              max={maxYear}
              step={1}
              value={Math.min(Math.max(year, minYear), maxYear)}
              onChange={(e) => {
                setPlaying(false);
                setYear(Number(e.target.value));
              }}
              className="w-64"
              aria-label="Year"
            />
            <span className="text-2xl font-semibold tabular-nums">{year}</span>
            <Legend
              line={line}
              picked={highlight}
              onPick={(f) => setPicked((p) => (p === f ? null : f))}
            />
          </div>
          <TimelineMap
            line={line}
            year={year}
            visible={visible}
            highlight={highlight}
            onOpenCard={onOpenCard}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Certificates over time</CardTitle>
        </CardHeader>
        <CardContent>
          <SwimLanes
            line={line}
            year={year}
            visible={visible}
            highlight={highlight}
            onOpenCard={onOpenCard}
          />
        </CardContent>
      </Card>
      <ApprovalTable line={line} visible={visible} onOpenCard={onOpenCard} />
    </>
  );
}

function Legend({
  line,
  picked,
  onPick,
}: {
  line: TimelineLine;
  picked: string | null;
  onPick: (family: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {line.families.map((f) => (
        <button
          type="button"
          key={f.family}
          title="Click to emphasise this certificate family"
          onClick={() => onPick(f.family)}
          className={`inline-flex items-center gap-1 rounded px-1 hover:bg-muted ${picked === f.family ? "font-semibold text-foreground" : ""}`}
        >
          <span
            className="inline-block h-0.5 w-5"
            style={{ background: FAMILY_COLORS[f.colorIndex] }}
          />
          {f.family}
        </button>
      ))}
      <span className="mx-1 text-muted-foreground/50">|</span>
      {Object.entries(GEN_COLORS).map(([g, c]) => (
        <span key={g} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {g}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-slate-400" />{" "}
        delisted
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400 opacity-40" />{" "}
        superseded
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-slate-500 ring-1 ring-slate-500" />{" "}
        changed platform
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full border border-slate-400" /> approved in
        the selected year (with label)
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ map

type Geo = {
  shapes: { name: string; d: string }[];
  points: Map<string, [number, number]>;
};

let geoCache: Geo | null = null;
function useGeo(): Geo {
  return useMemo(() => {
    if (geoCache) return geoCache;
    const topo = worldTopo as unknown as Parameters<typeof feature>[0];
    const geo = feature(
      topo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (topo as any).objects.countries,
    ) as unknown as FeatureCollection<Geometry, { name: string }>;
    const projection = geoMercator().fitExtent(
      [
        [10, 10],
        [W - 10, H - 10],
      ],
      {
        type: "MultiPoint",
        coordinates: [
          [-24, 31],
          [78, 31],
          [-24, 69],
          [78, 69],
        ],
      } as GeoPermissibleObjects,
    );
    const path = geoPath(projection);
    const shapes: Geo["shapes"] = [];
    const points = new Map<string, [number, number]>();
    const appName = new Map(Object.entries(NAME_ALIASES).map(([app, atlas]) => [atlas, app]));
    for (const f of geo.features) {
      const d = path(f as unknown as GeoPermissibleObjects);
      if (!d) continue;
      const name = f.properties?.name ?? "";
      shapes.push({ name, d });
      const c = path.centroid(f as unknown as GeoPermissibleObjects);
      if (Number.isFinite(c[0])) points.set(appName.get(name) ?? name, [c[0], c[1]]);
    }
    for (const [name, lonlat] of Object.entries({ ...MICRO_STATES, ...POINT_OVERRIDES })) {
      const p = projection(lonlat);
      if (p) points.set(name, [p[0], p[1]]);
    }
    geoCache = { shapes, points };
    return geoCache;
  }, []);
}

type Placed = {
  a: TimelineApproval;
  country: string;
  x: number;
  y: number;
  bx: number;
  by: number;
};

/** Gently bent segment so lines between neighbouring countries do not overlap. */
function arcPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const k = 0.18;
    d += ` Q${(mx - (y1 - y0) * k).toFixed(1)},${(my + (x1 - x0) * k).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function TimelineMap({
  line,
  year,
  visible,
  highlight,
  onOpenCard,
}: {
  line: TimelineLine;
  year: number;
  visible: (a: TimelineApproval) => boolean;
  highlight: string | null;
  onOpenCard?: (id: string) => void;
}) {
  const geo = useGeo();
  const wrap = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ p: Placed; x: number; y: number } | null>(null);

  const until = Date.UTC(year, 11, 31, 23, 59);
  const shown = (a: TimelineApproval) => !!a.date && a.date.getTime() <= until && visible(a);

  // Several approvals in one country: small offsets around the country point.
  const placed = useMemo(() => {
    const perCountry = new Map<string, number>();
    const out: Placed[] = [];
    for (const a of line.all) {
      if (!shown(a)) continue;
      for (const raw of a.countries) {
        const country = normalizeCountry(raw);
        const pt = geo.points.get(country);
        if (!pt) continue;
        const i = perCountry.get(country) ?? 0;
        perCountry.set(country, i + 1);
        const ang = i * 2.399;
        const r = i === 0 ? 0 : 7 + 3 * Math.sqrt(i);
        out.push({
          a,
          country,
          x: pt[0] + r * Math.cos(ang),
          y: pt[1] + r * Math.sin(ang),
          bx: pt[0],
          by: pt[1],
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, year, visible, geo]);

  const activeCountries = new Set(placed.map((p) => p.country));
  // v2.55: one stop per country and family (its first approval) keeps the
  // path readable; further approvals in the same country only add points.
  const paths = line.families.map((f) => {
    const seen = new Set<string>();
    const pts: [number, number][] = [];
    for (const p of placed) {
      if (p.a.family !== f.family || p.a.derived || seen.has(p.country)) continue;
      seen.add(p.country);
      pts.push([p.bx, p.by]);
    }
    return { f, d: arcPath(pts), n: pts.length };
  });
  // Year labels: approvals of the slider year, plus each country's first one
  // while the map is still sparse.
  const firstPerCountry = new Set<Placed>();
  {
    const seen = new Set<string>();
    for (const p of placed) {
      if (seen.has(p.country)) continue;
      seen.add(p.country);
      firstPerCountry.add(p);
    }
  }
  const sparse = activeCountries.size <= 12;
  const isNew = (p: Placed) => p.a.date?.getUTCFullYear() === year;

  return (
    <div
      ref={wrap}
      className="relative overflow-hidden rounded-md border"
      style={{ background: "#0b1224" }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Map of type approvals of this platform line"
      >
        {geo.shapes.map((s) => {
          const app =
            Object.entries(NAME_ALIASES).find(([, atlas]) => atlas === s.name)?.[0] ?? s.name;
          return (
            <path
              key={s.name}
              d={s.d}
              fill={activeCountries.has(app) ? "rgba(56,189,248,0.22)" : "#1e293b"}
              stroke="#334155"
              strokeWidth={0.5}
            />
          );
        })}
        {paths.map(({ f, d, n }) =>
          n > 1 ? (
            <path
              key={f.family}
              d={d}
              fill="none"
              stroke={FAMILY_COLORS[f.colorIndex]}
              strokeWidth={highlight === f.family ? 2.4 : 1.2}
              strokeOpacity={highlight ? (highlight === f.family ? 0.95 : 0.15) : 0.55}
              strokeLinejoin="round"
            />
          ) : null,
        )}
        {placed.map((p, i) => {
          const fill = GEN_COLORS[p.a.generation] ?? "#64748b";
          const delisted = p.a.status === "delisted";
          const superseded = p.a.status === "superseded";
          const dim = highlight && p.a.family && highlight !== p.a.family;
          return (
            <g
              key={`${p.a.cardId}-${p.country}-${i}`}
              opacity={dim ? 0.35 : 1}
              style={{ cursor: onOpenCard ? "pointer" : "default" }}
              onMouseEnter={(e) => {
                const r = wrap.current?.getBoundingClientRect();
                if (r) setTip({ p, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onOpenCard?.(p.a.cardId)}
            >
              {p.a.switchedFrom && (
                <circle cx={p.x} cy={p.y} r={9.5} fill="none" stroke="#f8fafc" strokeWidth={1.4} />
              )}
              {isNew(p) && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={11}
                  fill="none"
                  stroke={fill}
                  strokeOpacity={0.6}
                  strokeWidth={1}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={isNew(p) ? 6 : 4.5}
                fill={delisted || p.a.derived ? "none" : fill}
                fillOpacity={superseded ? 0.4 : 1}
                stroke={delisted || p.a.derived ? fill : "#0f172a"}
                strokeWidth={delisted || p.a.derived ? 2 : 1}
                strokeDasharray={delisted || p.a.derived ? "2.5 2" : undefined}
              />
              {(isNew(p) || (sparse && firstPerCountry.has(p))) && (
                <text
                  x={p.x + 8}
                  y={p.y - 7}
                  fontSize={isNew(p) ? 11 : 10}
                  fontWeight={isNew(p) ? 600 : 400}
                  fill={isNew(p) ? "#f8fafc" : "#cbd5e1"}
                  stroke="#0b1224"
                  strokeWidth={3}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {p.a.date?.getUTCFullYear()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-lg"
          style={{ left: Math.min(tip.x + 12, 700), top: Math.max(tip.y - 10, 0) }}
        >
          <div className="font-semibold">{tip.p.country}</div>
          <div>
            {tip.p.a.typeApproval || "—"} · {tip.p.a.generation || "—"} · {fmt(tip.p.a.date)}
          </div>
          <div>{tip.p.a.manufacturer || "—"}</div>
          <div className="text-slate-300">
            {tip.p.a.derived ? "derived from platform text" : tip.p.a.certLabel || tip.p.a.certText}
            {" · "}
            {STATUS_LABEL[tip.p.a.status]}
          </div>
          {tip.p.a.switchedFrom && (
            <div className="text-slate-300">before: {tip.p.a.switchedFrom}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ swim lanes

function SwimLanes({
  line,
  year,
  visible,
  highlight,
  onOpenCard,
}: {
  line: TimelineLine;
  year: number;
  visible: (a: TimelineApproval) => boolean;
  highlight: string | null;
  onOpenCard?: (id: string) => void;
}) {
  const now = new Date();
  const lanes = [
    ...line.families.map((f) => ({ key: f.family, label: f.family, f })),
    ...(line.derived.length
      ? [{ key: "__derived", label: "without certificate (derived)", f: null }]
      : []),
  ];
  const y0 = line.firstYear ?? now.getUTCFullYear() - 5;
  const y1 = Math.max(line.lastYear ?? now.getUTCFullYear(), now.getUTCFullYear()) + 1;
  const innerW = W - LANE_LABEL - 20;
  const x = (d: Date) =>
    LANE_LABEL +
    ((d.getTime() - Date.UTC(y0, 0, 1)) / (Date.UTC(y1, 0, 1) - Date.UTC(y0, 0, 1))) * innerW;
  const height = lanes.length * LANE_H + 30;
  const yearTicks = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block h-auto w-full min-w-[720px]"
        role="img"
        aria-label="Certificate lanes"
      >
        <defs>
          <pattern
            id="tl-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="rgba(239,68,68,0.10)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(239,68,68,0.55)" strokeWidth="2" />
          </pattern>
        </defs>
        {yearTicks.map((y) => (
          <g key={y}>
            <line
              x1={x(new Date(Date.UTC(y, 0, 1)))}
              x2={x(new Date(Date.UTC(y, 0, 1)))}
              y1={0}
              y2={height - 22}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={x(new Date(Date.UTC(y, 0, 1))) + 2}
              y={height - 8}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.55}
            >
              {y}
            </text>
          </g>
        ))}
        {lanes.map((lane, i) => {
          const cy = i * LANE_H + LANE_H / 2 + 4;
          const f = lane.f;
          const color = f ? FAMILY_COLORS[f.colorIndex] : "#94a3b8";
          const approvals = (f ? f.approvals : line.derived).filter((a) => a.date && visible(a));
          const start = f?.issued ?? approvals[0]?.date ?? null;
          const end = f?.expiry ?? null;
          const dim = highlight && f && highlight !== f.family;
          return (
            <g key={lane.key} opacity={dim ? 0.4 : 1}>
              <text
                x={4}
                y={cy + 4}
                fontSize={11}
                fontWeight={highlight === lane.key ? 700 : 500}
                fill="currentColor"
              >
                {lane.label}
              </text>
              {f && start && (
                <>
                  <rect
                    x={x(start)}
                    y={cy - 7}
                    width={Math.max(2, x(end && end < now ? end : (end ?? now)) - x(start))}
                    height={14}
                    rx={3}
                    fill={color}
                    fillOpacity={0.25}
                    stroke={color}
                    strokeOpacity={0.7}
                  />
                  {end && end < now && (
                    <rect
                      x={x(end)}
                      y={cy - 7}
                      width={Math.max(0, x(now) - x(end))}
                      height={14}
                      fill="url(#tl-hatch)"
                    />
                  )}
                  <title>
                    {`${f.family}: issued ${fmt(f.issued)}, valid until ${fmt(f.expiry)}${end && end < now ? " (expired)" : ""}`}
                  </title>
                </>
              )}
              {f?.milestones.map((m) =>
                m.date ? (
                  <g key={m.suffix}>
                    <rect
                      x={x(m.date) - 5}
                      y={cy - 5}
                      width={10}
                      height={10}
                      transform={`rotate(45 ${x(m.date)} ${cy})`}
                      fill="#f8fafc"
                      stroke={color}
                      strokeWidth={2}
                    />
                    <text
                      x={x(m.date) + 7}
                      y={cy - 9}
                      fontSize={9}
                      fill="currentColor"
                      fillOpacity={0.75}
                    >
                      {m.suffix}
                    </text>
                    <title>{`${m.kind} ${f.family}-${m.suffix}: ${fmt(m.date)}`}</title>
                  </g>
                ) : null,
              )}
              {approvals.map((a, j) => {
                const ax = x(a.date!);
                const jitter = ((j % 3) - 1) * 6;
                const fill = GEN_COLORS[a.generation] ?? "#64748b";
                const hollow = a.derived || a.status === "delisted";
                return (
                  <g
                    key={`${a.cardId}-${j}`}
                    style={{ cursor: onOpenCard ? "pointer" : "default" }}
                    onClick={() => onOpenCard?.(a.cardId)}
                  >
                    <circle
                      cx={ax}
                      cy={cy + jitter}
                      r={4.5}
                      fill={hollow ? "none" : fill}
                      fillOpacity={a.status === "superseded" ? 0.45 : 1}
                      stroke={hollow ? fill : "#0f172a"}
                      strokeWidth={hollow ? 1.6 : 0.8}
                      strokeDasharray={hollow ? "2 1.5" : undefined}
                    />
                    <title>{`${a.country} · ${a.typeApproval} · ${a.generation} · ${fmt(a.date)} · ${STATUS_LABEL[a.status]}`}</title>
                  </g>
                );
              })}
              {approvals.length <= 24 &&
                (() => {
                  // One label per country and position (same-day approvals of one country would overprint).
                  const seen = new Set<string>();
                  return approvals.map((a, j) => {
                    const code = (
                      isoForCountry(a.countries[0] ?? "") || a.country.slice(0, 2)
                    ).toUpperCase();
                    const k = `${Math.round(x(a.date!) / 12)}-${code}`;
                    if (seen.has(k)) return null;
                    seen.add(k);
                    return (
                      <text
                        key={`l-${a.cardId}-${j}`}
                        x={x(a.date!) - 6}
                        y={cy + ((j % 3) - 1) * 6 + 15}
                        fontSize={8}
                        fill="currentColor"
                        fillOpacity={0.6}
                        style={{ pointerEvents: "none" }}
                      >
                        {code}
                      </text>
                    );
                  });
                })()}
            </g>
          );
        })}
        <line
          x1={x(new Date(Date.UTC(year, 11, 31)))}
          x2={x(new Date(Date.UTC(year, 11, 31)))}
          y1={0}
          y2={height - 22}
          stroke="#38bdf8"
          strokeWidth={1.5}
        />
        <line
          x1={x(now)}
          x2={x(now)}
          y1={0}
          y2={height - 22}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeDasharray="3 3"
        />
      </svg>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Bar = certificate issued → valid until (hatched red once expired) · ◆ = maintenance (M),
        re-assessment (R) or surveillance (S) · dots = type approvals (colour = generation) · blue
        line = slider year · dashed line = today.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- table

type SortKey =
  | "date"
  | "country"
  | "typeApproval"
  | "generation"
  | "cert"
  | "manufacturer"
  | "status";

function ApprovalTable({
  line,
  visible,
  onOpenCard,
}: {
  line: TimelineLine;
  visible: (a: TimelineApproval) => boolean;
  onOpenCard?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "date", asc: true });
  const rows = useMemo(() => {
    const val = (a: TimelineApproval): string | number => {
      switch (sort.key) {
        case "date":
          return a.date?.getTime() ?? Number.MAX_SAFE_INTEGER;
        case "cert":
          return a.certLabel || (a.derived ? "~derived" : "");
        default:
          return String(a[sort.key] ?? "");
      }
    };
    return line.all
      .filter(visible)
      .slice()
      .sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        const c =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb));
        return sort.asc ? c : -c;
      });
  }, [line, visible, sort]);
  const undated = rows.filter((r) => !r.date).length;

  const exportCsv = () => {
    const head = [
      "Date",
      "Country",
      "Type approval",
      "Generation",
      "Certificate",
      "Platform line",
      "Manufacturer",
      "Status",
      "Note",
      "Record id",
    ];
    const lines = rows.map((a) =>
      [
        fmt(a.date),
        a.country,
        a.typeApproval,
        a.generation,
        a.derived ? "" : a.certLabel,
        line.name,
        a.manufacturer,
        STATUS_LABEL[a.status],
        a.derived
          ? "derived from platform text"
          : a.switchedFrom
            ? `changed from ${a.switchedFrom}`
            : "",
        a.cardId,
      ]
        .map(csvCell)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.map(csvCell).join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `tdh-platform-timeline-${line.name.replace(/[^A-Za-z0-9]+/g, "-")}.csv`;
    el.click();
    URL.revokeObjectURL(url);
  };

  const th = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer py-2 pr-3 font-medium hover:text-foreground"
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-base font-semibold"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Approvals in this line ({rows.length})
            {undated > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {undated} without readable date
              </span>
            )}
          </button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                  {th("date", "Date")}
                  {th("country", "Country")}
                  {th("typeApproval", "Type approval")}
                  {th("generation", "Gen")}
                  {th("cert", "Certificate")}
                  {th("manufacturer", "Manufacturer")}
                  {th("status", "Status")}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.cardId}
                    className={`border-b last:border-0 ${onOpenCard ? "cursor-pointer hover:bg-accent/60" : ""}`}
                    onClick={() => onOpenCard?.(a.cardId)}
                  >
                    <td className="py-1.5 pr-3 tabular-nums">{fmt(a.date)}</td>
                    <td className="py-1.5 pr-3">{a.country || "—"}</td>
                    <td className="py-1.5 pr-3">{a.typeApproval || "—"}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: GEN_COLORS[a.generation] ?? "#64748b" }}
                      />{" "}
                      {a.generation || "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {a.derived ? (
                        <span className="text-muted-foreground">derived</span>
                      ) : (
                        a.certLabel
                      )}
                      {a.switchedFrom && (
                        <span className="block text-[10px] text-muted-foreground">
                          changed from {a.switchedFrom}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{a.manufacturer || "—"}</td>
                    <td className="py-1.5 pr-3">{STATUS_LABEL[a.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
