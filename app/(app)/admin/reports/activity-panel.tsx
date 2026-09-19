"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/shell/Shell";
import { createClient } from "@/lib/supabase/client";

interface ActivityRow {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  is_platform_admin_action: boolean;
  created_at: string;
}

function activityLabel(eventType: string) {
  return eventType.replaceAll("_", " ").replaceAll(".", " · ");
}

function timeLabel(value: string) {
  return new Date(value).toLocaleString();
}

/**
 * The org's own compliance trail — who did what, when, reusing the same
 * activity_log rows Platform Control's Activity & audit tab reads, but
 * scoped to this org and readable by an org admin, not just the platform
 * owner. Org-level event coverage (member/course/assessment/enrolment/
 * certificate events) is instrumented in lib/activity-log.ts's call sites;
 * this panel is the first place an org admin can actually see it.
 */
export function ActivityPanel({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/reports/activity?limit=50");
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error?.message ?? "Could not load the activity log.");
        setLoading(false);
        return;
      }
      setRows(json.data.activity);
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates: a new activity_log row for this org (someone else's
  // action, in another tab or another admin entirely) is prepended
  // directly from the Realtime payload rather than waiting for a
  // reload — activity_log is append-only, so an INSERT event is the only
  // kind of change this table can ever produce, and the payload already
  // carries the full row.
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`reports-activity-${orgId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log", filter: `org_id=eq.${orgId}` },
        (payload) => {
          setRows((prev) => [payload.new as ActivityRow, ...prev].slice(0, 50));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  return (
    <Card className="reports-workspace__table-card">
      <header>
        <div>
          <p>Compliance trail</p>
          <h2>Activity in your organisation</h2>
        </div>
        <div className="reports-workspace__controls-heading" style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
          <span>{loading ? "Updating…" : `${rows.length} recent entries`}</span>
          <a className="reports-workspace__export" href="/api/v1/reports/activity?format=csv">
            Download CSV ↓
          </a>
        </div>
      </header>

      {error && <p className="reports-workspace__empty">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="reports-workspace__empty">
          No activity recorded yet. Member invites, course and assessment publishing, assignments,
          enrolments and certificate issuance will appear here as they happen.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="platform-console__activity-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div>
                <b>{activityLabel(r.event_type)}</b>
                <span>{r.is_platform_admin_action ? "Platform-owner action" : "Organisation workspace action"}</span>
              </div>
              <time>{timeLabel(r.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
