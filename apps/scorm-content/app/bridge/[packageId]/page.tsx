import { verifyBridgeToken } from "@/lib/bridge-token";
import { BridgeClient } from "./bridge-client";

/**
 * Server Component so the token is verified before anything — including
 * the shell of this page — renders for an unauthorized visitor. See
 * docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md.
 */
export default async function BridgePage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { packageId } = await params;
  const { token } = await searchParams;

  const claims = token ? verifyBridgeToken(token) : null;
  if (!claims || claims.packageId !== packageId) {
    return <p style={{ fontFamily: "system-ui", padding: 16 }}>This link is invalid or has expired.</p>;
  }

  const appOrigin = process.env.APP_ORIGIN ?? "";

  return (
    <BridgeClient
      packageId={packageId}
      token={token!}
      learnerId={claims.userId}
      learnerName={claims.userName}
      scormVersion={claims.scormVersion}
      entryPoint={claims.entryPoint}
      appOrigin={appOrigin}
    />
  );
}
