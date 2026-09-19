import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/notifications/email";
import { assessmentAssignedEmail, courseEnrollmentEmail, invitationReceivedEmail } from "@/lib/notifications/templates";

const inserted: Array<Record<string, unknown>> = [];

function fakeAdmin(): SupabaseClient {
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
}

const baseEmail = {
  admin: fakeAdmin(),
  orgId: "22222222-2222-4222-8222-222222222222",
  notificationType: "assessment_assignment" as const,
  recipient: { email: "Learner@Example.com", userId: "33333333-3333-4333-8333-333333333333" },
  subject: "Assessment assigned",
  html: "<p>Open it</p>",
  text: "Open it",
};

beforeEach(() => {
  inserted.length = 0;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("returns an honest failure and audits it when Resend is unconfigured", async () => {
    const result = await sendEmail(baseEmail);

    expect(result).toMatchObject({ ok: false, provider: "resend", reason: "NOT_CONFIGURED" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      recipient_email: "learner@example.com",
      status: "failed",
      notification_type: "assessment_assignment",
    });
  });

  it("calls Resend and audits the provider message id on success", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "Orbit Learning <notify@example.com>";
    const provider = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));
    vi.stubGlobal("fetch", provider);

    const result = await sendEmail(baseEmail);

    expect(result).toMatchObject({ ok: true, messageId: "email_123" });
    expect(provider).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    expect(inserted[0]).toMatchObject({ status: "sent", provider_message_id: "email_123" });
  });
});

describe("notification templates", () => {
  it("includes the real invitation action and escapes untrusted organization text", () => {
    const content = invitationReceivedEmail({
      organizationName: "Example <script>alert(1)</script>",
      role: "org_admin",
      acceptUrl: "https://learning.example.com/invite/token",
      expiresAt: "2026-09-11T10:00:00.000Z",
    });

    expect(content.text).toContain("https://learning.example.com/invite/token");
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("distinguishes first enrollment from recurring re-enrollment", () => {
    const first = courseEnrollmentEmail({ courseTitle: "Safety", courseUrl: "https://example.com/courses/1", isReenrollment: false });
    const recurring = courseEnrollmentEmail({ courseTitle: "Safety", courseUrl: "https://example.com/courses/1", isReenrollment: true });

    expect(first.text).toContain("automatically enrolled");
    expect(recurring.text).toContain("new completion cycle");
  });

  it("includes an optional assessment due date in both text and HTML", () => {
    const content = assessmentAssignedEmail({
      assessmentTitle: "Annual safety check",
      dueDate: "2026-09-30",
      assessmentUrl: "https://example.com/assessments/1",
    });

    expect(content.text).toContain("September 30, 2026");
    expect(content.html).toContain("September 30, 2026");
  });
});
