"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  async function handleAccept() {
    setStatus("loading");
    setError(null);

    const res = await fetch("/api/v1/orgs/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error?.message ?? "Could not accept invitation.");
      setStatus("idle");
      return;
    }

    setOrgName(json.data.org?.name ?? null);
    setStatus("done");
  }

  if (status === "done") {
    return (
      <div className="invite-response invite-response--success">
        <p>Welcome to your learning workspace</p><h2>You&apos;ve joined {orgName ?? "the organisation"}.</h2><span>Your access is ready. Start with your personal learning home.</span>
        <button
          onClick={() => {
            // Plain push() can serve a stale cached /dashboard from
            // before the invite was accepted (e.g. the copy rendered
            // right after signup, still showing "no org yet") — refresh()
            // forces the destination's Server Component data to be
            // refetched instead of reused from the router cache.
            router.push("/dashboard");
            router.refresh();
          }}
        >
          Go to learning home →
        </button>
      </div>
    );
  }

  return (
    <div className="invite-response">
      {error && <p className="invite-response__error">{error}</p>}
      <button onClick={handleAccept} disabled={status === "loading"}>
        {status === "loading" ? "Joining…" : "Accept invitation"}
      </button>
    </div>
  );
}
