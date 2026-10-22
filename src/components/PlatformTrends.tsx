import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPlatformTrends, RELATIONS } from "@/lib/platform-trends";
import type { TimelineLine } from "@/lib/platform-timeline";

const colors = [
  "#0284c7",
  "#e11d48",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#4f46e5",
  "#0d9488",
  "#a21caf",
];
const color = (i: number) => colors[i] ?? `hsl(${(i * 137.5) % 360} 65% 42%)`;
const labels = { "in-house": "In-house", partner: "Via partner", unknown: "Manufacturer unknown" };
export function PlatformTrends({
  lines,
  year,
  missing,
}: {
  lines: TimelineLine[];
  year: number;
  missing: number;
}) {
  const model = useMemo(() => buildPlatformTrends(lines), [lines]);
  const [hidden, setHidden] = useState<string[]>([]);
  const id = useId().replace(/:/g, "");
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
      <XAxis dataKey="year" tick={{ fontSize: 11 }} minTickGap={25} />
      <YAxis allowDecimals={false} width={35} tick={{ fontSize: 11 }} />
      <Tooltip contentStyle={{ color: "#0f172a", fontSize: 12 }} />
      <ReferenceLine
        x={year}
        stroke="#64748b"
        strokeDasharray="4 4"
        label={{ value: String(year), position: "insideTopRight", fontSize: 11 }}
      />
    </>
  );
  const visible = model.vendors.map((v, i) => ({ v, i })).filter(({ v }) => !hidden.includes(v));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Platform approvals over time · all providers</CardTitle>
        <p className="text-xs text-muted-foreground">
          All generations and historical records, including partner approvals. Independent of the
          selected platform and “only active” filter. Year marker follows Play.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2" aria-label="Platform provider filters">
          {model.vendors.map((v, i) => (
            <button
              key={v}
              type="button"
              aria-pressed={!hidden.includes(v)}
              className={`rounded border px-2 py-1 text-xs ${hidden.includes(v) ? "opacity-40" : ""}`}
              onClick={() =>
                setHidden((h) => (h.includes(v) ? h.filter((x) => x !== v) : [...h, v]))
              }
            >
              <span style={{ color: color(i) }}>● </span>
              {v}
            </button>
          ))}
        </div>
        {!model.vendors.length ? (
          <p className="text-sm text-muted-foreground">
            No dated, unambiguous country approvals with an assigned platform provider.
          </p>
        ) : (
          <>
            <section aria-label="Documented country coverage">
              <h3 className="text-sm font-medium">A · Documented country coverage</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Distinct countries per provider recorded up to each year. Providers may overlap in a
                country; this is not a count of currently valid approvals.
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={model.rows}>
                  {axis}
                  {visible.map(({ v, i }) => (
                    <Area
                      key={v}
                      type="stepAfter"
                      dataKey={`coverage${i}`}
                      name={v}
                      stroke={color(i)}
                      fill={color(i)}
                      fillOpacity={0.12}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </section>
            <section aria-label="New approvals by year">
              <h3 className="text-sm font-medium">B · New country approvals by year</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Solid: in-house · striped: via partner · pale: manufacturer unknown. Classification
                uses the recorded card manufacturer and platform provider.
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={model.rows}>
                  <defs>
                    {visible.map(({ i }) => (
                      <pattern
                        key={i}
                        id={`${id}-partner-${i}`}
                        width="6"
                        height="6"
                        patternUnits="userSpaceOnUse"
                      >
                        <rect width="6" height="6" fill={color(i)} fillOpacity={0.2} />
                        <path
                          d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2"
                          stroke={color(i)}
                          strokeWidth="2"
                        />
                      </pattern>
                    ))}
                  </defs>
                  {axis}
                  {visible.flatMap(({ v, i }) =>
                    RELATIONS.map((r) => (
                      <Bar
                        key={`${v}-${r}`}
                        dataKey={`new${i}-${r}`}
                        name={`${v} · ${labels[r]}`}
                        stackId={String(i)}
                        fill={r === "partner" ? `url(#${id}-partner-${i})` : color(i)}
                        fillOpacity={r === "unknown" ? 0.25 : 1}
                        isAnimationActive={false}
                      />
                    )),
                  )}
                </BarChart>
              </ResponsiveContainer>
            </section>
            <section aria-label="Cumulative approvals">
              <h3 className="text-sm font-medium">C · Cumulative country approvals recorded</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                All recorded country approval positions, including partners and historical
                approvals; not sales or currently held approvals.
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={model.rows}>
                  {axis}
                  {visible.map(({ v, i }) => (
                    <Line
                      key={v}
                      type="stepAfter"
                      dataKey={`total${i}`}
                      name={v}
                      stroke={color(i)}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </section>
          </>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Counting rules and data quality · {model.excluded + missing} excluded card records
          </summary>
          <p className="mt-2">
            One position per country, generation, platform provider and base type approval.
            Revisions are consolidated at their earliest recorded Date / Status; a new country adds
            a position. Country assignments come from the database, not the issuing approval mark.
            Unmapped providers, inferred platform assignments, missing dates, unknown countries and
            ambiguous approval numbers are excluded. Date / Status can reflect an interoperability
            date and is not necessarily the legal approval date. Historical withdrawals are not
            available; security certificate expiry and the current-status heuristic are not used as
            approval end dates. Provider aliases are grouped (including predecessor brands); partner
            classification is not independently certified.
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
      </CardContent>
    </Card>
  );
}
