import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, Loader2, Mail, Send, Server, XCircle } from "lucide-react";
import {
  getNotifyStatus,
  saveNotifySettingsFn,
  saveSmtpSettingsFn,
  sendNotifyTest,
} from "@/lib/notify.functions";

// v2.77: Tools → Notifications. Who gets an e-mail when an update run finds a
// new or changed entry. v2.79: the mail server is set up here as well — the
// password is write-only (stored encrypted, never sent back to the browser).

type NotifyStatus = Awaited<ReturnType<typeof getNotifyStatus>>;
type Security = "starttls" | "tls" | "none";

const DEFAULT_PORT: Record<Security, number> = { starttls: 587, tls: 465, none: 25 };

export function NotificationsView() {
  const fetchStatus = useServerFn(getNotifyStatus);
  const q = useQuery({ queryKey: ["notify_status"], queryFn: () => fetchStatus(), retry: false });

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }
  if (q.error || !q.data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Notification settings are only available with a valid admin login.
        </CardContent>
      </Card>
    );
  }
  const s = q.data;
  const serverKey = JSON.stringify([
    s.smtp.source,
    s.smtp.host,
    s.smtp.port,
    s.smtp.security,
    s.smtp.user,
    s.smtp.from,
    s.smtp.tlsVerify,
    s.smtp.hasPassword,
  ]);
  // Keyed by what is saved: a background refresh must not wipe what is being typed.
  return (
    <div className="space-y-4">
      <ServerForm key={serverKey} status={s} />
      <NotifyForm key={JSON.stringify(s.settings)} status={s} />
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ServerForm({ status }: { status: NotifyStatus }) {
  const qc = useQueryClient();
  const save = useServerFn(saveSmtpSettingsFn);
  const { smtp } = status;
  const [host, setHost] = useState(smtp.host);
  const [port, setPort] = useState(String(smtp.port));
  const [security, setSecurity] = useState<Security>(smtp.security);
  const [user, setUser] = useState(smtp.user);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(smtp.from);
  const [tlsVerify, setTlsVerify] = useState(smtp.tlsVerify);
  const [busy, setBusy] = useState(false);

  const onSecurity = (next: Security) => {
    // Follow the usual port unless a different one was typed in.
    if (port === "" || Number(port) === DEFAULT_PORT[security]) setPort(String(DEFAULT_PORT[next]));
    setSecurity(next);
  };

  const submit = async (remove = false) => {
    if (remove && !window.confirm("Remove the mail server saved in the app?")) return;
    setBusy(true);
    try {
      await save({
        data: remove
          ? { host: "", port: 0, security: "starttls", user: "", from: "", tlsVerify: true }
          : { host, port: Number(port), security, user, password, from, tlsVerify },
      });
      toast.success(remove ? "Mail server removed" : "Mail server saved");
      await qc.invalidateQueries({ queryKey: ["notify_status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The mail server could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const storedPassword = smtp.hasPassword && smtp.source === "app";
  const passwordHint = smtp.passwordUnreadable
    ? "The stored password can no longer be read (ADMIN_TOKEN changed) — enter it again."
    : storedPassword
      ? "A password is stored. Leave empty to keep it."
      : !smtp.canStorePassword
        ? "A password can only be stored when ADMIN_TOKEN is set."
        : "Stored encrypted; it is never shown again.";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Server className="h-4 w-4 text-primary" /> Mail server
          <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            {smtp.passwordUnreadable ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> password must be entered
                again
              </>
            ) : smtp.configured ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                {smtp.source === "env" ? "set up in the container environment" : "set up"}
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-red-600" /> not set up yet
              </>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {smtp.source === "env" && (
          <p className="text-xs text-muted-foreground">
            These values come from the container environment (SMTP_*). Saving here stores the server
            in the app instead; the password has to be entered once.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <Field label="Server">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="mail.example.org"
            />
          </Field>
          <Field label="Port">
            <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Encryption">
            <select
              className="h-9 w-full rounded-md border bg-background px-2"
              value={security}
              onChange={(e) => onSecurity(e.target.value as Security)}
            >
              <option value="starttls">STARTTLS (usually port 587)</option>
              <option value="tls">TLS (usually port 465)</option>
              <option value="none">None (internal relay, port 25)</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="User name" hint="Leave empty for a relay without login.">
            <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Password" hint={passwordHint}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={storedPassword ? "••••••••" : ""}
            />
          </Field>
        </div>
        <Field
          label="Sender"
          hint="An address, or a name with an address: Tachograph Data Hub <tdh@example.org>"
        >
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="tdh@example.org"
          />
        </Field>
        <label className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={tlsVerify}
            onChange={(e) => setTlsVerify(e.target.checked)}
          />
          Check the server certificate
          <span className="text-xs text-muted-foreground">
            (switch off only for an internal server with a self-signed certificate)
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => submit()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save mail server
          </Button>
          {smtp.source === "app" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => submit(true)}>
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NotifyForm({ status }: { status: NotifyStatus }) {
  const qc = useQueryClient();
  const save = useServerFn(saveNotifySettingsFn);
  const test = useServerFn(sendNotifyTest);
  const [enabled, setEnabled] = useState(status.settings.enabled);
  const [recipients, setRecipients] = useState(status.settings.recipients.join(", "));
  const [scope, setScope] = useState<"jrc" | "all">(status.settings.scope);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const run = async (key: "save" | "test", fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.success(await fn());
      await qc.invalidateQueries({ queryKey: ["notify_status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const { smtp, last } = status;
  const canTest = smtp.configured && !smtp.passwordUnreadable;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" /> E-mail notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          After every full update run (the daily automatic run and “Check for updates”) one e-mail
          lists the new and changed entries that wait in the Update Monitor. No mail is sent when a
          run finds nothing.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Send an e-mail when an update run finds something
        </label>
        <Field label="Recipients (separate several addresses with a comma)">
          <Input
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="name@example.org, team@example.org"
          />
        </Field>
        <Field label="Sources">
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={scope}
            onChange={(e) => setScope(e.target.value === "all" ? "all" : "jrc")}
          >
            <option value="jrc">JRC pages only (card status, other certificates, keys, …)</option>
            <option value="all">All sources (also Common Criteria, TED, research findings)</option>
          </select>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run("save", async () => {
                const s = await save({ data: { enabled, recipients, scope } });
                return s.enabled
                  ? `Notifications on — ${s.recipients.length} recipient(s)`
                  : "Notifications off";
              })
            }
          >
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !canTest}
            title={canTest ? "Sends to the saved recipients" : "Set up the mail server first"}
            onClick={() =>
              run("test", async () => {
                const r = await test({ data: {} });
                return `Test e-mail sent to ${r.recipients.join(", ")}`;
              })
            }
          >
            {busy === "test" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send test e-mail
          </Button>
          <span className="text-xs text-muted-foreground">
            The test uses the saved mail server and the saved recipients — save both first.
          </span>
        </div>
        {last && (
          <p className="text-xs text-muted-foreground">
            Last attempt {new Date(last.at).toLocaleString()}:{" "}
            <span className={last.ok ? "" : "text-red-600"}>
              {last.ok ? last.message : `failed — ${last.message}`}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
