import { useMemo, useState } from "react";
import {
  MARKET_STATUS_LABEL,
  MARKET_STATUS_BADGE_CLASS,
  type MarketGroup,
} from "@/lib/market-status";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { RecordDetailDialog } from "@/components/tacho/RecordDetailDialog";
import { uniq } from "@/components/tacho/constants";
import { type TachoCard } from "@/components/tacho/types";

/**
 * Succession chains: every (country, manufacturer, product group) lane with
 * more than one type approval, newest first, each tagged with its status.
 * This is the "complete history" view for market status — the Data tab
 * already lists every record flatly, so this one only earns its place by
 * showing the *lineage* a flat list can't.
 */
export function MarketHistoryView({
  groups,
  cards,
}: {
  groups: MarketGroup[];
  cards: TachoCard[];
}) {
  const [deviceType, setDeviceType] = useState("all");
  const [search, setSearch] = useState("");
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const deviceTypes = useMemo(() => uniq(groups.map((g) => g.deviceType || "Card")), [groups]);

  const chains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => g.entries.length > 1)
      .filter((g) => deviceType === "all" || (g.deviceType || "Card") === deviceType)
      .filter(
        (g) =>
          !q ||
          g.country.toLowerCase().includes(q) ||
          g.manufacturers.some((m) => m.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) => a.country.localeCompare(b.country) || a.deviceType.localeCompare(b.deviceType),
      );
  }, [groups, deviceType, search]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Search country / manufacturer
            </label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Ukraine"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Product group
            </label>
            <Select value={deviceType} onValueChange={setDeviceType}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All product groups</SelectItem>
                {deviceTypes.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {chains.length} lane{chains.length === 1 ? "" : "s"} with more than one type approval on
        record.
      </p>

      <div className="space-y-4">
        {chains.map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {g.country || "—"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {g.deviceType}
                </span>
              </CardTitle>
              {g.manufacturers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {g.manufacturers.length > 1 ? "Manufacturers: " : "Manufacturer: "}
                  {g.manufacturers.join(", ")}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 border-l pl-4">
                {g.entries.map((e) => (
                  <li
                    key={e.id}
                    className="relative cursor-pointer rounded-r px-1 py-0.5 -ml-1 hover:bg-accent/60"
                    onClick={() => cardById.get(e.id) && setDetailCard(cardById.get(e.id)!)}
                    title="Click for full details"
                  >
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.type_approval_number || "—"}</span>
                      <Badge variant="secondary" className="text-xs">
                        {e.generation || "—"}
                      </Badge>
                      {e.manufacturer && (
                        <Badge variant="outline" className="text-xs">
                          {e.manufacturer}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs ${MARKET_STATUS_BADGE_CLASS[e.status]}`}
                      >
                        {MARKET_STATUS_LABEL[e.status]}
                      </Badge>
                      {e.closeDateWarningDays !== undefined && (
                        <Badge
                          variant="outline"
                          className="text-xs border-amber-500 text-amber-600"
                          title={`Only ${e.closeDateWarningDays} day${e.closeDateWarningDays === 1 ? "" : "s"} from the top entry of the same generation in this lane — unclear which one is current, worth a manual check for a data entry error.`}
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" /> Check dates
                        </Badge>
                      )}
                      <span
                        className="text-xs text-muted-foreground"
                        title={
                          e.ranking_date_source === "security_certificate"
                            ? "No type approval date on file — ranked by the security certificate date instead."
                            : undefined
                        }
                      >
                        {e.ranking_date_source === "approval"
                          ? `approved ${e.ranking_date}`
                          : e.ranking_date_source === "security_certificate"
                            ? `${e.ranking_date} (security cert., no approval date)`
                            : "no approval date on file"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}
        {chains.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            No multi-entry lanes match this filter.
          </p>
        )}
      </div>

      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </div>
  );
}
