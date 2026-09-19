import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CertificateView } from "./certificate-view";

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session?.orgId) notFound();

  const supabase = await createClient();
  const [{ data: certificate }, { data: org }] = await Promise.all([
    supabase
      .from("certificates")
      .select("id, source_type, title, recipient_name, score_percent, issued_at")
      .eq("id", id)
      .eq("org_id", session.orgId)
      .single(),
    supabase.from("organizations").select("name").eq("id", session.orgId).single(),
  ]);
  if (!certificate) notFound();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return <CertificateView certificate={certificate} orgName={org?.name ?? ""} siteUrl={siteUrl} />;
}
