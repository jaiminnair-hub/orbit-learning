type EmailContent = { subject: string; text: string; html: string };
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function safeName(name: string | null | undefined): string { return name?.trim() ? `Hi ${name.trim()},` : "Hello,"; }
function emailLayout(preheader: string, body: string): string { return `<!doctype html><html lang="en"><body style="margin:0;background:#f6f7fb;color:#172554;font-family:Arial,sans-serif;line-height:1.5"><span style="display:none!important;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</span><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px"><p style="margin:0 0 24px;font-weight:700;color:#4f46e5">Orbit Learning</p>${body}</section><p style="margin:16px 0 0;color:#64748b;font-size:12px">This is a transactional Orbit Learning notification.</p></main></body></html>`; }
function actionLink(label: string, href: string): string { return `<p style="margin:28px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#4f46e5;border-radius:8px;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p>`; }

export function invitationReceivedEmail(params: { organizationName: string; role: string; acceptUrl: string; expiresAt: string }): EmailContent {
  const organizationName = escapeHtml(params.organizationName); const role = escapeHtml(params.role.replace(/_/g, " "));
  const expiry = new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short" }).format(new Date(params.expiresAt));
  return { subject: `You’re invited to join ${params.organizationName} on Orbit Learning`, text: `You have been invited to join ${params.organizationName} as ${params.role.replace(/_/g, " ")}. Accept your invitation by ${expiry}: ${params.acceptUrl}`,
    html: emailLayout(`Join ${params.organizationName} on Orbit Learning.`, `<h1 style="margin:0 0 16px;font-size:28px">You’re invited to Orbit Learning</h1><p>${organizationName} has invited you to join as <strong>${role}</strong>.</p>${actionLink("Accept invitation", params.acceptUrl)}<p style="color:#64748b;font-size:14px">This invitation expires ${escapeHtml(expiry)}.</p>`) };
}
export function assessmentAssignedEmail(params: { recipientName?: string | null; assessmentTitle: string; dueDate?: string | null; assessmentUrl: string }): EmailContent {
  const due = params.dueDate ? ` It is due ${new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(params.dueDate))}.` : "";
  return { subject: `Assessment assigned: ${params.assessmentTitle}`, text: `${safeName(params.recipientName)} You have been assigned “${params.assessmentTitle}”.${due} Open it here: ${params.assessmentUrl}`,
    html: emailLayout(`You have a new assessment: ${params.assessmentTitle}.`, `<p>${escapeHtml(safeName(params.recipientName))}</p><h1 style="margin:0 0 16px;font-size:28px">A new assessment is ready</h1><p>You have been assigned <strong>${escapeHtml(params.assessmentTitle)}</strong>.${escapeHtml(due)}</p>${actionLink("Open assessment", params.assessmentUrl)}`) };
}
export function courseEnrollmentEmail(params: { recipientName?: string | null; courseTitle: string; courseUrl: string; isReenrollment: boolean }): EmailContent {
  const heading = params.isReenrollment ? "Your next learning cycle is ready" : "A course has been added to your learning";
  const sentence = params.isReenrollment
    ? `Your recurring enrollment for “${params.courseTitle}” is ready for a new completion cycle.`
    : `You have been automatically enrolled in “${params.courseTitle}”.`;
  return { subject: params.isReenrollment ? `It’s time to revisit ${params.courseTitle}` : `Course added: ${params.courseTitle}`, text: `${safeName(params.recipientName)} ${sentence} Continue your course: ${params.courseUrl}`,
    html: emailLayout(sentence, `<p>${escapeHtml(safeName(params.recipientName))}</p><h1 style="margin:0 0 16px;font-size:28px">${escapeHtml(heading)}</h1><p>${escapeHtml(sentence)}</p>${actionLink("Continue course", params.courseUrl)}`) };
}
