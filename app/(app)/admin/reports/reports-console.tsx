"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/shell/Shell";
import { createClient } from "@/lib/supabase/client";
import { AssignPanel } from "./assign-panel";
import { LearnerDrilldown } from "./learner-drilldown";
import { ActivityPanel } from "./activity-panel";
import { EnrollmentRulesPanel } from "./enrollment-rules-panel";

interface Row {
  enrollmentId: string;
  userId: string;
  learnerName: string;
  learnerEmail: string;
  courseId: string;
  courseTitle: string;
  status: string;
  percent: number;
  objectsTotal: number;
  objectsCompleted: number;
  score: number | null;
  timeSpentSec: number;
  lastActivityAt: string | null;
  enrolledAt: string;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
}

interface Summary {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  averagePercent: number;
}

const cell = "px-2 py-1.5 border-b border-border text-sm";

const STATUS_LABEL: Record<string, string> = {
  enrolled: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

function duration(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function ReportsConsole({ canAssign, orgId }: { canAssign: boolean; orgId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [course, setCourse] = useState("");
  // Bumped after an assignment so the report re-reads rather than showing
  // a table that no longer matches what was just done.
  const [reloadKey, setReloadKey] = useState(0);
  const [drilldownUserId, setDrilldownUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const query = new URLSearchParams();
      if (status) query.set("status", status);
      if (course) query.set("courseId", course);

      const res = await fetch(`/api/v1/reports/completion?${query}`);
      const json = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setError(json.error?.message ?? "Could not load the report.");
        setLoading(false);
        return;
      }
      setRows(json.data.rows);
      setSummary(json.data.summary);
      setError(null);
      setLoading(false);
    })();

    // Filters change faster than the network answers; without this an
    // earlier, broader response can land last and overwrite the filtered
    // view the user is looking at.
    return () => {
      cancelled = true;
    };
  }, [status, course, reloadKey]);

  // Live updates: an enrollment or progress row changing for this org
  // (someone enrols, finishes a lesson, completes a course — from any
  // browser tab, not just this one) re-triggers the same fetch above
  // rather than leaving the table showing a stale snapshot until a manual
  // reload. Both tables are RLS-scoped to `org_id = current_org_id() and
  // has_role('manager')`, and Realtime enforces that same policy at
  // delivery time, so the `org_id=eq.` filter below is a courtesy
  // (skip a subscribed-but-irrelevant event) rather than the security
  // boundary — RLS already is.
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`reports-completion-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "enrollments", filter: `org_id=eq.${orgId}` }, () =>
        setReloadKey((k) => k + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "progress", filter: `org_id=eq.${orgId}` }, () =>
        setReloadKey((k) => k + 1)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  // Filtering by course is done against what the report already returned,
  // so the picker can only ever offer courses that actually have
  // enrolments — an empty report is a confusing thing to be able to ask
  // for.
  const courses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.courseId, r.courseTitle);
    return [...seen].map(([id, title]) => ({ id, title }));
  }, [rows]);

  function exportCsv() {
    const header = [
      "Learner",
      "Email",
      "Course",
      "Status",
      "Percent",
      "Score",
      "Time",
      "Enrolled",
      "Due",
      "Completed",
    ];
    const body = rows.map((r) => [
      r.learnerName,
      r.learnerEmail,
      r.courseTitle,
      STATUS_LABEL[r.status] ?? r.status,
      `${r.percent}%`,
      r.score == null ? "" : String(r.score),
      duration(r.timeSpentSec),
      day(r.enrolledAt),
      day(r.dueDate),
      day(r.completedAt),
    ]);
    // Quote everything: learner names and course titles routinely contain
    // commas, and an unquoted export silently shifts every later column.
    const csv = [header, ...body]
      .map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `completion-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="reports-workspace">
      {error && (
        <p className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">{error}</p>
      )}

      {canAssign && <AssignPanel onAssigned={() => setReloadKey((k) => k + 1)} />}
      {canAssign && <EnrollmentRulesPanel />}

      {summary && (
        <section className="reports-workspace__metrics" aria-label="Completion overview">
          {[
            { label: "Enrolments", value: summary.total },
            { label: "Completed", value: summary.completed },
            { label: "In progress", value: summary.inProgress },
            { label: "Not started", value: summary.notStarted },
            { label: "Overdue", value: summary.overdue },
            { label: "Average progress", value: `${summary.averagePercent}%` },
          ].map((s) => (
            <Card key={s.label} className="reports-workspace__metric">
              <div>{s.value}</div>
              <span>{s.label}</span>
            </Card>
          ))}
        </section>
      )}

      <Card className="reports-workspace__controls">
        <div>
          <div className="reports-workspace__controls-heading"><p>Read the signal</p><h2>Refine the view.</h2></div>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="enrolled">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </label>

          <label>
            Course
            <select
              data-testid="filter-course-select"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
            >
              <option value="">All</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>

          <button className="reports-workspace__export"
            onClick={exportCsv}
            disabled={!rows.length}
          >
            Export CSV
          </button>
          {/* Courses + assessments together, org-wide — unlike the button
              above, not limited to the currently filtered course view. */}
          <a className="reports-workspace__export" href="/api/v1/reports/export">
            Download full report ↓
          </a>
        </div>
      </Card>

      <Card className="reports-workspace__table-card">
        <header><div><p>Completion intelligence</p><h2>Learning progress</h2></div><span>{loading ? "Updating…" : `${rows.length} enrolments`}</span></header>

        {!loading && rows.length === 0 && (
          <p className="reports-workspace__empty">
            Nobody is enrolled in a course yet. Enrolments appear here as soon as learners join a
            published course.
          </p>
        )}

        {rows.length > 0 && (
          <div className="reports-workspace__table-wrap"><table className="reports-workspace__table">
            <thead>
              <tr className="text-left">
                {["Learner", "Course", "Status", "Progress", "Score", "Time", "Due", "Completed"].map(
                  (h) => (
                    <th key={h} className={cell}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.enrollmentId} data-testid="report-row">
                  <td className={cell}>
                    <button type="button" className="reports-workspace__learner-link" onClick={() => setDrilldownUserId(r.userId)}>
                      <div>{r.learnerName}</div>
                      <small>{r.learnerEmail}</small>
                    </button>
                  </td>
                  <td className={cell}>{r.courseTitle}</td>
                  <td className={cell}>
                    <span className={r.status === "completed" ? "reports-workspace__status reports-workspace__status--completed" : "reports-workspace__status"}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    {r.overdue && (
                      <span className="reports-workspace__overdue">overdue</span>
                    )}
                  </td>
                  <td className={cell}>
                    {r.percent}%{" "}
                    <span className="reports-workspace__progress-detail">
                      ({r.objectsCompleted}/{r.objectsTotal})
                    </span>
                  </td>
                  <td className={cell}>{r.score == null ? "—" : r.score}</td>
                  <td className={cell}>{duration(r.timeSpentSec)}</td>
                  <td className={cell}>{day(r.dueDate)}</td>
                  <td className={cell}>{day(r.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <ActivityPanel orgId={orgId} />

      {drilldownUserId && <LearnerDrilldown userId={drilldownUserId} onClose={() => setDrilldownUserId(null)} />}
    </div>
  );
}
