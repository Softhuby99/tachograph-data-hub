export type LabRole =
  | "Security evaluation / certification"
  | "Functional & interoperability certificate";

export const LAB_PATTERNS: Array<{ name: string; role: LabRole; note: string; re: RegExp }> = [
  {
    name: "ANSSI (FR)",
    role: "Security evaluation / certification",
    note: "French CC scheme — ANSSI-CC security certificates (e.g. ANSSI-CC-2022/38, 2022/36v2, 2018/11)",
    re: /anssi/i,
  },
  {
    name: "NSCIB / TÜV Rheinland (NL)",
    role: "Security evaluation / certification",
    note: "Dutch CC scheme — NSCIB-CC / CC-22-… security certificates",
    re: /nscib|CC-\d{2}-\d{6,}/i,
  },
  {
    name: "BSI (DE)",
    role: "Security evaluation / certification",
    note: "German CC scheme — BSI-DSZ security certificates",
    re: /\bbsi\b|BSI-DSZ/i,
  },
  {
    name: "RDW (NL)",
    role: "Functional & interoperability certificate",
    note: "Dutch approval authority — RDW-2016/799-… and RDW-AETR-… functional certificates",
    re: /\brdw\b/i,
  },
  {
    name: "UL TS B.V. (NL)",
    role: "Functional & interoperability certificate",
    note: "Interoperability / functional test laboratory used for RDW approvals",
    re: /\bUL\s?TS\b|UL TS B\.V\./i,
  },
  {
    name: "KBA (DE)",
    role: "Functional & interoperability certificate",
    note: "German Kraftfahrt-Bundesamt functional certificates (…-…/2023 Kontext)",
    re: /\bkba\b/i,
  },
  {
    name: "UTAC (FR)",
    role: "Functional & interoperability certificate",
    note: "French functional certification body",
    re: /utac/i,
  },
  {
    name: "CETIS",
    role: "Functional & interoperability certificate",
    note: "Functional approval referenced via CETIS / JRC",
    re: /cetis/i,
  },
  {
    name: "Swedish Transport Agency (TSV)",
    role: "Functional & interoperability certificate",
    note: "TSV functional certificates (e.g. TSV 2023-756)",
    re: /\bTSV\b|swedish transport/i,
  },
  {
    name: "JRC (EU)",
    role: "Functional & interoperability certificate",
    note: "JRC interoperability certificates / DTC listing",
    re: /\bjrc\b/i,
  },
];
