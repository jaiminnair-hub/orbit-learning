"use client";

import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--certificate-name-font",
});

interface Certificate {
  id: string;
  source_type: "assessment" | "course";
  title: string;
  recipient_name: string;
  score_percent: number | null;
  issued_at: string;
}

// Location is a static string for now — there is no per-organization
// location field in the data model yet. A real field on `organizations`
// would be the natural fast-follow if this needs to vary by org.
const CERTIFICATE_LOCATION = "Bangalore, India";

export function CertificateView({
  certificate,
  orgName,
  siteUrl,
}: {
  certificate: Certificate;
  orgName: string;
  siteUrl: string;
}) {
  const verifyUrl = `${siteUrl}/certificates/verify/${certificate.id}`;
  const issuedDate = new Date(certificate.issued_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className={`certificate-view ${cormorant.variable}`}>
      <div className="certificate-view__actions">
        <Link href="/certificates">← Your certificates</Link>
        <button onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="certificate-print">
        <div className="certificate-print__frame">
          <span className="certificate-print__corner certificate-print__corner--tl" aria-hidden="true" />
          <span className="certificate-print__corner certificate-print__corner--tr" aria-hidden="true" />
          <span className="certificate-print__corner certificate-print__corner--bl" aria-hidden="true" />
          <span className="certificate-print__corner certificate-print__corner--br" aria-hidden="true" />

          <p className="certificate-print__eyebrow">
            {certificate.source_type === "assessment" ? "Certificate of Achievement" : "Certificate of Completion"}
          </p>

          <h1 className="certificate-print__title">{certificate.title}</h1>
          {certificate.score_percent !== null && (
            <p className="certificate-print__score">Scored {certificate.score_percent}%</p>
          )}

          <p className="certificate-print__awarded-to">This certifies that</p>
          <h2 className="certificate-print__name">{certificate.recipient_name}</h2>

          <div className="certificate-print__divider" aria-hidden="true">
            <span />
            <i />
            <span />
          </div>

          <p className="certificate-print__body">
            {certificate.source_type === "assessment"
              ? "has demonstrated proficiency in the assessment above."
              : "has successfully completed the course above."}
          </p>

          <div className="certificate-print__footer">
            <div className="certificate-print__footer-block">
              <strong>{orgName}</strong>
              <span>
                Issued {issuedDate} · {CERTIFICATE_LOCATION}
              </span>
            </div>

            <div className="certificate-print__seal">
              <span className="certificate-print__seal-badge">O</span>
              <span className="certificate-print__seal-label">Orbit Learning</span>
            </div>

            <div className="certificate-print__footer-block certificate-print__footer-block--right">
              <span>Verify at</span>
              <strong>{verifyUrl}</strong>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
