// v2.77: a small SMTP client on node:net / node:tls.
//
// The runtime image installs only `pg` next to the server bundle (see
// docker/runtime/package.json), so a mail library would be one more thing to
// keep in step there. Sending a notification needs very little of SMTP: greet,
// optionally STARTTLS, optionally AUTH, one message. That is what this does —
// nothing more (no attachments, no pooling, no retries).

import net from "node:net";
import tls from "node:tls";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type SmtpSecurity = "tls" | "starttls" | "none";

export type SmtpConfig = {
  host: string;
  port: number;
  /** tls = implicit TLS (465), starttls = upgrade after EHLO (587), none = plain (25, internal relay). */
  security: SmtpSecurity;
  user?: string;
  pass?: string;
  /** Sender address, optionally with a display name: `TDH <tdh@example.org>`. */
  from: string;
  /** false accepts a self-signed certificate of an internal mail server. */
  rejectUnauthorized?: boolean;
};

export type MailMessage = { to: string[]; subject: string; text: string; html?: string };

const TIMEOUT_MS = 20_000;
const ADDRESS_RE = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+\.[^\s<>@,;:"]+$/;

export function isMailAddress(value: string): boolean {
  return ADDRESS_RE.test(value) && value.length <= 254;
}

/** `Name <a@b.c>` or `a@b.c` -> the bare address ("" when it is not one). */
export function addressOf(value: string): string {
  const m = /<([^<>]+)>\s*$/.exec(value.trim());
  const addr = (m ? m[1]! : value).trim();
  return isMailAddress(addr) ? addr : "";
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** RFC 2047 for header text that is not plain ASCII. */
function headerText(s: string): string {
  const clean = s.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean)}?=`;
}

function wrap76(s: string): string {
  return s.replace(/(.{76})/g, "$1\r\n");
}

export function buildMessage(cfg: SmtpConfig, msg: MailMessage): string {
  const fromAddr = addressOf(cfg.from);
  const fromName = cfg.from.includes("<") ? cfg.from.slice(0, cfg.from.indexOf("<")).trim() : "";
  const domain = fromAddr.split("@")[1] ?? "localhost";
  const boundary = `tdh-${randomUUID()}`;
  const head = [
    `From: ${fromName ? `${headerText(fromName.replace(/^"|"$/g, ""))} <${fromAddr}>` : fromAddr}`,
    `To: ${msg.to.join(", ")}`,
    `Subject: ${headerText(msg.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
  ];
  const part = (type: string, body: string) =>
    [
      `Content-Type: ${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(b64(body)),
    ].join("\r\n");
  if (!msg.html) return [...head, part("text/plain", msg.text)].join("\r\n");
  return [
    ...head,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    part("text/plain", msg.text),
    `--${boundary}`,
    part("text/html", msg.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

type Reply = { code: number; lines: string[] };

/** Reads SMTP replies ("250-…" continues, "250 …" ends) off a socket. */
function replyReader(initial: net.Socket) {
  let socket = initial;
  let buffer = "";
  let waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  let failure: Error | null = null;
  const lines: string[] = [];

  const flush = () => {
    if (!waiting) return;
    if (failure) {
      const w = waiting;
      waiting = null;
      w.reject(failure);
      return;
    }
    const end = lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
    if (end < 0) return;
    const block = lines.splice(0, end + 1);
    const w = waiting;
    waiting = null;
    w.resolve({ code: Number(block[block.length - 1]!.slice(0, 3)), lines: block });
  };
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      lines.push(buffer.slice(0, i).replace(/\r$/, ""));
      buffer = buffer.slice(i + 1);
    }
    flush();
  };
  const fail = (e: Error) => {
    failure = failure ?? e;
    flush();
  };
  const onTimeout = () => fail(new Error("mail server did not answer in time"));
  const onClose = () => fail(new Error("mail server closed the connection"));
  const attach = (s: net.Socket) => {
    socket = s;
    failure = null;
    buffer = "";
    lines.length = 0;
    s.on("data", onData);
    s.on("error", fail);
    s.on("timeout", onTimeout);
    s.on("close", onClose);
    s.setTimeout(TIMEOUT_MS);
  };
  /** Stops reading the current socket — only our own listeners are removed. */
  const detach = () => {
    socket.off("data", onData);
    socket.off("error", fail);
    socket.off("timeout", onTimeout);
    socket.off("close", onClose);
  };
  attach(initial);

  return {
    next: () =>
      new Promise<Reply>((resolve, reject) => {
        waiting = { resolve, reject };
        flush();
      }),
    write: (data: string) => socket.write(data),
    /** The socket currently in use (the STARTTLS upgrade wraps it). */
    socket: () => socket,
    detach,
    attach,
    end: () => socket.destroy(),
  };
}

function connect(cfg: SmtpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) =>
      reject(new Error(`cannot reach ${cfg.host}:${cfg.port} — ${e.message}`));
    const socket: net.Socket =
      cfg.security === "tls"
        ? tls.connect(
            {
              host: cfg.host,
              port: cfg.port,
              servername: net.isIP(cfg.host) ? undefined : cfg.host,
              rejectUnauthorized: cfg.rejectUnauthorized !== false,
            },
            () => {
              socket.off("error", onError);
              resolve(socket);
            },
          )
        : net.connect({ host: cfg.host, port: cfg.port }, () => {
            socket.off("error", onError);
            resolve(socket);
          });
    socket.once("error", onError);
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`cannot reach ${cfg.host}:${cfg.port} — timed out`));
    });
  });
}

/** Sends one message. Throws with the server's answer when a step is refused. */
export async function sendMail(cfg: SmtpConfig, msg: MailMessage): Promise<void> {
  const from = addressOf(cfg.from);
  if (!from) throw new Error("SMTP_FROM is not a valid sender address");
  const to = msg.to.filter(isMailAddress);
  if (to.length === 0) throw new Error("no valid recipient address");

  const io = replyReader(await connect(cfg));
  const expect = async (codes: number[], what: string): Promise<Reply> => {
    const r = await io.next();
    if (!codes.includes(r.code)) {
      throw new Error(`${what} refused: ${r.lines.join(" ").slice(0, 300)}`);
    }
    return r;
  };
  const cmd = async (line: string, codes: number[], what: string) => {
    io.write(`${line}\r\n`);
    return expect(codes, what);
  };

  try {
    await expect([220], "connection");
    const name = os.hostname().replace(/[^a-zA-Z0-9.-]/g, "") || "localhost";
    let ehlo = await cmd(`EHLO ${name}`, [250], "EHLO");

    if (cfg.security === "starttls") {
      if (!ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        throw new Error("the mail server does not offer STARTTLS (use SMTP_SECURITY=tls or none)");
      }
      await cmd("STARTTLS", [220], "STARTTLS");
      // Hand the plain socket over to TLS: our reader must let go of it first,
      // otherwise it would read the handshake as reply lines.
      const raw = io.socket();
      io.detach();
      const secured = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const s = tls.connect(
          {
            socket: raw,
            servername: net.isIP(cfg.host) ? undefined : cfg.host,
            rejectUnauthorized: cfg.rejectUnauthorized !== false,
          },
          () => resolve(s),
        );
        s.once("error", (e) => reject(new Error(`TLS handshake failed — ${e.message}`)));
      });
      io.attach(secured);
      ehlo = await cmd(`EHLO ${name}`, [250], "EHLO");
    }

    if (cfg.user) {
      const caps = ehlo.lines.join(" ").toUpperCase();
      if (/AUTH[ =][^\r\n]*PLAIN/.test(caps) || !/AUTH[ =][^\r\n]*LOGIN/.test(caps)) {
        await cmd(`AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass ?? ""}`)}`, [235], "login");
      } else {
        await cmd("AUTH LOGIN", [334], "login");
        await cmd(b64(cfg.user), [334], "login");
        await cmd(b64(cfg.pass ?? ""), [235], "login");
      }
    }

    await cmd(`MAIL FROM:<${from}>`, [250], "sender");
    for (const rcpt of to) await cmd(`RCPT TO:<${rcpt}>`, [250, 251], `recipient ${rcpt}`);
    await cmd("DATA", [354], "DATA");
    // Dot-stuffing: a line that starts with "." would end the message early.
    const body = buildMessage(cfg, { ...msg, to })
      .replace(/\r?\n/g, "\r\n")
      .replace(/^\./gm, "..");
    io.write(`${body}\r\n.\r\n`);
    await expect([250], "message");
    io.write("QUIT\r\n");
  } finally {
    io.end();
  }
}
