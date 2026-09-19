import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type EmailDeliveryResult } from "./email";
import { assessmentAssignedEmail, courseEnrollmentEmail, invitationReceivedEmail } from "./templates";
function siteUrl(): string { return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""); }

export async function sendInvitationReceivedEmail(admin: SupabaseClient, params: { orgId: string; invitationId: string; recipientEmail: string; organizationName: string; role: string; token: string; expiresAt: string }): Promise<EmailDeliveryResult> {
  const content = invitationReceivedEmail({ organizationName: params.organizationName, role: params.role, acceptUrl: `${siteUrl()}/invite/${params.token}`, expiresAt: params.expiresAt });
  return sendEmail({ admin, orgId: params.orgId, notificationType: "org_invitation", recipient: { email: params.recipientEmail }, ...content, entity: { type: "org_invitations", id: params.invitationId }, metadata: { role: params.role } });
}
export async function sendAssessmentAssignedEmail(admin: SupabaseClient, params: { orgId: string; assignmentId: string; assessmentId: string; recipient: { userId: string; email: string | null; name?: string | null }; assessmentTitle: string; dueDate: string | null }): Promise<EmailDeliveryResult> {
  const content = assessmentAssignedEmail({ recipientName: params.recipient.name, assessmentTitle: params.assessmentTitle, dueDate: params.dueDate, assessmentUrl: `${siteUrl()}/assessments/${params.assessmentId}` });
  return sendEmail({ admin, orgId: params.orgId, notificationType: "assessment_assignment", recipient: { email: params.recipient.email, userId: params.recipient.userId }, ...content, entity: { type: "assessment_assignments", id: params.assignmentId }, metadata: { assessmentId: params.assessmentId, dueDate: params.dueDate } });
}
export async function sendCourseEnrollmentEmail(admin: SupabaseClient, params: { orgId: string; enrollmentId: string; courseId: string; userId: string; ruleId: string; isReenrollment: boolean }): Promise<EmailDeliveryResult> {
  const [{ data: person, error: personError }, { data: course, error: courseError }] = await Promise.all([
    admin.from("profiles").select("email, full_name").eq("id", params.userId).eq("org_id", params.orgId).maybeSingle(),
    admin.from("courses").select("title").eq("id", params.courseId).eq("org_id", params.orgId).maybeSingle(),
  ]);
  const content = courseEnrollmentEmail({ recipientName: person?.full_name, courseTitle: course?.title ?? "your course", courseUrl: `${siteUrl()}/courses/${params.courseId}`, isReenrollment: params.isReenrollment });
  return sendEmail({ admin, orgId: params.orgId, notificationType: params.isReenrollment ? "course_reenrollment_due" : "course_auto_enrollment", recipient: { email: person?.email, userId: params.userId }, ...content, entity: { type: "enrollments", id: params.enrollmentId }, metadata: { courseId: params.courseId, ruleId: params.ruleId, lookupError: personError || courseError ? "Recipient or course lookup failed before delivery." : undefined } });
}
export { sendEmail } from "./email";
export type { EmailDeliveryResult, NotificationType, SendEmailParams } from "./email";
