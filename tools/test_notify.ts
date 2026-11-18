// v2.79: the mail server settings (Tools → Notifications) against an in-memory store.
// Run: npx tsx tools/test_notify.ts
import assert from "node:assert/strict";

process.env["ADMIN_TOKEN"] = "test-admin-token";
for (const k of [
  "SMTP_HOST",
  "SMTP_FROM",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_SECURITY",
  "NOTIFY_TO",
])
  delete process.env[k];

const {
  notifyStatus,
  resolveSmtp,
  saveNotifySettings,
  saveSmtpSettings,
  setSettingsStoreForTests,
} = await import("../src/lib/notify.server");

const db = new Map<string, unknown>();
setSettingsStoreForTests({
  available: () => true,
  get: async <T>(key: string, fallback: T) =>
    db.has(key) ? (structuredClone(db.get(key)) as T) : fallback,
  put: async (key, value) => void db.set(key, JSON.parse(JSON.stringify(value))),
  remove: async (key) => void db.delete(key),
});

const input = {
  host: "mail.example.org",
  port: 587,
  security: "starttls",
  user: "tdh@example.org",
  password: "s3cret-Pässwort",
  clearPassword: false,
  from: "Tachograph Data Hub <tdh@example.org>",
  tlsVerify: true,
};

// ---- nothing set up
assert.deepEqual(await resolveSmtp(), { source: null, config: null, passwordUnreadable: false });
assert.equal((await notifyStatus()).smtp.configured, false);

// ---- validation
await assert.rejects(saveSmtpSettings({ ...input, host: "mail example.org" }), /host name/);
await assert.rejects(saveSmtpSettings({ ...input, host: "evil.org/path?x=1" }), /host name/);
await assert.rejects(saveSmtpSettings({ ...input, port: 0 }), /port/i);
await assert.rejects(saveSmtpSettings({ ...input, port: 70000 }), /port/i);
await assert.rejects(saveSmtpSettings({ ...input, from: "not an address" }), /sender/i);
await assert.rejects(
  saveSmtpSettings({ ...input, from: "a@b.org\r\nBcc: x@y.org" }),
  /sender|line break/i,
);
await assert.rejects(
  saveSmtpSettings({ ...input, password: "" }),
  /password/i,
  "a user name needs a password",
);
assert.equal(db.size, 0, "a refused input stores nothing");

// ---- save: the password is stored encrypted and never reported
await saveSmtpSettings(input);
const raw = JSON.stringify(db.get("notify_smtp"));
assert.ok(!raw.includes("s3cret"), "the password is not stored in clear");
let r = await resolveSmtp();
assert.equal(r.source, "app");
assert.equal(r.config!.pass, "s3cret-Pässwort");
assert.equal(r.config!.user, "tdh@example.org");
assert.equal(r.config!.port, 587);
assert.equal(r.config!.security, "starttls");
let st = await notifyStatus();
assert.ok(
  !JSON.stringify(st).includes("s3cret"),
  "the status sent to the browser carries no password",
);
assert.equal(st.smtp.hasPassword, true);
assert.equal(st.smtp.configured, true);
assert.equal(st.smtp.host, "mail.example.org");

// ---- change something else: an empty password field keeps the stored one
await saveSmtpSettings({ ...input, port: 465, security: "tls", password: "" });
r = await resolveSmtp();
assert.equal(r.config!.port, 465);
assert.equal(r.config!.security, "tls");
assert.equal(r.config!.pass, "s3cret-Pässwort");

// ---- a new password replaces it
await saveSmtpSettings({ ...input, password: "new-one" });
assert.equal((await resolveSmtp()).config!.pass, "new-one");

// ---- relay without login: user and password go
await saveSmtpSettings({
  ...input,
  host: "192.168.1.10",
  port: 25,
  security: "none",
  user: "",
  password: "",
});
r = await resolveSmtp();
assert.equal(r.config!.user, undefined);
assert.equal(r.config!.pass, "");
assert.equal((await notifyStatus()).smtp.hasPassword, false);

// ---- ADMIN_TOKEN changed: the password cannot be read, and that is reported
await saveSmtpSettings(input);
process.env["ADMIN_TOKEN"] = "another-token";
r = await resolveSmtp();
assert.equal(r.passwordUnreadable, true);
assert.equal(r.config!.pass, undefined);
st = await notifyStatus();
assert.equal(st.smtp.passwordUnreadable, true);
process.env["ADMIN_TOKEN"] = "test-admin-token";
assert.equal((await resolveSmtp()).config!.pass, "s3cret-Pässwort");

// ---- the environment is the fallback, the app wins
process.env["SMTP_HOST"] = "env.example.org";
process.env["SMTP_FROM"] = "env@example.org";
assert.equal(
  (await resolveSmtp()).config!.host,
  "mail.example.org",
  "a server saved in the app wins",
);
await saveSmtpSettings({ ...input, host: "" }); // remove
assert.equal(db.has("notify_smtp"), false);
r = await resolveSmtp();
assert.equal(r.source, "env");
assert.equal(r.config!.host, "env.example.org");
delete process.env["SMTP_HOST"];
delete process.env["SMTP_FROM"];

// ---- recipients
await assert.rejects(
  saveNotifySettings({ enabled: true, recipients: "nobody", scope: "jrc" }),
  /recipient/i,
);
const saved = await saveNotifySettings({
  enabled: true,
  recipients: "A@Example.org; b@example.org, a@example.org x",
  scope: "all",
});
assert.deepEqual(saved, {
  enabled: true,
  recipients: ["a@example.org", "b@example.org"],
  scope: "all",
});

console.log("notify: ok");
process.exit(0);
