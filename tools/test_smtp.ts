// v2.77: the SMTP client against a small server in this process.
// Run: npx tsx tools/test_smtp.ts   (the STARTTLS part needs openssl)
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressOf, buildMessage, isMailAddress, sendMail } from "../src/lib/smtp.server";
import { composeRunMail, decryptSecret, encryptSecret } from "../src/lib/notify.server";
import { scryptSync } from "node:crypto";

type Seen = { auth: string; from: string; rcpt: string[]; data: string; tls: boolean };

function server(opts: { starttls?: tls.SecureContext; rejectRcpt?: string; loginOnly?: boolean }) {
  const seen: Seen = { auth: "", from: "", rcpt: [], data: "", tls: false };
  const srv = net.createServer((raw) => {
    let sock: net.Socket = raw;
    let buf = "";
    let inData = false;
    let loginStep = 0;
    let secured = false;
    const say = (s: string) => sock.write(`${s}\r\n`);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        seen.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        say("250 queued");
      }
      let i: number;
      while (!inData && (i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const up = line.toUpperCase();
        if (loginStep === 1) {
          loginStep = 2;
          say("334 UGFzc3dvcmQ6");
        } else if (loginStep === 2) {
          loginStep = 0;
          seen.auth = "LOGIN";
          say("235 ok");
        } else if (up.startsWith("EHLO")) {
          sock.write("250-test\r\n");
          if (opts.starttls && !secured) sock.write("250-STARTTLS\r\n");
          say(opts.loginOnly ? "250 AUTH LOGIN" : "250 AUTH PLAIN LOGIN");
        } else if (up === "STARTTLS") {
          say("220 go ahead");
          raw.off("data", onData);
          const secure = new tls.TLSSocket(raw, { isServer: true, secureContext: opts.starttls });
          seen.tls = true;
          secured = true;
          sock = secure;
          secure.on("error", () => undefined);
          secure.on("data", onData);
        } else if (up.startsWith("AUTH PLAIN")) {
          seen.auth = Buffer.from(line.slice(11), "base64").toString("utf8");
          say("235 ok");
        } else if (up === "AUTH LOGIN") {
          loginStep = 1;
          say("334 VXNlcm5hbWU6");
        } else if (up.startsWith("MAIL FROM:")) {
          seen.from = line.slice(10);
          say("250 ok");
        } else if (up.startsWith("RCPT TO:")) {
          const r = line.slice(8);
          if (opts.rejectRcpt && r.includes(opts.rejectRcpt)) say("550 no such user");
          else {
            seen.rcpt.push(r);
            say("250 ok");
          }
        } else if (up === "DATA") {
          inData = true;
          say("354 go");
        } else if (up === "QUIT") {
          say("221 bye");
          sock.end();
        } else say("500 what");
      }
    };
    raw.on("data", onData);
    raw.on("error", () => undefined);
    say("220 test ESMTP");
  });
  return new Promise<{ port: number; seen: Seen; close: () => void }>((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({ port: (srv.address() as net.AddressInfo).port, seen, close: () => srv.close() }),
    ),
  );
}

// ---- addresses and message
assert.ok(isMailAddress("a.b@example.org"));
assert.ok(!isMailAddress("a@b"));
assert.ok(!isMailAddress("a@example.org\r\nBcc: x@y.z"), "no header injection through an address");
assert.equal(addressOf("Tachograph Data Hub <tdh@example.org>"), "tdh@example.org");
assert.equal(addressOf("nope"), "");
const raw = buildMessage(
  { host: "h", port: 25, security: "none", from: "TDH Prüfung <tdh@example.org>" },
  { to: ["a@example.org"], subject: "Änderung\r\nBcc: evil@example.org", text: "hello" },
);
assert.match(raw, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <tdh@example\.org>\r\n/);
assert.ok(!/\r\nBcc:/i.test(raw), "a line break in the subject must not create a header");

