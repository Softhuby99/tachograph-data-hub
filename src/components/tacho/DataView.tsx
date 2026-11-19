import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MARKET_STATUS_LABEL,
  MARKET_STATUS_BADGE_CLASS,
  type MarketStatus,
  type MarketStatusEntry,
} from "@/lib/market-status";
import { flagUrl } from "@/lib/country-flag";
import { expiryOf } from "@/lib/expiry";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";
import { DetailView, ManufacturerTimeline } from "@/components/tacho/DetailView";
import { DEVICE_TYPES, uniq } from "@/components/tacho/constants";
import { ExpiryBadge } from "@/components/tacho/shared";
import { type Overrides, type TachoCard } from "@/components/tacho/types";

// v2.56: approval-status views of the Data list (market status per record,
// see market-status.ts). Records whose status cannot be decided stay in the
// default view so the open cases are not hidden.
type StatusView = "active" | "current" | "history" | "all";

const STATUS_VIEW_LABEL: Record<StatusView, string> = {
  active: "Active + unclear",
  current: "Active only",
  history: "History (superseded / delisted)",
  all: "All records",
};

function inStatusView(view: StatusView, status: MarketStatus | undefined): boolean {
  if (view === "all") return true;
  if (view === "current") return status === "current";
  if (view === "history") return status === "superseded" || status === "delisted";
  return status !== "superseded" && status !== "delisted";
}

