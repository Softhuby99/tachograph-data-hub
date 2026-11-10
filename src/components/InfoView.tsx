import { useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowDown,
  Building2,
  CheckCircle2,
  Flag,
  KeyRound,
  Layers,
  MapPin,
  Minus,
  PackageOpen,
  Radio,
  Satellite,
  ShieldCheck,
  Truck,
  User,
  Wrench,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * v2.76: "Info" tab — a visual guide to the tachograph card.
 *  1. the four card types and the three generations,
 *  2. the Generation 1 file structure for all four card types,
 *  3. what Generation 2 version 1 ("G2.1", smart tachograph) and
 *     version 2 ("G2.2", smart tachograph 2) added.
 *
 * Static content, no data access. Sources: Annex IB (Reg. 3821/85), Annex IC
 * (Reg. (EU) 2016/799 incl. Appendices 1 and 2), Reg. (EU) 2021/1228, JRC
 * smart tachograph page.
 */

type CardKey = "driver" | "workshop" | "control" | "company";
type Icon = ComponentType<{ className?: string }>;

const CARD_KEYS: CardKey[] = ["driver", "workshop", "control", "company"];

const CARD_TYPES: Record<
  CardKey,
  {
    label: string;
    colourName: string;
    icon: Icon;
    holder: string;
    validity: string;
    does: string;
    /** card face (the plastic) */
    face: string;
    /** pills, selected column tint, small dots */
    soft: string;
    dot: string;
    tint: string;
  }
> = {
  driver: {
    label: "Driver card",
    colourName: "white",
    icon: User,
    holder: "The driver (personal, one per person)",
    validity: "5 years",
    does:
      "Stores what the driver did: activities, vehicles used, places, incidents. " +
      "It is the card that is read at roadside controls and by fleet download tools.",
    face: "from-slate-50 to-slate-200 text-slate-800 border-slate-300 dark:from-slate-200 dark:to-slate-400 dark:text-slate-900",
    soft: "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
    dot: "bg-slate-400",
    tint: "bg-slate-500/10",
  },
  workshop: {
    label: "Workshop card",
    colourName: "red",
    icon: Wrench,
    holder: "A technician of an approved workshop",
    validity: "1 year, protected by a PIN",
    does:
      "Lets a workshop install, calibrate and seal a tachograph. It keeps the calibration " +
      "records and the pairing data of the motion sensor, and also works like a driver card.",
    face: "from-red-500 to-red-700 text-white border-red-700",
    soft: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100",
    dot: "bg-red-500",
    tint: "bg-red-500/10",
  },
  control: {
    label: "Control card",
    colourName: "blue",
    icon: ShieldCheck,
    holder: "An enforcement officer of a control authority",
    validity: "Set by the issuing authority",
    does:
      "Gives inspectors access to all data of a tachograph and of driver cards, and logs " +
      "the controls it performed. Generation 2 control cards also verify remote (DSRC) enquiries.",
    face: "from-sky-500 to-blue-700 text-white border-blue-700",
    soft: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100",
    dot: "bg-sky-500",
    tint: "bg-sky-500/10",
  },
  company: {
    label: "Company card",
    colourName: "yellow",
    icon: Building2,
    holder: "A transport company (one per company or fleet)",
    validity: "Set by the issuing authority",
    does:
      "Locks a vehicle unit to a company so that only that company can download its data, " +
      "and logs these lock-in, lock-out and download actions.",
    face: "from-amber-300 to-amber-500 text-amber-950 border-amber-500",
    soft: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100",
    dot: "bg-amber-400",
    tint: "bg-amber-500/10",
  },
};

// ---------------------------------------------------------------------------
// Generation 1 file structure
// ---------------------------------------------------------------------------

type FileRow = { name: string; text: string; cards: CardKey[] };
type FileGroup = { title: string; place: string; icon: Icon; rows: FileRow[] };

const ALL: CardKey[] = ["driver", "workshop", "control", "company"];
const DW: CardKey[] = ["driver", "workshop"];

const G1_GROUPS: FileGroup[] = [
  {
    title: "Card and chip",
    place: "MF (root, outside the tachograph application)",
    icon: Layers,
    rows: [
      {
        name: "EF ICC",
        text: "Card identification: extended serial number, card approval number, personaliser and embedder.",
        cards: ALL,
      },
      {
        name: "EF IC",
        text: "Chip identification: chip serial number and manufacturing reference.",
        cards: ALL,
      },
    ],
  },
  {
    title: "Identity and trust",
    place: "DF Tachograph",
    icon: KeyRound,
    rows: [
      {
        name: "EF Application_Identification",
        text: "Card type, structure version and the size of the data areas (how many events, vehicle records, places).",
        cards: ALL,
      },
      {
        name: "EF Card_Certificate",
        text: "Public key of the card, signed by the Member State. Lets a tachograph check that the card is genuine.",
        cards: ALL,
      },
      {
        name: "EF CA_Certificate",
        text: "Certificate of the issuing Member State, the root of that chain.",
        cards: ALL,
      },
      {
        name: "EF Identification",
        text: "Card number, issuing authority, issue and expiry date, plus the holder (driver: name and birth date; workshop and company: name and address).",
        cards: ALL,
      },
    ],
  },
  {
    title: "Driver activity and vehicle use",
    place: "DF Tachograph",
    icon: Truck,
    rows: [
      {
        name: "EF Driver_Activity_Data",
        text: "Driving, work, availability and rest per day, stored for at least the last 28 days.",
        cards: DW,
      },
      {
        name: "EF Vehicles_Used",
        text: "Vehicles driven: plate, odometer at start and end, first and last use.",
        cards: DW,
      },
      {
        name: "EF Places",
        text: "Where each daily work period started and ended (country and region).",
        cards: DW,
      },
      {
        name: "EF Current_Usage",
        text: "The vehicle the card is in right now and when it was inserted.",
        cards: DW,
      },
      {
        name: "EF Specific_Conditions",
        text: "Special entries: out of scope, ferry or train crossing.",
        cards: DW,
      },
    ],
  },
  {
    title: "Incidents and controls",
    place: "DF Tachograph",
    icon: ShieldCheck,
    rows: [
      {
        name: "EF Events_Data",
        text: "Recorded incidents such as driving without a valid card, over-speeding, power interruption or a security breach attempt.",
        cards: DW,
      },
      { name: "EF Faults_Data", text: "Faults of the card or of the tachograph.", cards: DW },
      {
        name: "EF Control_Activity_Data",
        text: "The most recent roadside control: date, type and the officer’s card.",
        cards: DW,
      },
      { name: "EF Card_Download", text: "Date of the last download of the card.", cards: DW },
    ],
  },
  {
    title: "Driver only",
    place: "DF Tachograph",
    icon: User,
    rows: [
      {
        name: "EF Driving_Licence_Info",
        text: "Issuing authority and number of the driving licence.",
        cards: ["driver"],
      },
    ],
  },
  {
    title: "Workshop only",
    place: "DF Tachograph",
    icon: Wrench,
    rows: [
      {
        name: "EF Calibration",
        text: "A record for every calibration: vehicle, tyre size, characteristic constants, seals, date.",
        cards: ["workshop"],
      },
      {
        name: "EF Sensor_Installation_Data",
        text: "Pairing data that couples the motion sensor with the vehicle unit.",
        cards: ["workshop"],
      },
    ],
  },
  {
    title: "Control card only",
    place: "DF Tachograph",
    icon: ShieldCheck,
    rows: [
      {
        name: "EF Controller_Activity_Data",
        text: "Log of the controls performed with this card: time, type, place and vehicle.",
        cards: ["control"],
      },
    ],
  },
  {
    title: "Company card only",
    place: "DF Tachograph",
    icon: Building2,
    rows: [
      {
        name: "EF Company_Activity_Data",
        text: "Log of the company’s actions: locking in and out of vehicle units, data downloads.",
        cards: ["company"],
      },
    ],
  },
];

function fileCount(card: CardKey): number {
  return G1_GROUPS.reduce((n, g) => n + g.rows.filter((r) => r.cards.includes(card)).length, 0);
}

const G1_NOTES: Record<CardKey, string[]> = {
  driver: [
    "The richest card: the daily record of one person.",
    "Keeps at least 28 days of activities, plus vehicles, places, incidents and the last control.",
    "Holds no workshop or company data.",
  ],
  workshop: [
    "Contains everything of a driver card except the driving licence file.",
    "Adds the calibration records and the sensor pairing data.",
    "Needs a PIN before it works in a tachograph.",
  ],
  control: [
    "A small file set: identity and trust plus one log of its own controls.",
    "The value lies in its access rights: it can read and verify all data of a tachograph.",
    "It stores no driver activity.",
  ],
  company: [
    "A small file set: identity and trust plus one log of company actions.",
    "Its job is access: it locks a vehicle unit to the company and allows downloads.",
    "It stores no driver activity.",
  ],
};

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

type Feature = { icon: Icon; title: string; text: string; files?: string[]; cards?: string };

const GENERATIONS = [
  {
    id: "g1",
    name: "G1",
    long: "Digital tachograph",
    law: "Reg. (EEC) 3821/85, Annex IB",
    when: "Cards since 2002, mandatory in new vehicles since 2006",
    box: "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60",
    badge: "bg-slate-600 text-white",
  },
  {
    id: "g21",
    name: "G2.1",
    long: "Smart tachograph, generation 2 version 1",
    law: "Reg. (EU) 2016/799, Annex IC",
    when: "Mandatory in newly registered vehicles since June 2019",
    box: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
    badge: "bg-sky-600 text-white",
  },
  {
    id: "g22",
    name: "G2.2",
    long: "Smart tachograph 2, generation 2 version 2",
    law: "Reg. (EU) 2021/1228 (amends Annex IC)",
    when: "Mandatory in newly registered vehicles since 21 Aug 2023",
    box: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
    badge: "bg-emerald-600 text-white",
  },
];

const G21_NEW: Feature[] = [
  {
    icon: Layers,
    title: "A second set of files",
    text:
      "The card now carries two application areas side by side: the classic DF Tachograph (G1) and the new " +
      "DF Tachograph_G2. This is why a G2 card still works in an old G1 tachograph.",
    files: ["DF Tachograph_G2"],
  },
  {
    icon: KeyRound,
    title: "Modern cryptography",
    text:
      "Elliptic-curve keys, AES and SHA-2 replace RSA-1024, SHA-1 and 3DES. The single Card_Certificate becomes " +
      "a chain: one certificate for mutual authentication, one for signing, plus the CA and a link certificate.",
    files: ["EF Card_MA_Certificate", "EF Card_Sign_Certificate", "EF Link_Certificate"],
  },
  {
    icon: Satellite,
    title: "Satellite positions",
    text:
      "The vehicle’s GNSS position is stored automatically: at the start and end of the daily work period " +
      "and after every 3 hours of accumulated driving. No more typing in places by hand.",
    files: ["EF GNSS_Places"],
  },
  {
    icon: Truck,
    title: "Which tachograph was used",
    text:
      "The card remembers in which vehicle unit it was inserted (type and software version). " +
      "The vehicle records now also show the vehicle identification number next to the plate.",
    files: ["EF VehicleUnits_Used"],
  },
  {
    icon: Radio,
    title: "Remote checks",
    text:
      "Workshop and control cards can process DSRC messages, the short-range radio used by roadside " +
      "enforcement to read a vehicle’s tachograph while it drives past.",
    cards: "Workshop and control card",
  },
];

const G22_NEW: Feature[] = [
  {
    icon: Flag,
    title: "Border crossings",
    text: "Every crossing of a national border is stored with time, the countries concerned and the position. Used to check cabotage and the posting of workers.",
    files: ["EF Border_Crossings"],
    cards: "Driver and workshop card",
  },
  {
    icon: PackageOpen,
    title: "Loading and unloading",
    text: "Loading, unloading and simultaneous loading and unloading are logged with time and position, and the driver can enter the type of load (goods or passengers).",
    files: ["EF Load_Unload_Operations", "EF Load_Type_Entries"],
    cards: "Driver and workshop card",
  },
  {
    icon: Satellite,
    title: "Authenticated positions",
    text: "Each stored position carries an authentication status. With Galileo OSNMA the tachograph can tell a genuine satellite signal from a spoofed one.",
    files: ["EF Places_Authentication", "EF GNSS_Places_Authentication"],
    cards: "Driver and workshop card",
  },
  {
    icon: Wrench,
    title: "More calibration data",
    text: "Workshops write additional calibration data to their card.",
    files: ["EF Calibration_Add_Data"],
    cards: "Workshop card",
  },
  {
    icon: Layers,
    title: "Tachograph settings and a new header",
    text: "All four card types can hold the holder’s tachograph configuration, and every card gets a version 2 application identification with new record counts.",
    files: ["EF VU_Configuration", "EF Application_Identification (v2)"],
    cards: "All card types",
  },
];

const VEHICLE_SIDE: { title: string; text: string }[] = [
  {
    title: "Automatic border detection",
    text: "The vehicle unit contains a map of national borders and detects a crossing itself.",
  },
  {
    title: "Galileo OSNMA",
    text: "Authentication of satellite signals against jamming and spoofing.",
  },
  {
    title: "ITS interface and updates",
    text: "The interface to telematics apps and secure software upgrades become mandatory.",
  },
  {
    title: "56 days of memory",
    text: "The vehicle unit stores 56 days of data, twice the 28 days before.",
  },
];

type Compare = {
  label: string;
  g1: string | boolean;
  g21: string | boolean;
  g22: string | boolean;
};
const COMPARE: Compare[] = [
  {
    label: "Activities, vehicles, places, incidents, faults, last control",
    g1: true,
    g21: true,
    g22: true,
  },
  {
    label: "Cryptography",
    g1: "RSA-1024, SHA-1, 3DES",
    g21: "ECC, AES, SHA-2",
    g22: "ECC, AES, SHA-2",
  },
  { label: "Both file sets on the card (works in G1 devices)", g1: false, g21: true, g22: true },
  { label: "GNSS positions", g1: false, g21: true, g22: true },
  { label: "Vehicle units used", g1: false, g21: true, g22: true },
  { label: "Authenticated positions (OSNMA)", g1: false, g21: false, g22: true },
  { label: "Border crossings", g1: false, g21: false, g22: true },
  { label: "Loading, unloading and load type", g1: false, g21: false, g22: true },
  { label: "Tachograph settings on the card", g1: false, g21: false, g22: true },
];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function CardFace({ kind }: { kind: CardKey }) {
  const t = CARD_TYPES[kind];
  const Ico = t.icon;
  return (
    <div
      className={cn(
        "relative aspect-[1.586] w-full overflow-hidden rounded-xl border bg-gradient-to-br p-3 shadow-sm",
        t.face,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">Tachograph</div>
        <Ico className="h-5 w-5 opacity-80" />
      </div>
      {/* the contact chip */}
      <div className="absolute left-3 top-1/2 h-7 w-9 -translate-y-1/2 rounded-md border border-amber-600/40 bg-gradient-to-br from-amber-200 to-amber-400 shadow-inner">
        <div className="absolute inset-x-0 top-1/2 h-px bg-amber-700/40" />
        <div className="absolute inset-y-0 left-1/3 w-px bg-amber-700/40" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-amber-700/40" />
      </div>
      <div className="absolute inset-x-3 bottom-2.5">
        <div className="text-sm font-bold leading-tight">{t.label}</div>
        <div className="text-[10px] uppercase tracking-wide opacity-75">{t.colourName} card</div>
      </div>
    </div>
  );
}

function Presence({ on }: { on: boolean }) {
  return on ? (
    <CheckCircle2
      className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400"
      aria-label="yes"
    />
  ) : (
    <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="no" />
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 text-card-foreground md:p-5", className)}>
      {children}
    </div>
  );
}

function FileChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — card types and generations
// ---------------------------------------------------------------------------

function OverviewTab() {
  return (
    <div className="space-y-6">
      <Panel>
        <h3 className="text-base font-semibold">What a tachograph card is</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A smart card with a contact chip that identifies its holder to the tachograph in a truck
          or bus. The tachograph records driving times, rest and vehicle data and writes the
          driver’s share of it onto the card, so the data travels with the person. There are four
          card types, each with a different job and a different set of files.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CARD_KEYS.map((k) => {
            const t = CARD_TYPES[k];
            return (
              <div key={k} className="flex flex-col gap-3">
                <CardFace kind={k} />
                <div className="space-y-1.5 text-sm">
                  <p className="text-muted-foreground">{t.does}</p>
                  <p>
                    <span className="font-medium">Holder: </span>
                    <span className="text-muted-foreground">{t.holder}</span>
                  </p>
                  <p>
                    <span className="font-medium">Validity: </span>
                    <span className="text-muted-foreground">{t.validity}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <h3 className="text-base font-semibold">Three generations</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Each generation adds to the one before and keeps working with it. The names G2.1 and G2.2
          used here stand for generation 2 version 1 and generation 2 version 2 (also called smart
          tachograph and smart tachograph 2).
        </p>
        <div className="mt-4 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {GENERATIONS.map((g, i) => (
            <div key={g.id} className="contents">
              {i > 0 && (
                <div className="flex items-center justify-center text-muted-foreground">
                  <ArrowDown className="h-5 w-5 lg:-rotate-90" />
                </div>
              )}
              <div className={cn("rounded-xl border p-4", g.box)}>
                <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", g.badge)}>
                  {g.name}
                </span>
                <div className="mt-2 text-sm font-semibold">{g.long}</div>
                <div className="mt-1 text-xs text-muted-foreground">{g.law}</div>
                <div className="mt-2 text-xs">{g.when}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Backward compatibility: a G2 card holds the G1 files as well and works in older
          tachographs; they simply ignore what is new. A G1 card keeps working in smart tachographs.
          Existing vehicles in international transport had to be retrofitted in stages (analogue and
          G1 by the end of 2024, G2.1 by August 2025, light commercial vehicles above 2.5 t from
          July 2026).
        </p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — G1 file structure
// ---------------------------------------------------------------------------

function G1Tab() {
  const [sel, setSel] = useState<CardKey>("driver");
  const st = CARD_TYPES[sel];
  return (
    <div className="space-y-6">
      <Panel>
        <h3 className="text-base font-semibold">How the data is organised on a G1 card</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The chip works like a small file system. The master file (MF) is the root. Inside it sits
          the tachograph application, the DF Tachograph. Everything is stored in elementary files
          (EF), each holding one kind of data. The four card types share a common core and differ in
          the files that serve their job.
        </p>

        {/* structure diagram */}
        <div className="mt-4 flex flex-col items-stretch gap-2 text-sm md:flex-row md:items-center">
          <div className="rounded-lg border border-dashed px-3 py-2 text-center font-mono text-xs">
            MF
          </div>
          <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground md:-rotate-90" />
          <div className="flex-1 space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <FileChip>EF ICC</FileChip>
              <FileChip>EF IC</FileChip>
              <span className="text-xs text-muted-foreground">
                card and chip identification, common to all
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2">
              <span className="font-mono text-xs font-semibold">DF Tachograph</span>
              <ArrowDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                identity and trust · activity · incidents and controls · files for one card type
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {/* selector */}
      <div className="flex flex-wrap items-center gap-2">
        {CARD_KEYS.map((k) => {
          const t = CARD_TYPES[k];
          const active = sel === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSel(k)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                active ? t.soft : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <span className={cn("h-2.5 w-2.5 rounded-full", t.dot)} />
              {t.label}
              <span className="rounded-full bg-background/70 px-1.5 text-xs">
                {fileCount(k)} files
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_1fr]">
        <Panel className={cn("h-fit", st.soft)}>
          <div className="mx-auto max-w-[240px]">
            <CardFace kind={sel} />
          </div>
          <div className="mt-3 text-sm font-semibold">{fileCount(sel)} elementary files</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {G1_NOTES[sel].map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">What it holds</th>
                {CARD_KEYS.map((k) => (
                  <th
                    key={k}
                    className={cn(
                      "w-16 px-2 py-2 text-center text-xs font-medium",
                      sel === k && CARD_TYPES[k].tint,
                    )}
                  >
                    <span
                      className={cn("mx-auto mb-1 block h-2 w-2 rounded-full", CARD_TYPES[k].dot)}
                    />
                    {CARD_TYPES[k].label.replace(" card", "")}
                  </th>
                ))}
              </tr>
            </thead>
            {G1_GROUPS.map((g) => {
              const GIcon = g.icon;
              return (
                <tbody key={g.title}>
                  <tr className="border-y bg-muted/30">
                    <td colSpan={6} className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <GIcon className="h-3.5 w-3.5" />
                        {g.title}
                        <span className="font-normal normal-case tracking-normal opacity-70">
                          · {g.place}
                        </span>
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.name} className="border-b last:border-b-0">
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2 align-top",
                          r.cards.includes(sel) ? "" : "opacity-45",
                        )}
                      >
                        <FileChip>{r.name}</FileChip>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 align-top text-muted-foreground",
                          r.cards.includes(sel) ? "" : "opacity-45",
                        )}
                      >
                        {r.text}
                      </td>
                      {CARD_KEYS.map((k) => (
                        <td
                          key={k}
                          className={cn("px-2 py-2 align-middle", sel === k && CARD_TYPES[k].tint)}
                        >
                          <Presence on={r.cards.includes(k)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — G2.1 and G2.2
// ---------------------------------------------------------------------------

function FeatureGrid({ items, accent }: { items: Feature[]; accent: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((f) => {
        const Ico = f.icon;
        return (
          <div key={f.title} className="rounded-lg border bg-background p-3.5">
            <div className="flex items-center gap-2.5">
              <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", accent)}>
                <Ico className="h-4 w-4" />
              </span>
              <div className="text-sm font-semibold leading-tight">{f.title}</div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
            {f.files && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {f.files.map((x) => (
                  <FileChip key={x}>{x}</FileChip>
                ))}
              </div>
            )}
            {f.cards && <div className="mt-2 text-xs text-muted-foreground">On: {f.cards}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CompareCell({ v }: { v: string | boolean }) {
  if (typeof v === "string") return <span className="text-xs">{v}</span>;
  return <Presence on={v} />;
}

function GenerationsTab() {
  return (
    <div className="space-y-6">
      <Panel>
        <h3 className="text-base font-semibold">What each step adds</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Read from the top: the base is the G1 card, G2.1 adds a second, safer file set with
          satellite positions, and G2.2 adds the data needed to check border crossings, loading and
          the authenticity of positions.
        </p>

        <div className="mt-4 space-y-4">
          <div className={cn("rounded-xl border p-4", GENERATIONS[0].box)}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn("rounded-md px-2 py-0.5 text-xs font-bold", GENERATIONS[0].badge)}
              >
                G1
              </span>
              <span className="text-sm font-semibold">The base, present on every card</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Identity and certificate, driver activities, vehicles used, places entered by hand,
              incidents, faults, the last control, and the files of each card type (see the G1 tab).
            </p>
          </div>

          <div className="flex justify-center text-muted-foreground">
            <ArrowDown className="h-5 w-5" />
          </div>

          <div className={cn("rounded-xl border p-4", GENERATIONS[1].box)}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn("rounded-md px-2 py-0.5 text-xs font-bold", GENERATIONS[1].badge)}
              >
                G2.1
              </span>
              <span className="text-sm font-semibold">Adds on top of G1 — smart tachograph</span>
              <span className="text-xs text-muted-foreground">{GENERATIONS[1].law}</span>
            </div>
            <div className="mt-3">
              <FeatureGrid items={G21_NEW} accent="bg-sky-600/15 text-sky-700 dark:text-sky-300" />
            </div>
          </div>

          <div className="flex justify-center text-muted-foreground">
            <ArrowDown className="h-5 w-5" />
          </div>

          <div className={cn("rounded-xl border p-4", GENERATIONS[2].box)}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn("rounded-md px-2 py-0.5 text-xs font-bold", GENERATIONS[2].badge)}
              >
                G2.2
              </span>
              <span className="text-sm font-semibold">
                Adds on top of G2.1 — smart tachograph 2
              </span>
              <span className="text-xs text-muted-foreground">{GENERATIONS[2].law}</span>
            </div>
            <div className="mt-3">
              <FeatureGrid
                items={G22_NEW}
                accent="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
              />
            </div>
            <div className="mt-4 rounded-lg border border-dashed bg-background/60 p-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4" /> Also new in G2.2, but in the vehicle unit and not on
                the card
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {VEHICLE_SIDE.map((v) => (
                  <div key={v.title} className="text-sm">
                    <div className="font-medium">{v.title}</div>
                    <div className="text-muted-foreground">{v.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <h3 className="text-base font-semibold">At a glance</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">Capability of the card</th>
                {GENERATIONS.map((g) => (
                  <th key={g.id} className="w-32 px-2 py-2 text-center">
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", g.badge)}>
                      {g.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((c) => (
                <tr key={c.label} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{c.label}</td>
                  <td className="px-2 py-2 text-center">
                    <CompareCell v={c.g1} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <CompareCell v={c.g21} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <CompareCell v={c.g22} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function InfoView({ defaultTab = "cards" }: { defaultTab?: "cards" | "g1" | "g2" }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Tachograph card guide</h2>
        <p className="text-sm text-muted-foreground">
          What is on the card, how a G1 card is organised, and what G2.1 and G2.2 added.
        </p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="cards">Card types and generations</TabsTrigger>
          <TabsTrigger value="g1">G1 data structure</TabsTrigger>
          <TabsTrigger value="g2">G2.1 and G2.2: what is new</TabsTrigger>
        </TabsList>
        <TabsContent value="cards" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="g1" className="mt-4">
          <G1Tab />
        </TabsContent>
        <TabsContent value="g2" className="mt-4">
          <GenerationsTab />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Simplified summary for orientation. The binding file lists and data definitions are in
        Appendices 1 and 2 of Annex IB (Reg. (EEC) 3821/85) and Annex IC (Reg. (EU) 2016/799 as
        amended by Reg. (EU) 2021/1228). Sources:{" "}
        <a
          className="underline"
          href="https://eur-lex.europa.eu/eli/reg_impl/2016/799/oj"
          target="_blank"
          rel="noreferrer noopener"
        >
          Reg. 2016/799
        </a>
        ,{" "}
        <a
          className="underline"
          href="https://eur-lex.europa.eu/eli/reg_impl/2021/1228/oj"
          target="_blank"
          rel="noreferrer noopener"
        >
          Reg. 2021/1228
        </a>
        ,{" "}
        <a
          className="underline"
          href="https://dtc.jrc.ec.europa.eu/dtc_smart_tachograph.php.html"
          target="_blank"
          rel="noreferrer noopener"
        >
          JRC smart tachograph
        </a>
        .
      </p>
    </div>
  );
}
