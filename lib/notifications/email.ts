import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationType = "org_invitation" | "assessment_assignment" | "course_auto_enrollment" | "course_reenrollment_due";
type NotificationStatus = "sent" | "failed";

export type EmailDeliveryResult =
  | { ok: true; provider: "resend"; notificationId: string | null; messageId: string | null }
  | { ok: false; provider: "resend"; notificationId: string | null; reason: "INVALID_RECIPIENT" | "NOT_CONFIGURED" | "PROVIDER_REJECTED" | "NETWORK_ERROR" };

export type SendEmailParams = {
  admin: SupabaseClient;
  orgId: string;
  notificationType: NotificationType;
  recipient: { email: string | null | undefined; userId?: string | null };
  subject: string;
  html: string;
  text: string;
  entity?: { type: string; id: string };
  metadata?: Record<string, unknown>;
};

type ProviderResponse = { id?: unknown; message?: unknown };
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/** Records every attempt without allowing audit failure to break product work. */
async function logNotification(
  admin: SupabaseClient,
  entry: {
    orgId: string; recipientEmail: string | null; recipientUserId?: string | null;
    notificationType: NotificationType; subject: string; status: NotificationStatus;
    providerMessageId?: string | null; errorMessage?: string | null;
    entity?: { type: string; id: string }; metadata?: Record<string, unknown>;
  }
): Promise<string | null> {
  try {
    const { data, error } = await admin.from("notification_logs").insert({
      org_id: entry.orgId, recipient_email: entry.recipientEmail,
      recipient_user_id: entry.recipientUserId ?? null, notification_type: entry.notificationType,
      provider: "resend", subject: entry.subject, status: entry.status,
      provider_message_id: entry.providerMessageId ?? null, error_message: entry.errorMessage ?? null,
      entity_type: entry.entity?.type ?? null, entity_id: entry.entity?.id ?? null,
      metadata: entry.metadata ?? {}, sent_at: entry.status === "sent" ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) {
      console.error("[notifications] Could not record email delivery", error.message);
      return null;
    }
    return data.id;
  } catch (error) {
    console.error("[notifications] Could not record email delivery", error);
    return null;
  }
}

function providerError(response: ProviderResponse | null, status: number): string {
  const message = typeof response?.message === "string" ? response.message : "Email provider rejected the request.";
  return `Resend ${status}: ${message}`.slice(0, 2_000);
}

/** Single server-only Resend boundary. Every outcome is recoverable and logged. */
export async function sendEmail(params: SendEmailParams): Promise<EmailDeliveryResult> {
  const recipientEmail = params.recipient.email?.trim().toLowerCase() || null;
  const baseLog = { orgId: params.orgId, recipientEmail, recipientUserId: params.recipient.userId,
    notificationType: params.notificationType, subject: params.subject, entity: params.entity, metadata: params.metadata };

  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    const notificationId = await logNotification(params.admin, { ...baseLog, status: "failed", errorMessage: "No valid recipient email was available for this notification." });
    console.error("[notifications] Email not sent: no valid recipient email.");
    return { ok: false, provider: "resend", notificationId, reason: "INVALID_RECIPIENT" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    const notificationId = await logNotification(params.admin, { ...baseLog, status: "failed", errorMessage: "RESEND_API_KEY and RESEND_FROM_EMAIL must both be configured." });
    console.error("[notifications] Email not sent: Resend is not configured.");
    return { ok: false, provider: "resend", notificationId, reason: "NOT_CONFIGURED" };
  }

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [recipientEmail], subject: params.subject, html: params.html, text: params.text }), cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as ProviderResponse | null;
    if (!response.ok) {
      const notificationId = await logNotification(params.admin, { ...baseLog, status: "failed", errorMessage: providerError(payload, response.status) });
      console.error("[notifications] Email provider rejected delivery", response.status);
      return { ok: false, provider: "resend", notificationId, reason: "PROVIDER_REJECTED" };
    }
    const messageId = typeof payload?.id === "string" ? payload.id : null;
    const notificationId = await logNotification(params.admin, { ...baseLog, status: "sent", providerMessageId: messageId });
    return { ok: true, provider: "resend", notificationId, messageId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown network error.";
    const notificationId = await logNotification(params.admin, { ...baseLog, status: "failed", errorMessage: `Resend network error: ${detail}`.slice(0, 2_000) });
    console.error("[notifications] Email delivery request failed", error);
    return { ok: false, provider: "resend", notificationId, reason: "NETWORK_ERROR" };
  }
}
