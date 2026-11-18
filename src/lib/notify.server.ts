// v2.77: e-mail when an update run finds something (Tools → Notifications).
//
// The mail server and its credentials live in the container environment
// (SMTP_* in /opt/TDH/.env) — never in the database or the browser. What can
// be changed in the app is who gets the mail, for which sources, and on/off
// (app_settings "notify_email").

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

const env = (k: string) => (process.env[k] ?? "").trim();

export function smtpConfig(): SmtpConfig | null {
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
  const stored = await getSetting<Partial<NotifySettings> | null>(SETTINGS_KEY, null);
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
  if (!settingsAvailable()) throw new Error("Notifications need the local database.");
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
  await putSetting(SETTINGS_KEY, next);
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
  const cfg = smtpConfig();
  const settings = await getNotifySettings();
  const last = await getSetting<NotifyLast | null>(LAST_KEY, null);
  return {
    available: settingsAvailable(),
    smtp: cfg
      ? {
          configured: true as const,
          host: cfg.host,
          port: cfg.port,
          security: cfg.security,
          from: cfg.from,
          auth: !!cfg.user,
        }
      : {
          configured: false as const,
          missing: [
            env("SMTP_HOST") ? "" : "SMTP_HOST",
            addressOf(env("SMTP_FROM")) ? "" : "SMTP_FROM",
          ].filter(Boolean),
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
  if (run.created <= 0 || !settingsAvailable()) return { sent: false, reason: "nothing found" };
  const settings = await getNotifySettings();
  if (!settings.enabled) return { sent: false, reason: "switched off" };
  const cfg = smtpConfig();
  if (!cfg) return { sent: false, reason: "SMTP not configured" };
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
    await putSetting(LAST_KEY, {
      at: new Date().toISOString(),
      ok: false,
      count: findings.length,
      message: message.slice(0, 300),
    } satisfies NotifyLast);
    throw e;
  }
  await putSetting(LAST_KEY, {
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
  const cfg = smtpConfig();
  if (!cfg)
    throw new Error(
      "SMTP is not configured: set SMTP_HOST and SMTP_FROM in the container environment.",
    );
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
  await putSetting(LAST_KEY, {
    at: new Date().toISOString(),
    ok: true,
    count: 0,
    message: `Test message to ${recipients.join(", ")}`,
  } satisfies NotifyLast);
  return { recipients };
}
