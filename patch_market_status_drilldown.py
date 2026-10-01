import pathlib, sys

p = pathlib.Path("src/routes/index.tsx")
s = p.read_text()

def apply(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (need exactly 1)")
        sys.exit(1)
    s = s.replace(old, new, 1)
    print(f"OK [{label}]")

# 1) Replace AnalyticsView's inline record-detail Dialog with the shared component call.
apply(
'''      {/* Record window, opened from a drill-down row. It stacks on top of the
          list, so "Back" simply closes it and the list is still there. */}
      <Dialog open={!!drillCard} onOpenChange={(o) => !o && setDrillCard(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setDrillCard(null)}
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              {drillCard && flagUrl(drillCard.country, 40) && (
                <img
                  src={flagUrl(drillCard.country, 40)!}
                  alt=""
                  className="h-6 w-9 rounded border object-cover"
                />
              )}
              <span>
                {drillCard?.country} · {drillCard?.type_approval_number || "—"}
              </span>
            </DialogTitle>
          </DialogHeader>
          {drillCard && (
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {GROUP1_FIELDS.map(([k, label]) => {
                const key = k as string;
                let value = String((drillCard as Record<string, unknown>)[key] ?? "");
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
              {drillCard.verification_note && (
                <Field
                  label="Verification Note"
                  value={drillCard.verification_note}
                  className="md:col-span-2"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );''',
'''      {/* Record window, opened from a drill-down row. It stacks on top of the
          list, so "Back" simply closes it and the list is still there. Shared
          with Current Status / History so every drill-down surface opens the
          same record window. */}
      <RecordDetailDialog card={drillCard} onClose={() => setDrillCard(null)} />
    </div>
  );''',
    "1-analytics-dialog-swap",
)

# 2) Insert the shared RecordDetailDialog component + new local state in CurrentStatusView.
apply(
'''function CurrentStatusView({
  cards,
  marketStatus,
}: {
  cards: TachoCard[];
  marketStatus: { byId: Map<string, MarketStatusEntry>; groups: MarketGroup[] };
}) {
  const [deviceType, setDeviceType] = useState("all");''',
'''/** Full-record window, opened from any drill-down list (Overview, Current
 * Status, History) — one implementation so every surface shows the same
 * fields in the same layout. */
function RecordDetailDialog({ card, onClose }: { card: TachoCard | null; onClose: () => void }) {
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

function CurrentStatusView({
  cards,
  marketStatus,
}: {
  cards: TachoCard[];
  marketStatus: { byId: Map<string, MarketStatusEntry>; groups: MarketGroup[] };
}) {
  const [deviceType, setDeviceType] = useState("all");
  const [selectedMfg, setSelectedMfg] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);''',
    "2-shared-dialog-insert",
)

# 3) mfgCountries derived list.
apply(
'''  const shareMax = shareList[0]?.holders || 1;

  return (''',
'''  const shareMax = shareList[0]?.holders || 1;

  const mfgCountries = useMemo(() => {
    if (!selectedMfg) return [];
    return current
      .filter((c) => (c.current_manufacturer_normalized || c.current_manufacturer || "—") === selectedMfg)
      .sort((a, b) => a.country.localeCompare(b.country));
  }, [current, selectedMfg]);

  return (''',
    "3-mfgCountries-memo",
)

# 4) Make the manufacturer row clickable + hint text.
apply(
'''            One type approval per country/manufacturer/product-group lane — the most recently
            issued one, still listed on JRC today. {current.length} of {scoped.length} record
            {scoped.length === 1 ? "" : "s"} in scope count as current.
          </p>''',
'''            One type approval per country/manufacturer/product-group lane — the most recently
            issued one, still listed on JRC today. {current.length} of {scoped.length} record
            {scoped.length === 1 ? "" : "s"} in scope count as current. Click a row to list its
            countries.
          </p>''',
    "4-hint-text",
)

apply(
'''              <tbody>
                {shareList.map((m) => (
                  <tr key={m.name} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{m.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.holders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.countries}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.share.toFixed(1)}%</td>
                    <td className="hidden py-2 pr-3 lg:table-cell">
                      <div className="h-3 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                          style={{ width: `${(m.holders / shareMax) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {shareList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      No current entries in scope.
                    </td>
                  </tr>
                )}
              </tbody>''',
'''              <tbody>
                {shareList.map((m) => (
                  <tr
                    key={m.name}
                    onClick={() => setSelectedMfg(m.name)}
                    className="cursor-pointer border-b last:border-0 hover:bg-accent/60"
                    title="Click to list the countries"
                  >
                    <td className="py-2 pr-3 font-medium">{m.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.holders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.countries}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.share.toFixed(1)}%</td>
                    <td className="hidden py-2 pr-3 lg:table-cell">
                      <div className="h-3 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
                          style={{ width: `${(m.holders / shareMax) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {shareList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      No current entries in scope.
                    </td>
                  </tr>
                )}
              </tbody>''',
    "5-mfg-row-clickable",
)

# 6) Delisted rows clickable + new dialogs + RecordDetailDialog mount.
apply(
'''                  {delisted.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{c.country || "—"}</td>
                      <td className="py-2 pr-3">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </td>
                      <td className="py-2 pr-3">{c.device_type || "Card"}</td>
                      <td className="py-2 pr-3 font-medium">{c.type_approval_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}''',
'''                  {delisted.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setDetailCard(c)}
                      className="cursor-pointer border-b last:border-0 hover:bg-accent/60"
                      title="Click for full details"
                    >
                      <td className="py-2 pr-3">{c.country || "—"}</td>
                      <td className="py-2 pr-3">
                        {c.current_manufacturer_normalized || c.current_manufacturer || "—"}
                      </td>
                      <td className="py-2 pr-3">{c.device_type || "Card"}</td>
                      <td className="py-2 pr-3 font-medium">{c.type_approval_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Country list for the manufacturer clicked above; clicking a country
          in turn opens the full record, same two-level pattern as Overview. */}
      <Dialog open={!!selectedMfg} onOpenChange={(o) => !o && setSelectedMfg(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedMfg} · {mfgCountries.length} current approval
              {mfgCountries.length === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 pr-4 font-medium">Type Approval</th>
                <th className="py-2 pr-4 font-medium">Generation</th>
                <th className="py-2 pr-4 font-medium">Issued</th>
              </tr>
            </thead>
            <tbody>
              {mfgCountries.map((c) => {
                const fUrl = flagUrl(c.country, 40);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setDetailCard(c)}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-accent/60"
                    title="Click for full details"
                  >
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        {fUrl ? (
                          <img
                            src={fUrl}
                            alt=""
                            width={24}
                            height={18}
                            loading="lazy"
                            className="h-[18px] w-6 shrink-0 rounded-sm border object-cover"
                          />
                        ) : (
                          <span>{c.country_flag}</span>
                        )}
                        <span className="font-medium">{c.country}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-medium text-primary underline-offset-2 hover:underline">
                      {c.type_approval_number || "—"}
                    </td>
                    <td className="py-2 pr-4">{c.generation || "—"}</td>
                    <td className="py-2 pr-4">{c.certificate_issued_date || "—"}</td>
                  </tr>
                );
              })}
              {mfgCountries.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>

      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </div>
  );
}''',
    "6-delisted-clickable-plus-dialogs",
)

# 7) MarketHistoryView: accept cards, add detailCard state + lookup.
apply(
'''function MarketHistoryView({ groups }: { groups: MarketGroup[] }) {
  const [deviceType, setDeviceType] = useState("all");
  const [search, setSearch] = useState("");

  const deviceTypes = useMemo(() => uniq(groups.map((g) => g.deviceType || "Card")), [groups]);''',
'''function MarketHistoryView({ groups, cards }: { groups: MarketGroup[]; cards: TachoCard[] }) {
  const [deviceType, setDeviceType] = useState("all");
  const [search, setSearch] = useState("");
  const [detailCard, setDetailCard] = useState<TachoCard | null>(null);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const deviceTypes = useMemo(() => uniq(groups.map((g) => g.deviceType || "Card")), [groups]);''',
    "7-history-signature",
)

# 8) History entries clickable.
apply(
'''              <ol className="space-y-2 border-l pl-4">
                {g.entries.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.type_approval_number || "—"}</span>
                      <Badge variant="secondary" className="text-xs">
                        {e.generation || "—"}
                      </Badge>
                      <Badge variant="outline" className={`text-xs ${MARKET_STATUS_BADGE_CLASS[e.status]}`}>
                        {MARKET_STATUS_LABEL[e.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {e.certificate_issued_date || "no issue date on file"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>''',
'''              <ol className="space-y-2 border-l pl-4">
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
                      <Badge variant="outline" className={`text-xs ${MARKET_STATUS_BADGE_CLASS[e.status]}`}>
                        {MARKET_STATUS_LABEL[e.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {e.certificate_issued_date || "no issue date on file"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>''',
    "8-history-entry-clickable",
)

# 9) Mount RecordDetailDialog in MarketHistoryView.
apply(
'''        {chains.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            No multi-entry lanes match this filter.
          </p>
        )}
      </div>
    </div>
  );
}''',
'''        {chains.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            No multi-entry lanes match this filter.
          </p>
        )}
      </div>

      <RecordDetailDialog card={detailCard} onClose={() => setDetailCard(null)} />
    </div>
  );
}''',
    "9-history-dialog-mount",
)

# 10) Pass cards into MarketHistoryView from AnalyticsView.
apply(
'''      {subTab === "history" && <MarketHistoryView groups={marketStatus.groups} />}''',
'''      {subTab === "history" && <MarketHistoryView groups={marketStatus.groups} cards={cards} />}''',
    "10-pass-cards",
)

p.write_text(s)
print("ALL PATCHES APPLIED OK")
