"use client";
import { useEffect, useState } from "react";
type OrgHealth = { organizationId: string; organizationName: string; cyclesTotal: string; cyclesLive: string; deliveriesSent: string; deliveriesOpened: string; deliveriesCompleted: string };
type Health = { generatedAt: string; platformSummary: { organizationsWithFeedbackEnabled: number; cyclesAcrossPlatform: number }; organizations: OrgHealth[] } | null;
export function FeedbackHealthPanel() {
  const [health, setHealth] = useState<Health>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-configured" | "error">("loading");
  useEffect(() => {
    void fetch("/api/v1/platform-admin/feedback-health").then(async (response) => {
      const json = await response.json();
      if (response.status === 503) { setStatus("not-configured"); return; }
      if (!response.ok) { setStatus("error"); return; }
      setHealth(json.data);
      setStatus("ready");
    }).catch(() => setStatus("error"));
  }, []);
  return (
    <section className="platform-console__full-panel">
      <div className="platform-console__heading"><div><p>360 Feedback</p><h2>Platform health, in bands — never raw responses.</h2></div><span>Aggregate only</span></div>
      {status === "loading" && <p>Loading 360 health data…</p>}
      {status === "not-configured" && <p className="platform-console__empty">The 360 platform health rollup is not configured yet.</p>}
      {status === "error" && <p className="platform-console__empty">Orbit 360 health data is unavailable right now.</p>}
      {status === "ready" && health && (
        <>
          <div className="platform-console__metrics">
            <Metric label="Organisations with 360 enabled" value={health.platformSummary.organizationsWithFeedbackEnabled} detail="Active or trial entitlement" />
            <Metric label="Cycles across the platform" value={health.platformSummary.cyclesAcrossPlatform} detail="All-time, every organisation" />
          </div>
          {health.organizations.length ? (
            <table className="platform-console__health-table">
              <thead><tr><th>Organisation</th><th>Cycles (total)</th><th>Cycles (live)</th><th>Invitations sent</th><th>Opened</th><th>Completed</th></tr></thead>
              <tbody>
                {health.organizations.map((org) => (
                  <tr key={org.organizationId}><td>{org.organizationName}</td><td>{org.cyclesTotal}</td><td>{org.cyclesLive}</td><td>{org.deliveriesSent}</td><td>{org.deliveriesOpened}</td><td>{org.deliveriesCompleted}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="platform-console__empty">No organisation has 360 Feedback enabled yet.</p>}
          <small>Counts are shown in bands, not exact small numbers, and never include subject/rater identity, ratings or comments — the same anonymity discipline the product itself enforces.</small>
        </>
      )}
    </section>
  );
}
function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="platform-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
