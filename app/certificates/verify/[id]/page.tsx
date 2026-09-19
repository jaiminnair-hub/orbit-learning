import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated — reachable by anyone holding the certificate's
// own UUID. Deliberately not a session-scoped RLS read: certificates has
// no select policy for anon (supabase/migrations/20260903080000_certificates.sql),
// so this goes through the admin client and returns only a narrow,
// whitelisted field set — never user_id, org_id, or anything beyond
// what a verifier legitimately needs to confirm authenticity.
export default async function VerifyCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: certificate } = await admin
    .from("certificates")
    .select("id, org_id, source_type, title, recipient_name, score_percent, issued_at")
    .eq("id", id)
    .maybeSingle();
  if (!certificate) notFound();

  const { data: org } = await admin.from("organizations").select("name").eq("id", certificate.org_id).single();

  return (
    <main className="certificate-verify">
      <div className="certificate-verify__badge">✓ Verified</div>
      <h1>{certificate.title}</h1>
      <p className="certificate-verify__label">
        {certificate.source_type === "assessment" ? "Certificate of Achievement" : "Certificate of Completion"}
      </p>
      <dl>
        <div>
          <dt>Awarded to</dt>
          <dd>{certificate.recipient_name}</dd>
        </div>
        <div>
          <dt>Issued by</dt>
          <dd>{org?.name ?? "Orbit Learning"}</dd>
        </div>
        <div>
          <dt>Issue date</dt>
          <dd>{new Date(certificate.issued_at).toLocaleDateString()}</dd>
        </div>
        {certificate.score_percent !== null && (
          <div>
            <dt>Score</dt>
            <dd>{certificate.score_percent}%</dd>
          </div>
        )}
      </dl>
      <p className="certificate-verify__footer">This certificate was issued by Orbit Learning and is genuine.</p>
    </main>
  );
}
