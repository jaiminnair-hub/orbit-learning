"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/shell/Shell";

interface WorkRow {
  kind: "course" | "assessment";
  id: string;
  refId: string;
  title: string;
  status: string;
  percent: number | null;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
  href: string;
}

interface Learner {
  id: string;
  email: string;
  full_name: string | null;
}

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

const STATUS_LABEL: Record<string, string> = {
  enrolled: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  expired: "Expired",
  withdrawn: "Withdrawn",
  assigned: "Not attempted",
  submitted: "Submitted",
  passed: "Passed",
};

/**
 * One learner's full picture — courses and assessments together — so an
 * admin doesn't have to cross-reference Reports and the Assessments
 * console separately to answer "how is this person doing."
 */
export function LearnerDrilldown({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [learner, setLearner] = useState<Learner | null>(null);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/reports/learner/${userId}`);
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error?.message ?? "Could not load this person's worklist.");
        setLoading(false);
        return;
      }
      setLearner(json.data.learner);
      setRows(json.data.rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="learner-drilldown__overlay" role="dialog" aria-label="Learner worklist">
      <Card className="learner-drilldown__panel">
        <header className="learner-drilldown__header">
          <div>
            <p>Assign &amp; Track</p>
            <h2>{learner?.full_name || learner?.email || "Loading…"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {loading && <p className="learner-drilldown__loading">Loading worklist…</p>}
        {error && <p className="learner-drilldown__error">{error}</p>}

        {!loading && !error && (
          rows.length === 0 ? (
            <p className="learner-drilldown__empty">Nothing assigned to this person yet.</p>
          ) : (
            <table className="learner-drilldown__table">
              <thead>
                <tr><th>Kind</th><th>Title</th><th>Status</th><th>Due</th><th>Completed</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>{row.kind === "course" ? "Course" : "Assessment"}</td>
                    <td>{row.title}{row.kind === "course" && row.percent != null ? ` (${row.percent}%)` : ""}</td>
                    <td>{STATUS_LABEL[row.status] ?? row.status}{row.overdue ? " · overdue" : ""}</td>
                    <td>{day(row.dueDate)}</td>
                    <td>{day(row.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </Card>
    </div>
  );
}
