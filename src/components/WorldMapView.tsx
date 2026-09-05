import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import worldTopo from "world-atlas/countries-110m.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Minus, Plus, RotateCcw, Globe2, ArrowLeft } from "lucide-react";

export type MapCard = {
  id: string;
  country: string;
  country_flag?: string;
  generation: string;
  application?: string;
  tachograph_application_os?: string;
  type_approval_number: string;
  current_manufacturer_normalized: string;
  current_manufacturer: string;
  date_status: string;
  issued_by_authority: string;
  certificate_holder: string;
  certified_security_platform?: string;
  chip_certificate?: string;
  chip_platform_vendor: string;
  security_certificate?: string;
  security_certificate_lab?: string;
  functional_certificate_lab?: string;
  jrc_interoperability_status?: string;
  jrc_certificate_source?: string;
  primary_source?: string;
  card_quantities?: string;
  latest_tender?: string;
  winner_contractor?: string;
  procurement_status?: string;
  procurement_scope?: string;
  tender_source?: string;
  verification_note?: string;
};

const CARD_FIELDS: Array<[keyof MapCard, string]> = [
  ["country", "Country"],
  ["generation", "Generation"],
  ["application", "Application"],
  ["tachograph_application_os", "Tachograph Application / OS"],
  ["type_approval_number", "Type Approval Number"],
  ["issued_by_authority", "Issued by Authority"],
  ["date_status", "Date / Status"],
  ["certificate_holder", "Certificate Holder"],
  ["certified_security_platform", "Certified Security Platform"],
  ["chip_certificate", "Chip Certificate"],
  ["chip_platform_vendor", "Chip / Platform Vendor"],
  ["security_certificate", "Security Certificate"],
  ["security_certificate_lab", "Security Certificate Lab"],
  ["functional_certificate_lab", "Functional Certificate Lab"],
  ["jrc_interoperability_status", "JRC Interoperability Status"],
  ["jrc_certificate_source", "JRC / Certificate Source"],
  ["primary_source", "Primary Source"],
  ["card_quantities", "Card Quantities"],
];

const PROCUREMENT_FIELDS: Array<[keyof MapCard, string]> = [
  ["latest_tender", "Latest Tender / Procurement Procedure"],
  ["winner_contractor", "Winner / Contractor"],
  ["procurement_status", "Procurement Status"],
  ["procurement_scope", "Procurement Scope"],
  ["tender_source", "Tender Source"],
  ["verification_note", "Verification Note"],
];


/** App country name -> name used by the world-atlas dataset. */
const NAME_ALIASES: Record<string, string> = {
  "Bosnia and Herzegovina": "Bosnia and Herz.",
  "North Macedonia": "Macedonia",
  "Türkiye": "Turkey",
};

/** Micro states missing from the 110m dataset — rendered as point markers. */
const MICRO_STATES: Record<string, [number, number]> = {
  Malta: [14.4, 35.9],
  Monaco: [7.42, 43.74],
  "San Marino": [12.46, 43.94],
  Liechtenstein: [9.55, 47.15],
};

/** Label positions for countries whose geographic centroid is distorted by remote territories. */
const LABEL_COORDINATES: Record<string, [number, number]> = {
  France: [2.2, 46.2],
};

const WIDTH = 980;
const HEIGHT = 520;
const MIN_ZOOM = 1;
const MAX_ZOOM = 14;

