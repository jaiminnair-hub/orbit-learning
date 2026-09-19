import { AcceptInvite } from "./accept-invite";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 360 }}>
      <h1>Join organization</h1>
      <AcceptInvite token={token} />
    </main>
  );
}
