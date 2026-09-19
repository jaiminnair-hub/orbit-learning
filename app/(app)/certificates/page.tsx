import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function CertificatesHome() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const { data: certificates } = await supabase
    .from("certificates")
    .select("id, source_type, title, score_percent, issued_at")
    .eq("org_id", session!.orgId)
    .eq("user_id", session!.userId)
    .order("issued_at", { ascending: false });

  return (
    <main className="certificate-home">
      <section>
        <p>Orbit Learning · your certificates</p>
        <h1>Proof of what you&apos;ve done.</h1>
        <span>Every certificate here is issued automatically — passing an assessment or finishing a course, never self-declared.</span>
      </section>
      <div className="certificate-home__list">
        {(certificates ?? []).length === 0 ? (
          <article>
            <h2>No certificates yet</h2>
            <p>Pass an assessment or complete a course and it will appear here.</p>
          </article>
        ) : (
          (certificates ?? []).map((cert) => (
            <article key={cert.id}>
              <div>
                <p>{cert.source_type === "assessment" ? "Certificate of achievement" : "Certificate of completion"}</p>
                <h2>{cert.title}</h2>
                <span>
                  Issued {new Date(cert.issued_at).toLocaleDateString()}
                  {cert.score_percent !== null ? ` · scored ${cert.score_percent}%` : ""}
                </span>
              </div>
              <Link href={`/certificates/${cert.id}`}>View certificate →</Link>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
