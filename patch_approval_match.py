import pathlib, sys

# v2.39 — market-status.ts: recognise the same type approval written in
# different forms (e5*165/2014*980/2023*2002*00 vs JRC's e5-2002-00) by
# comparing issuing mark + approval number + extension. The old
# substring-after-stripping check stays in place as a first pass, so this
# can only ADD matches (Delisted -> Current), never remove one.

p = pathlib.Path("src/lib/market-status.ts")
s = p.read_text()

if "CLOSE_DATE_WARNING_DAYS" not in s:
    print("FAIL: market-status.ts is not at v2.38 (no CLOSE_DATE_WARNING_DAYS) — apply patch_lane_by_country.py first.")
    sys.exit(1)
if "approvalKeys" in s:
    print("SKIP: already patched (found approvalKeys).")
    sys.exit(0)

def apply(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        print(f"FAIL [{label}]: found {n} occurrences (need exactly 1)")
        sys.exit(1)
    s = s.replace(old, new, 1)
    print(f"OK [{label}]")

apply(
'''function manufacturerOf(card: MarketCard): string {''',
'''// ---------------------------------------------------------------------------
// Type approval numbers turn up in many spellings for the same approval:
//   JRC short form   e5-2002-00, e1_181_01, e26 2387/03, e4-AETR-0001-00,
//                    e2-151-Extension 1, e5-0100-v02, e1-0005-00 Korr. 01
//   full long form   e5*165/2014*980/2023*2002*00, e4*AETR*3821/85*0007*00
//   several in one   e1-232 / e1-227, e4-0042-01; zuvor e4-0026-00
// Stripping separators and doing a substring test (normApproval) cannot match
// the long form against the short one ("e516520149802023200200" does not
// contain "e5200200"), so every record stored in long form showed as
// Delisted even while JRC still lists it. approvalKeys() pulls out
// (issuing mark, approval number, extension) from every approval found in a
// string; two approvals match when mark and number agree and the extensions
// agree or one side has none (same tolerance the substring test already had).
// ---------------------------------------------------------------------------

type ApprovalKey = { mark: string; number: string; ext: string | null };

const LONG_APPROVAL_RE = /\\be\\s*(\\d{1,2}|cy)\\s*\\*[^\\s;,]*?\\*\\s*(\\d{1,5})\\s*\\*\\s*(\\d{1,2})(?!\\d)/g;
const SHORT_APPROVAL_RE =
  /\\be\\s*(\\d{1,2}|cy)\\s*[-_ ]\\s*(?:aetr\\s*[-_ ]\\s*)?(\\d{1,5})(?:\\s*[-_/]\\s*(?:v|extension\\s*)?(\\d{1,2}))?(?!\\d)/g;

function stripZeros(value: string): string {
  const t = value.replace(/^0+/, "");
  return t === "" ? "0" : t;
}

function approvalKeys(value: string | null | undefined): ApprovalKey[] {
  const text = String(value ?? "").toLowerCase();
  const out: ApprovalKey[] = [];
  for (const m of text.matchAll(LONG_APPROVAL_RE)) {
    out.push({ mark: m[1], number: stripZeros(m[2]), ext: stripZeros(m[3]) });
  }
  const rest = text.replace(LONG_APPROVAL_RE, " ");
  for (const m of rest.matchAll(SHORT_APPROVAL_RE)) {
    out.push({
      mark: m[1],
      number: stripZeros(m[2]),
      ext: m[3] !== undefined ? stripZeros(m[3]) : null,
    });
  }
  return out;
}

function keysMatch(a: ApprovalKey, b: ApprovalKey): boolean {
  return (
    a.mark === b.mark &&
    a.number === b.number &&
    (a.ext === null || b.ext === null || a.ext === b.ext)
  );
}

function manufacturerOf(card: MarketCard): string {''',
    "1-approval-key-helpers",
)

apply(
'''/** Is this type approval still listed on JRC right now, on any of the pages? */
function isListed(typeApproval: string, listing: CurrentListingEntry[]): boolean {
  const key = normApproval(typeApproval);
  if (!key) return false;
  return listing.some((e) => {
    const haystack = e.type_approval_number || normApproval(e.raw_type_approval);
    if (!haystack) return false;
    // Substring either direction: the DB sometimes stores a longer combined
    // form ("e5*165/2014*980/2023*2002*00") than JRC's short form ("e5-2002-00")
    // and vice versa — see jrc.server.ts's matchCard, which has the same shape.
    return haystack.includes(key) || key.includes(haystack);
  });
}''',
'''/** Is this type approval still listed on JRC right now, on any of the pages? */
function isListed(
  typeApproval: string,
  listing: CurrentListingEntry[],
  listingKeys: ApprovalKey[][],
): boolean {
  const key = normApproval(typeApproval);
  if (!key) return false;
  // First pass: substring either direction after stripping separators.
  // Catches cosmetic differences (e1-181-01 vs e1_181_01) and combined
  // strings, but NOT long form vs short form — see approvalKeys() above.
  const bySubstring = listing.some((e) => {
    const haystack = e.type_approval_number || normApproval(e.raw_type_approval);
    if (!haystack) return false;
    return haystack.includes(key) || key.includes(haystack);
  });
  if (bySubstring) return true;
  // Second pass: compare issuing mark + approval number + extension.
  const own = approvalKeys(typeApproval);
  if (own.length === 0) return false;
  return listingKeys.some((keys) => keys.some((k) => own.some((o) => keysMatch(o, k))));
}''',
    "2-isListed",
)

apply(
'''  const groups: MarketGroup[] = [];
  const DAY_MS = 86_400_000;''',
'''  const groups: MarketGroup[] = [];
  const DAY_MS = 86_400_000;
  // Parsed once per run rather than once per lane.
  const listingKeys = listing.map((e) => approvalKeys(e.raw_type_approval));''',
    "3-precompute-listing-keys",
)

apply(
'''          ? isListed(String(m.card.type_approval_number ?? ""), listing)''',
'''          ? isListed(String(m.card.type_approval_number ?? ""), listing, listingKeys)''',
    "4-isListed-call",
)

p.write_text(s)
print("ALL PATCHES APPLIED OK")
