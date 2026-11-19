// v2.77: e-mail when an update run finds something (Tools → Notifications).
//
// v2.79: the mail server is administered in the app (app_settings
// "notify_smtp"), next to the recipients, the sources and on/off
// ("notify_email"). The password is stored encrypted (AES-256-GCM, key derived
// from ADMIN_TOKEN) and is never sent back to the browser. The SMTP_* values of
// the container environment remain as a fallback for an instance that has no
// server saved in the app.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eventsQuery } from "@/lib/db.server";
import { getSetting, putSetting, settingsAvailable } from "@/lib/settings.server";
import { emitEvent } from "@/lib/events.server";
import {
  isMailAddress,
  addressOf,
  sendMail,
  type SmtpConfig,
  type SmtpSecurity,
} from "@/lib/smtp.server";
import { APP_VERSION } from "@/lib/version";

export type NotifyScope = "jrc" | "all";
export type NotifySettings = { enabled: boolean; recipients: string[]; scope: NotifyScope };
type NotifyLast = { at: string; ok: boolean; count: number; message: string };

const SETTINGS_KEY = "notify_email";
const LAST_KEY = "notify_email_last";

/** The pages of the JRC site; "all" adds Common Criteria, TED and research findings. */
const JRC_SOURCE_TYPES = [
  "card_status",
  "other_certificates",
  "public_key_certificates",
  "key_management",
  "security_updates",
  "manufacturer_codes",
];

/** Where the settings live. Tests swap it for a map (tools/test_notify.ts) — there is no database there. */
export type SettingsStore = {
  available: () => boolean;
  get: <T>(key: string, fallback: T) => Promise<T>;
  put: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
};
let store: SettingsStore = {
  available: settingsAvailable,
  get: getSetting,
  put: putSetting,
  remove: async (key) => {
    await eventsQuery(`DELETE FROM public.app_settings WHERE key = $1`, [key]);
  },
};
export function setSettingsStoreForTests(next: SettingsStore): void {
  store = next;
}

const env = (k: string) => (process.env[k] ?? "").trim();

const SMTP_KEY = "notify_smtp";

/** The mail server as saved in the app. `pass` is the encrypted password ("" = none). */
type StoredSmtp = {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  pass: string;
  from: string;
  tlsVerify: boolean;
};

// ---- password at rest
//
// The key comes from ADMIN_TOKEN, which exists only in the container
// environment: a database dump or a read-only database login does not reveal
// the mail password. Changing ADMIN_TOKEN makes the stored password unreadable
// — it then has to be entered again (the app says so).

function secretKey(): Buffer | null {
  const token = process.env["ADMIN_TOKEN"] ?? "";
  return token ? scryptSync(token, "tdh-notify-smtp-v1", 32) : null;
}

