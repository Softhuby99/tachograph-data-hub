import { createServerFn } from "@tanstack/react-start";
import { logActionFailure, requireAdmin } from "@/lib/events.server";

// v2.77: e-mail notifications (Tools → Notifications). Admin only.

export const getNotifyStatus = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin("read notification settings");
  const { notifyStatus } = await import("@/lib/notify.server");
  return await notifyStatus();
});

export const saveNotifySettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { enabled: boolean; recipients: string; scope: string }) => ({
    enabled: data?.enabled === true,
    recipients: String(data?.recipients ?? "").slice(0, 2000),
    scope: String(data?.scope ?? "jrc"),
  }))
  .handler(async ({ data }) => {
    await requireAdmin("change notification settings");
    const { saveNotifySettings } = await import("@/lib/notify.server");
    return await saveNotifySettings(data);
  });

/** v2.79: the mail server is administered in the app. The password is write-only. */
export const saveSmtpSettingsFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      host: string;
      port: number;
      security: string;
      user: string;
      password?: string;
      clearPassword?: boolean;
      from: string;
      tlsVerify: boolean;
    }) => ({
      host: String(data?.host ?? "").slice(0, 255),
      port: Number(data?.port ?? 0),
      security: String(data?.security ?? "starttls"),
      user: String(data?.user ?? "").slice(0, 320),
      password: String(data?.password ?? "").slice(0, 1024),
      clearPassword: data?.clearPassword === true,
      from: String(data?.from ?? "").slice(0, 400),
      tlsVerify: data?.tlsVerify !== false,
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin("change mail server");
    const { saveSmtpSettings } = await import("@/lib/notify.server");
    await saveSmtpSettings(data);
    return { ok: true };
  });

export const sendNotifyTest = createServerFn({ method: "POST" })
  .inputValidator((data: { to?: string }) => ({ to: String(data?.to ?? "").slice(0, 254) }))
  .handler(async ({ data }) => {
    await requireAdmin("send test e-mail");
    return logActionFailure("Send test e-mail", {}, async () => {
      const { sendTestMail } = await import("@/lib/notify.server");
      return sendTestMail(data.to || undefined);
    });
  });
