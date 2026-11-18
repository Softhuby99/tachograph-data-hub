import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, Mail, Send, XCircle } from "lucide-react";
import { getNotifyStatus, saveNotifySettingsFn, sendNotifyTest } from "@/lib/notify.functions";

// v2.77: Tools → Notifications. Who gets an e-mail when an update run finds a
// new or changed entry. The mail server itself is configured in the container
// environment (SMTP_*), not here.

type NotifyStatus = Awaited<ReturnType<typeof getNotifyStatus>>;

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
  // Keyed by what is saved: a background refresh must not wipe what is being typed.
  return <NotifyForm key={JSON.stringify(q.data.settings)} status={q.data} />;
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
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" /> E-mail notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="text-xs text-muted-foreground">
          After every full update run (the daily automatic run and “Check for updates”) one e-mail
          lists the new and changed entries that wait in the Update Monitor. No mail is sent when a
          run finds nothing.
        </p>

        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 font-medium">
            {smtp.configured ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
            Mail server
          </div>
          {smtp.configured ? (
            <p className="mt-1 text-muted-foreground">
              {smtp.host}:{smtp.port} ·{" "}
              {smtp.security === "tls"
                ? "TLS"
                : smtp.security === "starttls"
                  ? "STARTTLS"
                  : "no encryption"}{" "}
              · {smtp.auth ? "with login" : "without login"} · sender {smtp.from}
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Not configured — missing {smtp.missing.join(" and ")}. Set the SMTP_* values in the
              container environment (/opt/TDH/.env, see .env.example) and restart the container.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Send an e-mail when an update run finds something
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Recipients (separate several addresses with a comma)
            </label>
            <Input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="name@example.org, team@example.org"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Sources</label>
            <select
              className="h-9 rounded-md border bg-background px-2"
              value={scope}
              onChange={(e) => setScope(e.target.value === "all" ? "all" : "jrc")}
            >
              <option value="jrc">JRC pages only (card status, other certificates, keys, …)</option>
              <option value="all">
                All sources (also Common Criteria, TED, research findings)
              </option>
            </select>
          </div>
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
              disabled={busy !== null || !smtp.configured}
              title={
                smtp.configured
                  ? "Sends to the saved recipients"
                  : "Configure the mail server first"
              }
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
              The test goes to the saved recipients — save first.
            </span>
          </div>
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