// ---- plain, with AUTH PLAIN and a line starting with a dot
{
  const s = await server({});
  await sendMail(
    {
      host: "127.0.0.1",
      port: s.port,
      security: "none",
      user: "u",
      pass: "p",
      from: "TDH <tdh@example.org>",
    },
    { to: ["a@example.org", "not-an-address", "b@example.org"], subject: "Test", text: "x" },
  );
  assert.equal(s.seen.auth, "\u0000u\u0000p");
  assert.equal(s.seen.from, "<tdh@example.org>");
  assert.deepEqual(s.seen.rcpt, ["<a@example.org>", "<b@example.org>"]);
  assert.match(s.seen.data, /Subject: Test/);
  assert.match(s.seen.data, /Content-Transfer-Encoding: base64\r\n\r\neA==/);
  s.close();
}
// ---- AUTH LOGIN when PLAIN is not offered
{
  const s = await server({ loginOnly: true });
  await sendMail(
    {
      host: "127.0.0.1",
      port: s.port,
      security: "none",
      user: "u",
      pass: "p",
      from: "tdh@example.org",
    },
    { to: ["a@example.org"], subject: "Test", text: "x" },
  );
  assert.equal(s.seen.auth, "LOGIN");
  s.close();
}
// ---- a refused recipient is an error that names it
{
  const s = await server({ rejectRcpt: "gone@" });
  await assert.rejects(
    sendMail(
      { host: "127.0.0.1", port: s.port, security: "none", from: "tdh@example.org" },
      { to: ["gone@example.org"], subject: "Test", text: "x" },
    ),
    /recipient gone@example\.org refused: 550/,
  );
  s.close();
}
// ---- STARTTLS required but not offered
{
  const s = await server({});
  await assert.rejects(
    sendMail(
      { host: "127.0.0.1", port: s.port, security: "starttls", from: "tdh@example.org" },
      { to: ["a@example.org"], subject: "Test", text: "x" },
    ),
    /does not offer STARTTLS/,
  );
  s.close();
}
// ---- nobody listening
await assert.rejects(
  sendMail(
    { host: "127.0.0.1", port: 1, security: "none", from: "tdh@example.org" },
    { to: ["a@example.org"], subject: "Test", text: "x" },
  ),
  /cannot reach 127\.0\.0\.1:1/,
);
// ---- STARTTLS with a self-signed certificate
try {
  const dir = mkdtempSync(join(tmpdir(), "tdh-smtp-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-keyout",
      join(dir, "k.pem"),
      "-out",
      join(dir, "c.pem"),
    ],
    { stdio: "ignore" },
  );
  const ctx = tls.createSecureContext({
    key: readFileSync(join(dir, "k.pem")),
    cert: readFileSync(join(dir, "c.pem")),
  });
  const s = await server({ starttls: ctx });
  const cfg = {
    host: "127.0.0.1",
    port: s.port,
    security: "starttls" as const,
    user: "u",
    pass: "p",
    from: "tdh@example.org",
  };
  await assert.rejects(
    sendMail(cfg, { to: ["a@example.org"], subject: "T", text: "x" }),
    /TLS handshake failed/,
  );
  await sendMail(
    { ...cfg, rejectUnauthorized: false },
    { to: ["a@example.org"], subject: "T", text: "x" },
  );
  assert.ok(s.seen.tls);
  assert.equal(s.seen.auth, "\u0000u\u0000p", "the login is sent after the upgrade");
  assert.deepEqual(s.seen.rcpt, ["<a@example.org>"]);
  s.close();
  console.log("smtp: starttls ok");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "ENOENT")
    console.log("smtp: starttls skipped (no openssl)");
  else throw e;
}

// ---- the stored password (v2.79)
{
  const key = scryptSync("admin-token-A", "tdh-notify-smtp-v1", 32);
  const other = scryptSync("admin-token-B", "tdh-notify-smtp-v1", 32);
  const stored = encryptSecret("p@ss wörd", key);
  assert.ok(stored.startsWith("v1:") && !stored.includes("p@ss"), "not stored in clear");
  assert.notEqual(stored, encryptSecret("p@ss wörd", key), "a fresh IV every time");
  assert.equal(decryptSecret(stored, key), "p@ss wörd");
  assert.equal(decryptSecret(stored, other), null, "another ADMIN_TOKEN cannot read it");
  assert.equal(
    decryptSecret(stored.slice(0, -4) + "AAAA", key),
    null,
    "a damaged value is rejected",
  );
  assert.equal(decryptSecret("plain-text", key), null);
  assert.equal(decryptSecret(stored, null), null);
  assert.throws(() => encryptSecret("x", null), /ADMIN_TOKEN/);
}

// ---- the run mail
const mail = composeRunMail(
  [
    {
      kind: "new",
      source_type: "card_status",
      source_label: "Card status",
      title: "New entry · Kazakhstan · e26-23-1",
    },
    {
      kind: "changed",
      source_type: "card_status",
      source_label: "Card status",
      title: "Spain · e9-0006-00 <b>",
    },
    {
      kind: "info",
      source_type: "key_management",
      source_label: "Key management status",
      title: "Malta · updated",
    },
  ],
  "https://tdh.example.org",
);
assert.equal(
  mail.subject,
  "Tachograph Data Hub: 3 finding(s) to review — 1 new, 1 changed, 1 information",
);
assert.match(mail.text, /Card status \(2\)\n {2}- New entry: New entry · Kazakhstan · e26-23-1/);
assert.match(mail.text, /Review and approve: https:\/\/tdh\.example\.org/);
assert.ok(
  mail.html.includes("&lt;b&gt;") && !mail.html.includes("<b>"),
  "titles are escaped in the HTML part",
);

console.log("smtp: ok");
process.exit(0);