export function encryptSecret(plain: string, key: Buffer | null = secretKey()): string {
  if (!key) throw new Error("ADMIN_TOKEN is not set — a password cannot be stored.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(":");
}

/** The stored password in clear, or null when it cannot be read (key changed, value damaged). */
export function decryptSecret(stored: string, key: Buffer | null = secretKey()): string | null {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== "v1" || !iv || !tag || body === undefined || !key) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

function envSmtp(): SmtpConfig | null {
  const host = env("SMTP_HOST");
  const from = env("SMTP_FROM");
  if (!host || !addressOf(from)) return null;
  const raw = env("SMTP_SECURITY").toLowerCase();
  const port = Number(env("SMTP_PORT")) || (raw === "tls" ? 465 : raw === "none" ? 25 : 587);
  const security: SmtpSecurity =
    raw === "tls" || raw === "starttls" || raw === "none" ? raw : port === 465 ? "tls" : "starttls";
  return {
    host,
    port,
    security,
    user: env("SMTP_USER") || undefined,
    pass: process.env["SMTP_PASS"] ?? undefined,
    from,
    rejectUnauthorized: env("SMTP_TLS_VERIFY").toLowerCase() !== "false",
  };
}

async function storedSmtp(): Promise<StoredSmtp | null> {
  const s = await store.get<Partial<StoredSmtp> | null>(SMTP_KEY, null);
  if (!s || !s.host) return null;
  return {
    host: String(s.host),
    port: Number(s.port) || 587,
    security: s.security === "tls" || s.security === "none" ? s.security : "starttls",
    user: String(s.user ?? ""),
    pass: String(s.pass ?? ""),
    from: String(s.from ?? ""),
    tlsVerify: s.tlsVerify !== false,
  };
}

type ResolvedSmtp = {
  source: "app" | "env" | null;
  config: SmtpConfig | null;
  /** A password is stored but cannot be decrypted (ADMIN_TOKEN changed). */
  passwordUnreadable: boolean;
};

/** The mail server in use: the one saved in the app, else the environment. */
export async function resolveSmtp(): Promise<ResolvedSmtp> {
  const stored = await storedSmtp();
  if (stored) {
    const pass = stored.pass ? decryptSecret(stored.pass) : "";
    return {
      source: "app",
      passwordUnreadable: pass === null,
      config: addressOf(stored.from)
        ? {
            host: stored.host,
            port: stored.port,
            security: stored.security,
            user: stored.user || undefined,
            pass: pass ?? undefined,
            from: stored.from,
            rejectUnauthorized: stored.tlsVerify,
          }
        : null,
    };
  }
  const fromEnv = envSmtp();
  return { source: fromEnv ? "env" : null, config: fromEnv, passwordUnreadable: false };
}

const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[?[0-9A-Fa-f:.]+\]?$/;

export type SmtpInput = {
  host: string;
  port: number;
  security: string;
  user: string;
  /** "" keeps the stored password. */
  password: string;
  clearPassword: boolean;
  from: string;
  tlsVerify: boolean;
};

/** Saves the mail server. An empty host removes it (the environment applies again). */
export async function saveSmtpSettings(input: SmtpInput): Promise<void> {
  if (!store.available()) throw new Error("Notifications need the local database.");
  const host = input.host.trim().replace(/^\[|\]$/g, "");
  if (!host) {
    await store.remove(SMTP_KEY);
    await emitEvent({
      level: "INFO",
      category: "system",
      code: "notify.smtp.changed",
      status: "success",
      trigger: "manual",
      message: "Mail server removed from the app settings",
    });
    return;
  }
  if (!HOST_RE.test(host)) throw new Error("The server name is not a host name or IP address.");
  const port = Math.trunc(Number(input.port));
  if (!(port >= 1 && port <= 65535)) throw new Error("The port must be between 1 and 65535.");
  const security: SmtpSecurity =
    input.security === "tls" || input.security === "none" ? input.security : "starttls";
  const from = input.from.trim();
  if (!addressOf(from)) {
    throw new Error(
      "The sender must be an e-mail address, optionally with a name: Name <address>.",
    );
  }
  if (/[\r\n]/.test(from) || /[\r\n]/.test(input.user))
    throw new Error("Line breaks are not allowed.");
  const previous = await storedSmtp();
  const user = input.user.trim();
  let pass = previous?.pass ?? "";
  if (input.clearPassword || !user) pass = "";
  if (input.password) pass = encryptSecret(input.password);
  if (user && !pass) throw new Error("Enter the password for this user name.");
  const next: StoredSmtp = { host, port, security, user, pass, from, tlsVerify: input.tlsVerify };
  await store.put(SMTP_KEY, next);
  await emitEvent({
    level: "INFO",
    category: "system",
    code: "notify.smtp.changed",
    status: "success",
    trigger: "manual",
    message:
      `Mail server saved: ${host}:${port} (${security}), ${user ? "with login" : "without login"}` +
      (input.password ? ", password updated" : ""),
    details: { host, port, security, login: !!user },
  });
}

function cleanRecipients(list: unknown): string[] {
  const items = Array.isArray(list) ? list : String(list ?? "").split(/[,;\s]+/);
  return [
    ...new Set(
      items
        .map((x) =>
          String(x ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter(isMailAddress),
    ),
  ].slice(0, 20);
}

export async function getNotifySettings(): Promise<NotifySettings> {
  const stored = await store.get<Partial<NotifySettings> | null>(SETTINGS_KEY, null);
  return {
    enabled: stored?.enabled === true,
    // Until someone saves a list in the app, NOTIFY_TO from the environment applies.
    recipients: cleanRecipients(stored?.recipients ?? env("NOTIFY_TO")),
    scope: stored?.scope === "all" ? "all" : "jrc",
  };
}

export async function saveNotifySettings(input: {
  enabled: boolean;
  recipients: unknown;
  scope: string;
}): Promise<NotifySettings> {
  if (!store.available()) throw new Error("Notifications need the local database.");
  const next: NotifySettings = {
    enabled: input.enabled === true,
    recipients: cleanRecipients(input.recipients),
    scope: input.scope === "all" ? "all" : "jrc",
  };
  if (next.enabled && next.recipients.length === 0) {
    throw new Error(
      "Enter at least one valid recipient address before switching notifications on.",
    );
  }
  await store.put(SETTINGS_KEY, next);
  await emitEvent({
    level: "INFO",
    category: "system",
    code: "notify.settings.changed",
    status: "success",
    trigger: "manual",
    message: `Notifications ${next.enabled ? "on" : "off"} — ${next.recipients.length} recipient(s), sources: ${next.scope}`,
  });
  return next;
}

export async function notifyStatus() {
  const { source, config, passwordUnreadable } = await resolveSmtp();
  const stored = await storedSmtp();
  const settings = await getNotifySettings();
  const last = await store.get<NotifyLast | null>(LAST_KEY, null);
  // What the form shows: the saved server, else the values in use, else defaults.
  const shown = stored
    ? {
        host: stored.host,
        port: stored.port,
        security: stored.security,
        user: stored.user,
        from: stored.from,
        tlsVerify: stored.tlsVerify,
      }
    : {
        host: config?.host ?? "",
        port: config?.port ?? 587,
        security: config?.security ?? ("starttls" as SmtpSecurity),
        user: config?.user ?? "",
        from: config?.from ?? "",
        tlsVerify: config?.rejectUnauthorized !== false,
      };
  return {
    available: store.available(),
    smtp: {
      configured: !!config,
      source,
      ...shown,
      // The password itself never leaves the server.
      hasPassword: stored ? !!stored.pass : !!config?.pass,
      passwordUnreadable,
      canStorePassword: !!process.env["ADMIN_TOKEN"],
    },
    settings,
    last,
    baseUrl: baseUrl(),
  };
}

function baseUrl(): string {
  return (env("PUBLIC_BASE_URL").split(",")[0] ?? "").trim().replace(/\/+$/, "");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Finding = {
  kind: string;
  source_type: string;
  source_label: string;
  title: string;
  source_url?: string;
  country?: string;
  generation?: string;
  jrc_manufacturer?: string;
  jrc_card_name?: string;
  jrc_certificate?: string;
  jrc_date?: string;
  jrc_type_approval?: string;
  payload?: Record<string, string> | null;
  changes?: { fields?: { label: string; old: string; new: string }[] } | null;
};

const KIND_LABEL: Record<string, string> = {
  new: "New entry",
  changed: "Change",
  info: "Information",
};

const KIND_COLOUR: Record<string, string> = {
  new: "#047857",
  changed: "#b45309",
  info: "#1d4ed8",
};

/** One line under each source heading: what the source is. */
const SOURCE_NOTE: Record<string, string> = {
  card_status: "Tachograph cards with a JRC interoperability certificate",
  other_certificates: "Vehicle units, motion sensors, printer paper and other components",
  public_key_certificates: "Member State public key certificates",
  key_management: "Key management status per country as published by JRC",
  security_updates: "Mandatory security updates for vehicle units",
  manufacturer_codes: "Manufacturer codes assigned by JRC",
  cc_certificates: "Common Criteria certificates (security certification of chips and cards)",
  ted_procurement: "Public procurement notices (TED)",
  research: "Findings read from approval documents",
};

/** Payload keys in the order they are worth reading; the rest follows. */
const KEY_ORDER = [
  "Device type",
  "Manufacturer",
  "Name",
  "Country",
  "Resolved country",
  "Applicant country",
  "Type approval certificate",
  "Annex",
  "Date of approval",
  "Interoperability certificate",
  "Mandatory security updates",
  "Security certificate",
  "Certificate issued",
  "Chip",
  "Approval document read",
];
/** Internal or repetitive keys the e-mail leaves out. */
const SKIP_KEYS = new Set([
  "What changed",
  "Component",
  "Basis",
  "Chip basis",
  "Country source",
  "Country evidence",
  "Country confidence",
  "Confidence",
  "Approval document",
  "Type approval PDF",
  "Country note",
]);
const MAX_ROWS = 10;

export type DetailRow = { label: string; value: string; change?: { old: string; new: string } };

const clip = (v: string, n = 200) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** The facts the e-mail shows for one finding. */
export function findingDetails(f: Finding): { rows: DetailRow[]; document: string } {
  const rows: DetailRow[] = [];
  const payload = f.payload ?? {};
  const seen = new Set<string>();
  const add = (label: string, value: string | undefined) => {
    const v = String(value ?? "").trim();
    if (!v || seen.has(label) || /^n\.?\/?a\.?$/i.test(v)) return;
    seen.add(label);
    rows.push({ label, value: clip(v) });
  };

  // 1. what changed
  const what = String(payload["What changed"] ?? "").trim();
  if (what) {
    for (const part of what.split("; ")) {
      const m = /^(.+?): (.*) → (.*)$/.exec(part);
      if (m) rows.push({ label: m[1]!, value: "", change: { old: m[2]!, new: m[3]! } });
      else rows.push({ label: "What changed", value: part });
    }
  }
  for (const c of f.changes?.fields ?? []) {
    rows.push({
      label: c.label,
      value: "",
      change: { old: clip(c.old || "—", 120), new: clip(c.new || "—", 120) },
    });
    seen.add(c.label);
  }

  // 2. the facts of the entry
  const keys = [
    ...KEY_ORDER.filter((k) => k in payload),
    ...Object.keys(payload).filter((k) => !KEY_ORDER.includes(k)),
  ];
  for (const k of keys) if (!SKIP_KEYS.has(k)) add(k, payload[k]);
  // Proposals from the card list carry the facts in columns, not in the payload.
  add("Manufacturer", f.jrc_manufacturer);
  add("Name", f.jrc_card_name);
  add("Country", f.country);
  add("Type approval certificate", f.jrc_type_approval);
  add("Generation", seen.has("Annex") ? "" : f.generation);
  add("Date", seen.has("Date of approval") ? "" : f.jrc_date);
  add("Interoperability certificate", f.jrc_certificate);

  const doc = String(payload["Approval document"] ?? payload["Type approval PDF"] ?? "").trim();
  return {
    rows: rows.slice(0, MAX_ROWS + (what ? what.split("; ").length : 0)),
    document: /^https?:\/\//.test(doc) ? doc : "",
  };
}

export function composeRunMail(
  findings: Finding[],
  link: string,
): { subject: string; text: string; html: string } {
  const count = (k: string) => findings.filter((f) => f.kind === k).length;
  const parts = [
    count("new") ? `${count("new")} new` : "",
    count("changed") ? `${count("changed")} changed` : "",
    count("info") ? `${count("info")} information` : "",
  ].filter(Boolean);
  const subject = `Tachograph Data Hub: ${findings.length} finding(s) to review — ${parts.join(", ")}`;
  const intro = `The update run found ${findings.length} entr${findings.length === 1 ? "y that waits" : "ies that wait"} for your decision.`;
  const legend = [
    count("new") ? "New entry: not in the data yet — approving it creates the record." : "",
    count("changed") ? "Change: a value of an existing record differs from the source." : "",
    count("info")
      ? "Information: something changed on a source page that has no field in the data — approving it adds a note to the records of that country."
      : "",
  ].filter(Boolean);

  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.source_label, [...(groups.get(f.source_label) ?? []), f]);

  // ---- plain text
  const text: string[] = [intro, "", ...legend, ""];
  for (const [label, list] of groups) {
    const note = SOURCE_NOTE[list[0]!.source_type];
    text.push(`${label} (${list.length})${note ? ` — ${note}` : ""}`, "");
    for (const f of list) {
      const d = findingDetails(f);
      text.push(`  ${KIND_LABEL[f.kind] ?? f.kind}: ${f.title}`);
      for (const r of d.rows) {
        text.push(
          r.change
            ? `      ${r.label}: ${r.change.old} → ${r.change.new}`
            : `      ${r.label}: ${r.value}`,
        );
      }
      if (d.document) text.push(`      Approval document: ${d.document}`);
      if (f.source_url) text.push(`      Source: ${f.source_url}`);
      text.push("");
    }
  }
  text.push(
    link ? `Review and approve: ${link}` : "Review and approve them in the Update Monitor.",
    "",
    `Nothing was changed in the data. Sent by Tachograph Data Hub V${APP_VERSION}.`,
  );

  // ---- HTML (inline styles only: mail clients ignore style sheets)
  const cell = "padding:2px 14px 2px 0;vertical-align:top";
  const html: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.45;max-width:760px">`,
    `<p style="margin:0 0 8px">${esc(intro)}</p>`,
    legend.length
      ? `<p style="margin:0 0 4px;color:#6b7280;font-size:12px">${legend.map(esc).join("<br>")}</p>`
      : "",
  ];
  for (const [label, list] of groups) {
    const note = SOURCE_NOTE[list[0]!.source_type];
    html.push(
      `<h3 style="margin:22px 0 2px;font-size:15px">${esc(label)} (${list.length})</h3>`,
      note ? `<div style="color:#6b7280;font-size:12px;margin-bottom:8px">${esc(note)}</div>` : "",
    );
    for (const f of list) {
      const d = findingDetails(f);
      const colour = KIND_COLOUR[f.kind] ?? "#374151";
      const rows = d.rows
        .map((r) =>
          r.change
            ? `<tr><td style="${cell};color:#6b7280;white-space:nowrap">${esc(r.label)}</td>` +
              `<td style="padding:2px 0"><span style="color:#9ca3af;text-decoration:line-through">${esc(r.change.old)}</span>` +
              ` &rarr; <strong>${esc(r.change.new)}</strong></td></tr>`
            : `<tr><td style="${cell};color:#6b7280;white-space:nowrap">${esc(r.label)}</td>` +
              `<td style="padding:2px 0">${
                /^https?:\/\/\S+$/.test(r.value)
                  ? `<a href="${esc(r.value)}" style="color:#2563eb;word-break:break-all">${esc(r.value)}</a>`
                  : esc(r.value)
              }</td></tr>`,
        )
        .join("");
      const links = [
        d.document
          ? `<a href="${esc(d.document)}" style="color:#2563eb">Approval document</a>`
          : "",
        f.source_url ? `<a href="${esc(f.source_url)}" style="color:#2563eb">Source page</a>` : "",
      ].filter(Boolean);
      html.push(
        `<div style="border:1px solid #e5e7eb;border-left:4px solid ${colour};border-radius:6px;padding:10px 12px;margin:8px 0">`,
        `<div style="margin-bottom:6px"><span style="display:inline-block;font-size:11px;font-weight:bold;color:#ffffff;background:${colour};border-radius:4px;padding:1px 6px;margin-right:6px">${esc(KIND_LABEL[f.kind] ?? f.kind)}</span>`,
        `<strong>${esc(f.title)}</strong></div>`,
        rows
          ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">${rows}</table>`
          : "",
        links.length
          ? `<div style="margin-top:6px;font-size:12px">${links.join(" &middot; ")}</div>`
          : "",
        `</div>`,
      );
    }
  }
  html.push(
    link
      ? `<p style="margin-top:22px"><a href="${esc(link)}" style="background:#2563eb;color:#ffffff;padding:8px 14px;border-radius:6px;text-decoration:none">Open the Update Monitor</a></p>`
      : `<p style="margin-top:22px">Review and approve them in the Update Monitor.</p>`,
    `<p style="color:#6b7280;font-size:12px;margin-top:20px">Nothing was changed in the data. Sent by Tachograph Data Hub V${APP_VERSION}.</p>`,
    `</div>`,
  );
  return { subject, text: text.join("\n"), html: html.filter(Boolean).join("") };
}

/**
 * Called at the end of a full update run. Sends one mail listing the proposals
 * the run created; silent when notifications are off or nothing was found.
 */
export async function notifyUpdateRun(run: {
  runId: string;
  trigger: string;
  startedAt: Date;
  created: number;
}): Promise<{ sent: boolean; reason?: string; count?: number }> {
  if (run.created <= 0 || !store.available()) return { sent: false, reason: "nothing found" };
  const settings = await getNotifySettings();
  if (!settings.enabled) return { sent: false, reason: "switched off" };
  const smtp = await resolveSmtp();
  const cfg = smtp.config;
  if (!cfg) return { sent: false, reason: "mail server not configured" };
  if (smtp.passwordUnreadable) {
    throw new Error(
      "the stored mail password cannot be read (ADMIN_TOKEN changed) — enter it again under Tools → Notifications",
    );
  }
  if (settings.recipients.length === 0) return { sent: false, reason: "no recipient" };

  // A few seconds of slack: the proposals carry the database clock.
  const since = new Date(run.startedAt.getTime() - 5000).toISOString();
  const rows = await eventsQuery<Finding>(
    `SELECT kind, source_type, source_label, title, source_url, country, generation,
            jrc_manufacturer, jrc_card_name, jrc_certificate, jrc_date, jrc_type_approval,
            payload, changes
       FROM public.jrc_update_proposals
      WHERE created_at >= $1 AND status = 'pending'
      ORDER BY source_label, kind DESC, title
      LIMIT 500`,
    [since],
  );
  const findings =
    settings.scope === "all" ? rows : rows.filter((r) => JRC_SOURCE_TYPES.includes(r.source_type));
  if (findings.length === 0) return { sent: false, reason: "nothing in scope" };

  const mail = composeRunMail(findings, baseUrl());
  try {
    await sendMail(cfg, { to: settings.recipients, ...mail });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await store.put(LAST_KEY, {
      at: new Date().toISOString(),
      ok: false,
      count: findings.length,
      message: message.slice(0, 300),
    } satisfies NotifyLast);
    throw e;
  }
  await store.put(LAST_KEY, {
    at: new Date().toISOString(),
    ok: true,
    count: findings.length,
    message: `${findings.length} finding(s) to ${settings.recipients.length} recipient(s)`,
  } satisfies NotifyLast);
  await emitEvent({
    level: "INFO",
    category: "update",
    code: "notify.mail.sent",
    status: "success",
    trigger: run.trigger === "manual" ? "manual" : (run.trigger as "scheduler" | "cron"),
    runId: run.runId,
    message: `Notification e-mail sent: ${findings.length} finding(s) to ${settings.recipients.length} recipient(s)`,
  });
  return { sent: true, count: findings.length };
}

/** Sends a test message to the saved recipients (or the one given). */
export async function sendTestMail(to?: string): Promise<{ recipients: string[] }> {
  const smtp = await resolveSmtp();
  const cfg = smtp.config;
  if (!cfg) throw new Error("No mail server is set up yet — enter it above and save.");
  if (smtp.passwordUnreadable) {
    throw new Error(
      "The stored password cannot be read (ADMIN_TOKEN changed) — enter it again and save.",
    );
  }
  const recipients = to ? cleanRecipients([to]) : (await getNotifySettings()).recipients;
  if (recipients.length === 0) throw new Error("No valid recipient address.");
  const mail = composeRunMail(
    [
      {
        kind: "new",
        source_type: "other_certificates",
        source_label: "Other certificates",
        source_url: "https://dtc.jrc.ec.europa.eu/dtc_other_certificates.php.html",
        title: "Test — VU · Example Vehicle Unit — Example Manufacturer (G2.2)",
        payload: {
          "Device type": "Vehicle Unit",
          Manufacturer: "Example Manufacturer",
          Name: "Example Vehicle Unit",
          "Type approval certificate": "e0-0000-00",
          Annex: "G2.2 (Annex 1C v2)",
          "Date of approval": "01/01/2026",
          "Interoperability certificate": "JRC_DTLab/A2-000/2026",
        },
      },
      {
        kind: "info",
        source_type: "key_management",
        source_label: "Key management status",
        source_url: "https://dtc.jrc.ec.europa.eu/dtc_key_management_status_dt.php.html",
        title: "Test — Example country · key management status updated",
        payload: {
          "What changed": "KmWC: 12/03/2024 → 20/04/2026",
          Country: "Example country",
          "Policy approved": "17/05/2022",
        },
      },
    ],
    baseUrl(),
  );
  await sendMail(cfg, { to: recipients, ...mail, subject: `[Test] ${mail.subject}` });
  await store.put(LAST_KEY, {
    at: new Date().toISOString(),
    ok: true,
    count: 0,
    message: `Test message to ${recipients.join(", ")}`,
  } satisfies NotifyLast);
  return { recipients };
}