export function DataView({
  cards,
  overrides,
  canEdit,
  editHint,
  onSave,
  onReset,
  onFilteredChange,
  marketStatusById,
  onShowTimeline,
}: {
  cards: TachoCard[];
  overrides: Overrides;
  canEdit: boolean;
  editHint: string;
  onSave: (id: string, patch: Partial<TachoCard>, original?: Record<string, string>) => void;
  onReset: (id: string) => void;
  /** Reports the current filter upwards so Tools can export exactly this view. */
  onFilteredChange?: (ids: string[]) => void;
  /** Current / superseded / delisted / unmatched per card id — see market-status.ts. */
  marketStatusById?: Map<string, MarketStatusEntry>;
  onShowTimeline?: (certificate: string) => void;
}) {
  const [country, setCountry] = useState("all");
  const [generation, setGeneration] = useState("all");
  const [deviceType, setDeviceType] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // v2.56: the list starts with the approvals in force (plus those whose
  // status cannot be decided); history is one click away. Remembered per browser.
  const [statusView, setStatusView] = useState<StatusView>("active");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("tdh.dataStatusView");
      if (v && v in STATUS_VIEW_LABEL) setStatusView(v as StatusView);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const chooseStatusView = (v: StatusView) => {
    setStatusView(v);
    try {
      window.localStorage.setItem("tdh.dataStatusView", v);
    } catch {
      /* storage unavailable — choice just isn't remembered */
    }
  };

  // v2.46: the list / detail split is draggable. Dragging the divider widens
  // the list; the detail pane keeps (at least) the width it has in the default
  // layout and moves right — the row scrolls horizontally instead of the
  // detail pane being squeezed. Width is remembered per browser.
  const DEFAULT_LIST_W = 360;
  const SPLITTER_W = 24;
  const [listWidth, setListWidth] = useState<number>(DEFAULT_LIST_W);
  // Read after mount (not in the initializer) so server and client render the
  // same markup first.
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem("tdh.dataListWidth"));
      if (v >= 260 && v <= 1600) setListWidth(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [detailMinWidth, setDetailMinWidth] = useState<number | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const splitDrag = useRef<{ x: number; w: number } | null>(null);
  // Width the detail pane has with the default list width; it never gets
  // narrower than that (re-measured when the window is resized).
  useEffect(() => {
    const measure = () => {
      const el = splitRef.current;
      if (el) setDetailMinWidth(Math.max(480, el.clientWidth - DEFAULT_LIST_W - SPLITTER_W));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const saveListWidth = (w: number) => {
    try {
      window.localStorage.setItem("tdh.dataListWidth", String(Math.round(w)));
    } catch {
      /* storage unavailable — width just isn't remembered */
    }
  };
  const startSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    splitDrag.current = { x: e.clientX, w: listWidth };
    document.body.style.userSelect = "none";
  };
  const moveSplitDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current;
    if (!d) return;
    setListWidth(Math.min(1600, Math.max(260, d.w + e.clientX - d.x)));
  };
  const endSplitDrag = () => {
    if (!splitDrag.current) return;
    splitDrag.current = null;
    document.body.style.userSelect = "";
    saveListWidth(listWidth);
  };

  const countries = useMemo(() => uniq(cards.map((c) => c.country)), [cards]);
  const generations = useMemo(() => uniq(cards.map((c) => c.generation)), [cards]);
  // Empty on older records: everything stored before the device type existed is
  // a card, so it is treated as one rather than shown as a blank option.
  const deviceTypes = useMemo(
    () => uniq([...DEVICE_TYPES, ...cards.map((c) => c.device_type || "Card")]),
    [cards],
  );
  const manufacturers = useMemo(
    () => uniq(cards.map((c) => c.current_manufacturer_normalized)),
    [cards],
  );

  // Everything the other filters let through, before the status view.
  const matching = useMemo(() => {
    const q = search.toLowerCase();
    return cards.filter((c) => {
      if (country !== "all" && c.country !== country) return false;
      if (generation !== "all" && c.generation !== generation) return false;
      if (deviceType !== "all" && (c.device_type || "Card") !== deviceType) return false;
      if (manufacturer !== "all" && c.current_manufacturer_normalized !== manufacturer)
        return false;
      if (!q) return true;
      return Object.values(c).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [cards, country, generation, deviceType, manufacturer, search]);
  const statusOf = (c: TachoCard) => marketStatusById?.get(c.id)?.status;
  const statusCounts = useMemo(() => {
    const n: Record<StatusView, number> = {
      active: 0,
      current: 0,
      history: 0,
      all: matching.length,
    };
    for (const c of matching) {
      for (const v of ["active", "current", "history"] as const)
        if (inStatusView(v, statusOf(c))) n[v]++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matching, marketStatusById]);
  const filtered = useMemo(
    () => matching.filter((c) => inStatusView(statusView, statusOf(c))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matching, statusView, marketStatusById],
  );
  const hiddenByStatus = matching.length - filtered.length;

  useEffect(() => {
    onFilteredChange?.(filtered.map((c) => c.id));
  }, [filtered, onFilteredChange]);

  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  return (
    <>
      <Card className="mb-6">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Full-text search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="e.g. Thales, e4-0030-00, ANSSI…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Country</label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All countries</SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Generation
            </label>
            <Select value={generation} onValueChange={setGeneration}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All generations</SelectItem>
                {generations.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Device Type
            </label>
            <Select value={deviceType} onValueChange={setDeviceType}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All device types</SelectItem>
                {deviceTypes.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Current Manufacturer
            </label>
            <Select value={manufacturer} onValueChange={setManufacturer}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All manufacturers</SelectItem>
                {manufacturers.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Approval status
            </label>
            <Select value={statusView} onValueChange={(v) => chooseStatusView(v as StatusView)}>
              <SelectTrigger title="Market status — same rule as in Market Analytics">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_VIEW_LABEL) as StatusView[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {STATUS_VIEW_LABEL[v]} ({statusCounts[v]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {manufacturer !== "all" && (
        <ManufacturerTimeline manufacturer={manufacturer} cards={filtered} />
      )}

      <div
        ref={splitRef}
        className="flex flex-col gap-6 lg:flex-row lg:gap-0 lg:overflow-x-auto lg:pb-2"
        style={
          {
            "--list-w": `${listWidth}px`,
            "--detail-min-w": detailMinWidth ? `${detailMinWidth}px` : "0px",
          } as CSSProperties
        }
      >
        <div className="min-w-0 lg:w-[var(--list-w)] lg:shrink-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm text-muted-foreground">
              {statusView === "all"
                ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}`
                : `${filtered.length} of ${matching.length} · ${STATUS_VIEW_LABEL[statusView].toLowerCase()}`}
            </p>
            {hiddenByStatus > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => chooseStatusView("all")}
              >
                + {hiddenByStatus} more in history — show all
              </button>
            )}
          </div>
          <ScrollArea className="h-[70vh] rounded-lg border bg-card">
            <div className="divide-y">
              {filtered.map((c) => {
                const active = selected?.id === c.id;
                const fUrl = flagUrl(c.country, 40);
                const edited = !!overrides[c.id];
                const status = marketStatusById?.get(c.id)?.status;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent " +
                      (active ? "bg-accent" : "")
                    }
                  >
                    {fUrl ? (
                      <img
                        src={fUrl}
                        alt={`${c.country} flag`}
                        width={32}
                        height={24}
                        loading="lazy"
                        className="h-6 w-8 shrink-0 rounded-sm border object-cover shadow-sm"
                      />
                    ) : (
                      <span className="text-2xl leading-none">{c.country_flag}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {/* A vehicle unit or motion sensor has no country —
                              without a fallback the row would be blank. */}
                          {c.country ||
                            c.tachograph_application_os ||
                            c.current_manufacturer ||
                            "—"}
                          {edited && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              edited
                            </Badge>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <ExpiryBadge expiry={expiryOf(c.certificate_expiry_date)} compact />
                          {status && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${MARKET_STATUS_BADGE_CLASS[status]}`}
                              title="Market status — see the Market Analytics tab"
                            >
                              {MARKET_STATUS_LABEL[status]}
                            </Badge>
                          )}
                          <Badge variant="secondary">{c.generation}</Badge>
                        </span>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </p>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {hiddenByStatus > 0
                    ? `No ${STATUS_VIEW_LABEL[statusView].toLowerCase()} records match — ${hiddenByStatus} in the history.`
                    : "No matches."}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize the list · double-click to reset"
          className="group hidden shrink-0 cursor-col-resize touch-none justify-center pt-7 lg:flex"
          style={{ width: SPLITTER_W }}
          onPointerDown={startSplitDrag}
          onPointerMove={moveSplitDrag}
          onPointerUp={endSplitDrag}
          onPointerCancel={endSplitDrag}
          onDoubleClick={() => {
            setListWidth(DEFAULT_LIST_W);
            saveListWidth(DEFAULT_LIST_W);
          }}
        >
          <div className="h-[70vh] w-1 rounded-full bg-border transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
        </div>

        <div className="min-w-0 lg:min-w-[var(--detail-min-w)] lg:flex-1">
          {selected ? (
            <DetailView
              card={selected}
              edited={!!overrides[selected.id]}
              canEdit={canEdit}
              editHint={editHint}
              onSave={(patch, original) => onSave(selected.id, patch, original)}
              onReset={() => onReset(selected.id)}
              marketStatus={marketStatusById?.get(selected.id)?.status}
              onShowTimeline={onShowTimeline}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a country on the left.</p>
          )}
        </div>
      </div>
    </>
  );
}
