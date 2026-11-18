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

type Finding = {
  kind: string;
  source_type: string;
  source_label: string;
  title: string;
};

const KIND_LABEL: Record<string, string> = {
  new: "New entry",
  changed: "Change",
  info: "Information",
};

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

  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.source_label, [...(groups.get(f.source_label) ?? []), f]);

  const text = [
    `The update run found ${findings.length} entr${findings.length === 1 ? "y" : "ies"} that wait for your decision.`,
    "",
    ...[...groups].flatMap(([label, list]) => [
      `${label} (${list.length})`,
      ...list.map((f) => `  - ${KIND_LABEL[f.kind] ?? f.kind}: ${f.title}`),
      "",
    ]),
    link ? `Review and approve: ${link}` : "Review and approve them in the Update Monitor.",
    "",
    `Nothing was changed in the data. Sent by Tachograph Data Hub V${APP_VERSION}.`,
  ].join("\n");

  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">`,
    `<p>The update run found <strong>${findings.length}</strong> entr${findings.length === 1 ? "y" : "ies"} that wait for your decision.</p>`,
    ...[...groups].map(
      ([label, list]) =>
        `<p style="margin:16px 0 4px;font-weight:bold">${esc(label)} (${list.length})</p>` +
        `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
        list
          .map(
            (f) =>
              `<tr><td style="padding:3px 12px 3px 0;white-space:nowrap;color:#6b7280;vertical-align:top">${esc(KIND_LABEL[f.kind] ?? f.kind)}</td>` +
              `<td style="padding:3px 0">${esc(f.title)}</td></tr>`,
          )
          .join("") +
        `</table>`,
    ),
    link
      ? `<p style="margin-top:20px"><a href="${esc(link)}" style="background:#2563eb;color:#ffffff;padding:8px 14px;border-radius:6px;text-decoration:none">Open the Update Monitor</a></p>`
      : `<p style="margin-top:20px">Review and approve them in the Update Monitor.</p>`,
    `<p style="color:#6b7280;font-size:12px;margin-top:20px">Nothing was changed in the data. Sent by Tachograph Data Hub V${APP_VERSION}.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
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
    `SELECT kind, source_type, source_label, title
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
        source_type: "card_status",
        source_label: "Card status",
        title: "Test — this is what a new JRC entry looks like (e0-0000-00)",
      },
      {
        kind: "changed",
        source_type: "other_certificates",
        source_label: "Other certificates",
        title: "Test — this is what a changed JRC entry looks like",
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