type CountryFeature = {
  name: string;
  d: string;
  centroid: [number, number];
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function WorldMapView({
  cards,
  flagUrl,
}: {
  cards: MapCard[];
  flagUrl?: (country: string, size?: 40 | 80) => string | null;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [countryModal, setCountryModal] = useState<string | null>(null);
  const [cardModal, setCardModal] = useState<MapCard | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, MapCard[]>();
    for (const c of cards) {
      if (!c.country) continue;
      const list = map.get(c.country) ?? [];
      list.push(c);
      map.set(c.country, list);
    }
    return map;
  }, [cards]);

  const { shapes, markers, labelPositions } = useMemo(() => {
    const topo = worldTopo as unknown as Parameters<typeof feature>[0];
    const geo = feature(
      topo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (topo as any).objects.countries,
    ) as unknown as FeatureCollection<Geometry, { name: string }>;

    const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], geo as GeoPermissibleObjects);
    const path = geoPath(projection);

    const shapes: CountryFeature[] = [];
    for (const f of geo.features) {
      const d = path(f as unknown as GeoPermissibleObjects);
      if (!d) continue;
      const c = path.centroid(f as unknown as GeoPermissibleObjects);
      shapes.push({ name: f.properties?.name ?? "", d, centroid: [c[0], c[1]] });
    }

    const markers: Array<{ name: string; xy: [number, number] }> = [];
    for (const [name, lonlat] of Object.entries(MICRO_STATES)) {
      const p = projection(lonlat);
      if (p) markers.push({ name, xy: [p[0], p[1]] });
    }
    const labelPositions = new Map<string, [number, number]>();
    for (const [name, lonlat] of Object.entries(LABEL_COORDINATES)) {
      const p = projection(lonlat);
      if (p) labelPositions.set(name, [p[0], p[1]]);
    }
    return { shapes, markers, labelPositions };
  }, []);

  /** Reverse alias lookup: atlas name -> app country name that has data. */
  const atlasToApp = useMemo(() => {
    const m = new Map<string, string>();
    for (const country of counts.keys()) {
      m.set(NAME_ALIASES[country] ?? country, country);
    }
    return m;
  }, [counts]);

  const labels = useMemo(() => {
    const out: Array<{ country: string; xy: [number, number]; cards: MapCard[] }> = [];
    for (const s of shapes) {
      const app = atlasToApp.get(s.name);
      if (!app) continue;
       const adjusted = labelPositions.get(app);
       out.push({
         country: app,
         xy: adjusted ?? s.centroid,
         cards: counts.get(app) ?? [],
       });
    }
    for (const m of markers) {
      const list = counts.get(m.name);
      if (!list) continue;
      out.push({ country: m.name, xy: m.xy, cards: list });
    }
    return out;
  }, [shapes, markers, labelPositions, atlasToApp, counts]);

  // Native, non-passive wheel handling (React onWheel is passive).
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const py = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    setZoom((z) => {
      const next = clamp(z * Math.exp(-dy * 0.0018), MIN_ZOOM, MAX_ZOOM);
      const k = next / z;
      setOffset((o) => ({ x: px - (px - o.x) * k, y: py - (py - o.y) * k }));
      return next;
    });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelRef.current(e);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    setZoom((z) => {
      const next = clamp(z * factor, MIN_ZOOM, MAX_ZOOM);
      const k = next / z;
      const cx = WIDTH / 2;
      const cy = HEIGHT / 2;
      setOffset((o) => ({ x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k }));
      return next;
    });
  };

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const selectedCards = selected ? (counts.get(selected) ?? []) : [];
  const countryCards = countryModal
    ? [...(counts.get(countryModal) ?? [])].sort((a, b) =>
        String(a.type_approval_number || "").localeCompare(String(b.type_approval_number || "")),
      )
    : [];
  const showNumbers = zoom >= 3.5;


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-4 w-4 text-primary" />
              Type approvals per country
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Scroll to zoom · drag to pan · click a country
              </span>
              <Button size="icon" variant="outline" onClick={() => zoomBy(1.5)} title="Zoom in">
                <Plus className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" onClick={() => zoomBy(1 / 1.5)} title="Zoom out">
                <Minus className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" onClick={reset} title="Reset view">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            ref={containerRef}
            className="relative w-full cursor-grab overflow-hidden rounded-lg border bg-muted/30 active:cursor-grabbing"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const sx = WIDTH / rect.width;
              const sy = HEIGHT / rect.height;
              setOffset({
                x: d.ox + (e.clientX - d.x) * sx,
                y: d.oy + (e.clientY - d.y) * sy,
              });
            }}
            onPointerUp={() => (dragRef.current = null)}
            onPointerLeave={() => (dragRef.current = null)}
          >
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto w-full touch-none select-none"
              role="img"
              aria-label="World map of tachograph card type approvals"
            >
              <g transform={`translate(${offset.x},${offset.y}) scale(${zoom})`}>
                {shapes.map((s) => {
                  const app = atlasToApp.get(s.name);
                  const active = app && app === selected;
                  return (
                    <path
                      key={s.name}
                      d={s.d}
                      className={
                        app
                          ? active
                            ? "cursor-pointer fill-primary stroke-background"
                            : "cursor-pointer fill-primary/35 stroke-background hover:fill-primary/60"
                          : "fill-muted stroke-background"
                      }
                      strokeWidth={0.5 / zoom}
                      onClick={() => app && setSelected(app)}
                    >
                      <title>
                        {app ? `${app}: ${counts.get(app)?.length ?? 0} type approval(s)` : s.name}
                      </title>
                    </path>
                  );
                })}

                {labels.map((l) => {
                  const active = l.country === selected;
                  return (
                    <g
                      key={l.country}
                      transform={`translate(${l.xy[0]},${l.xy[1]}) scale(${1 / zoom})`}
                      className="cursor-pointer"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(l.country);
                        setCardModal(null);
                        setCountryModal(l.country);
                      }}
                    >

                      <circle
                        r={11}
                        className={
                          active
                            ? "fill-primary stroke-background"
                            : "fill-background stroke-primary"
                        }
                        strokeWidth={1.5}
                      />
                      <text
                        textAnchor="middle"
                        dy="0.35em"
                        className={
                          "text-[11px] font-semibold " +
                          (active ? "fill-primary-foreground" : "fill-foreground")
                        }
                      >
                        {l.cards.length}
                      </text>
                      {showNumbers && (
                        <text
                          textAnchor="middle"
                          y={24}
                          className="fill-foreground text-[9px] font-medium"
                        >
                          {l.country}
                        </text>
                      )}
                      {showNumbers &&
                        l.cards.slice(0, 4).map((c, i) => (
                          <text
                            key={c.id}
                            textAnchor="middle"
                            y={34 + i * 10}
                            className="fill-muted-foreground text-[8px]"
                          >
                            {c.type_approval_number || c.generation}
                          </text>
                        ))}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {selected ? `${selected} — ${selectedCards.length} type approval(s)` : "Details"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selected && (
            <p className="text-sm text-muted-foreground">
              Click a country (or its number) on the map to see the type approval numbers and their
              details here.
            </p>
          )}
          {selected && selectedCards.length === 0 && (
            <p className="text-sm text-muted-foreground">No data for this country.</p>
          )}
          {selectedCards.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Type Approval</th>
                    <th className="py-2 pr-4 font-medium">Generation</th>
                    <th className="py-2 pr-4 font-medium">Manufacturer</th>
                    <th className="py-2 pr-4 font-medium">Authority</th>
                    <th className="py-2 pr-4 font-medium">Date / Status</th>
                    <th className="py-2 pr-4 font-medium">Chip / Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCards.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50"
                      title="Click for full details"
                      onClick={() => {
                        setCountryModal(null);
                        setCardModal(c);
                      }}
                    >
                      <td className="py-2 pr-4 font-medium text-primary underline-offset-2 hover:underline">
                        {c.type_approval_number || "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{c.generation || "—"}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </td>
                      <td className="py-2 pr-4">{c.issued_by_authority || "—"}</td>
                      <td className="py-2 pr-4">{c.date_status || "—"}</td>
                      <td className="py-2 pr-4">{c.chip_platform_vendor || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Country list window — opened by clicking the number on the map */}
      <Dialog open={!!countryModal} onOpenChange={(o) => !o && setCountryModal(null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {countryModal && flagUrl?.(countryModal, 40) && (
                <img
                  src={flagUrl(countryModal, 40)!}
                  alt={`${countryModal} flag`}
                  className="h-6 w-9 rounded border object-cover"
                />
              )}
              <span>
                {countryModal} · {countryCards.length} type approval(s)
              </span>
            </DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Type Approval</th>
                <th className="py-2 pr-4 font-medium">Generation</th>
                <th className="py-2 pr-4 font-medium">Date / Status</th>
                <th className="py-2 pr-4 font-medium">Manufacturer</th>
              </tr>
            </thead>
            <tbody>
              {countryCards.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-b align-top last:border-0 hover:bg-muted/50"
                  title="Click for full details"
                  onClick={() => {
                    setCountryModal(null);
                    setCardModal(c);
                  }}
                >
                  <td className="py-2 pr-4 font-medium text-primary underline-offset-2 hover:underline">
                    {c.type_approval_number || "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant="secondary">{c.generation || "—"}</Badge>
                  </td>
                  <td className="py-2 pr-4">{c.date_status || "—"}</td>
                  <td className="py-2 pr-4">
                    {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>

      {/* Full card details */}
      <Dialog open={!!cardModal} onOpenChange={(o) => !o && setCardModal(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {cardModal && flagUrl?.(cardModal.country, 40) && (
                <img
                  src={flagUrl(cardModal.country, 40)!}
                  alt={`${cardModal.country} flag`}
                  className="h-6 w-9 rounded border object-cover"
                />
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const c = cardModal?.country ?? null;
                  setCardModal(null);
                  setCountryModal(c);
                }}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <span>
                {cardModal?.country} · {cardModal?.type_approval_number || "—"}
              </span>
              <Badge variant="secondary">{cardModal?.generation || "—"}</Badge>
            </DialogTitle>
          </DialogHeader>
          {cardModal && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-semibold">Card &amp; Certification</h3>
                <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                  {CARD_FIELDS.map(([k, label]) => (
                    <ModalField key={k as string} label={label} value={cardModal[k]} />
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Procurement</h3>
                <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                  {PROCUREMENT_FIELDS.map(([k, label]) => (
                    <ModalField key={k as string} label={label} value={cardModal[k]} />
                  ))}
                </div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

}
