import { useId, useMemo, useState } from "react";
import { Play, Pause } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildPlatformTrends, RELATIONS } from "@/lib/platform-trends";
import type { TimelineLine } from "@/lib/platform-timeline";

const labels = { "in-house": "In-house", partner: "Via partners", unknown: "Unclassified" };
const panel = "rounded-xl border border-[#253e58] bg-[#112238] p-4 md:p-5";
function vendorColor(v: string) {
  const known: Record<string, string> = {
    Thales: "#20bce6",
    IDEMIA: "#ff6b70",
    STMicroelectronics: "#c4b5fd",
  };
  let hash = 0;
  for (const c of v) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return known[v] ?? `hsl(${hash % 360} 75% 65%)`;
}
export function PlatformTrends({
  lines,
  year,
  missing,
  playing,
  onPlay,
  onYearChange,
  minYear,
  maxYear,
}: {
  lines: TimelineLine[];
  year: number;
  missing: number;
  playing: boolean;
  onPlay: () => void;
  onYearChange: (year: number) => void;
  minYear: number;
  maxYear: number;
}) {
  const model = useMemo(() => buildPlatformTrends(lines), [lines]);
  const [hidden, setHidden] = useState<string[]>([]);
  const id = useId().replace(/:/g, "");
  const visible = model.vendors
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => !hidden.includes(v))
    .sort((a, b) => (a.v === "Thales" ? -1 : b.v === "Thales" ? 1 : a.v.localeCompare(b.v)));
  // Recharts discovers axes as direct children, not inside a Fragment.
  const axis = [
    <CartesianGrid key="grid" stroke="#42536a" strokeDasharray="3 3" vertical={false} />,
    <XAxis
      key="x"
      dataKey="year"
      tick={{ fill: "#d5e3f4", fontSize: 12 }}
      stroke="#8ba5c2"
      minTickGap={30}
    />,
    <YAxis
      key="y"
      allowDecimals={false}
      tick={{ fill: "#d5e3f4", fontSize: 12 }}
      stroke="#8ba5c2"
      width={42}
    />,
    <Tooltip
      key="tip"
      contentStyle={{
        background: "#09162a",
        border: "1px solid #42607f",
        borderRadius: 8,
        color: "#f1f5f9",
        fontSize: 12,
      }}
      labelStyle={{ color: "#fff" }}
    />,
    <ReferenceLine
      key="year"
      x={year}
      stroke="#e2e8f0"
      strokeDasharray="4 4"
      label={{ value: String(year), position: "insideTopRight", fill: "#f8fafc", fontSize: 12 }}
    />,
  ];
  const patterns = (prefix: string) => (
    <defs>
      {visible.map(({ v, i }) => (
        <pattern
          key={v}
          id={`${id}-${prefix}-${i}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <rect width="6" height="6" fill={vendorColor(v)} fillOpacity={0.55} />
          <path d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2" stroke="#e2f3ff" strokeWidth="1.2" />
        </pattern>
      ))}
    </defs>
  );
  const legend = (v: string) => (
    <div className="flex flex-wrap justify-center gap-4 text-xs text-slate-100">
      {RELATIONS.map((r) => (
        <span key={r} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-6 border border-white/30"
            style={{
              backgroundColor: vendorColor(v),
              opacity: r === "unknown" ? 0.3 : 1,
              backgroundImage:
                r === "partner"
                  ? "repeating-linear-gradient(135deg,transparent,transparent 3px,#e2f3ff 3px,#e2f3ff 4px)"
                  : undefined,
            }}
          />
          {labels[r]}
        </span>
      ))}
    </div>
  );
  return (
    <div className="space-y-3 rounded-2xl bg-[#081426] p-3 text-slate-100 md:p-5">
      <header className="px-1 pb-1">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Platform approvals over time
        </h2>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-300">
          All providers · Including partner approvals
        </p>
      </header>
      <div className="flex flex-wrap gap-2" aria-label="Platform provider filters">
        {model.vendors.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={!hidden.includes(v)}
            className={`rounded-full border border-[#385575] px-3 py-1 text-xs ${hidden.includes(v) ? "opacity-40" : "bg-[#162c46]"}`}
            onClick={() => setHidden((h) => (h.includes(v) ? h.filter((x) => x !== v) : [...h, v]))}
          >
            <span style={{ color: vendorColor(v) }}>● </span>
            {v}
          </button>
        ))}
      </div>
      {!visible.length && (
        <p className={panel}>No providers selected or no unambiguous dated approvals available.</p>
      )}
      <section className={panel} aria-label="Documented country coverage">
        <h3 className="mb-3 text-xl font-bold">A · Country approval coverage</h3>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {visible.map(({ v, i }) => (
            <div key={v} className="min-w-0">
              <h4 className="mb-2 pl-10 text-lg font-semibold" style={{ color: vendorColor(v) }}>
                {v} platform
              </h4>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={model.rows} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
                  {patterns(`coverage${i}`)}
                  {axis}
                  {RELATIONS.map((r) => (
                    <Area
                      key={r}
                      type="stepAfter"
                      dataKey={`coverage${i}-${r}`}
                      name={`${v} · ${labels[r]}`}
                      stackId="coverage"
                      stroke={vendorColor(v)}
                      fill={r === "partner" ? `url(#${id}-coverage${i}-${i})` : vendorColor(v)}
                      fillOpacity={r === "unknown" ? 0.2 : r === "partner" ? 1 : 0.65}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              {legend(v)}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-300">
          Recorded country coverage to each date, not currently held approvals. A country with both
          in-house and partner approvals appears in both segments. Withdrawal dates are not
          available.
        </p>
      </section>
      <section className={panel} aria-label="New approvals by year">
        <h3 className="mb-3 text-xl font-bold">B · New approvals by year</h3>
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={model.rows} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
                {patterns("bars")}
                {axis}
                {visible.flatMap(({ v, i }) =>
                  RELATIONS.map((r) => (
                    <Bar
                      key={`${v}-${r}`}
                      dataKey={`new${i}-${r}`}
                      name={`${v} · ${labels[r]}`}
                      stackId={String(i)}
                      fill={r === "partner" ? `url(#${id}-bars-${i})` : vendorColor(v)}
                      fillOpacity={r === "unknown" ? 0.25 : 1}
                      isAnimationActive={false}
                    />
                  )),
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <aside className="flex flex-wrap gap-4 rounded-lg bg-[#0b192c] p-3 lg:w-48 lg:flex-col">
            {visible.map(({ v }) => (
              <div key={v}>
                <h4 className="mb-2 text-sm font-semibold" style={{ color: vendorColor(v) }}>
                  {v} platform
                </h4>
                {legend(v)}
              </div>
            ))}
          </aside>
        </div>
        <p className="mt-3 text-xs text-slate-300">
          New activity, not the number still held. New-country extensions count; routine revisions
          do not.
        </p>
      </section>
      <section className={panel} aria-label="Cumulative approvals">
        <h3 className="text-xl font-bold">C · Cumulative approvals recorded</h3>
        <p className="mb-2 text-xs text-slate-300">Including in-house and partner approvals</p>
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={model.rows} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
                {axis}
                {visible.map(({ v, i }) => (
                  <Area
                    key={v}
                    type="stepAfter"
                    dataKey={`total${i}`}
                    name={`${v} platform`}
                    stroke={vendorColor(v)}
                    strokeWidth={3}
                    fill={vendorColor(v)}
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <aside className="flex flex-wrap gap-3 self-start rounded-lg bg-[#0b192c] p-3 lg:w-48 lg:flex-col">
            {visible.map(({ v }) => (
              <span key={v} className="flex items-center gap-2 text-sm">
                <span className="h-1 w-7 rounded" style={{ background: vendorColor(v) }} />
                {v} platform
              </span>
            ))}
          </aside>
        </div>
        <p className="mt-3 text-xs text-slate-300">
          Historical accumulation — does not imply approvals remain current. No sales-volume claims.
        </p>
      </section>
      <div className={`${panel} flex items-center gap-4`}>
        <button
          type="button"
          onClick={onPlay}
          disabled={minYear === maxYear}
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#39648b] bg-[#163556] text-white disabled:opacity-40"
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between text-xs text-slate-300">
            <span>{minYear}</span>
            <output className="rounded border border-[#39648b] bg-[#163556] px-3 py-0.5 text-base font-bold text-white">
              {year}
            </output>
            <span>{maxYear}</span>
          </div>
          <input
            aria-label="Platform charts year"
            type="range"
            min={minYear}
            max={maxYear}
            step={1}
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </div>
      </div>
      <p className="text-right text-xs text-slate-300">
        Year selection is shared with the platform map. Charts include all historical records.
      </p>
      <details className="text-xs text-slate-300">
        <summary className="cursor-pointer">
          Counting rules and data quality · {model.excluded + missing} excluded card records
        </summary>
        <p className="mt-2">
          One position per country, generation, platform provider and base type approval. Revisions
          are consolidated at their earliest recorded Date / Status; a new country adds a position.
          Country assignments come from the database, not the issuing approval mark. Unmapped
          providers, inferred platform assignments, missing dates, unknown countries and ambiguous
          approval numbers are excluded. Date / Status can reflect an interoperability date and is
          not necessarily the legal approval date. Historical withdrawals are not available;
          security certificate expiry and the current-status heuristic are not used as approval end
          dates. Provider aliases are grouped (including predecessor brands); partner classification
          is not independently certified.
        </p>
      </details>
      {model.vendors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer">Values at {year}</summary>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-left">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Countries</th>
                  <th>New approvals</th>
                  <th>Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ v, i }) => {
                  const row = model.rows.filter((r) => r.year <= year).at(-1);
                  return (
                    <tr key={v}>
                      <td>{v}</td>
                      <td>{row?.[`coverage${i}`] ?? 0}</td>
                      <td>
                        {row?.year === year
                          ? RELATIONS.reduce((n, r) => n + row[`new${i}-${r}`], 0)
                          : 0}
                      </td>
                      <td>{row?.[`total${i}`] ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
