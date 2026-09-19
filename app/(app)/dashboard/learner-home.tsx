"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface WorkRow {
  kind: "course" | "assessment" | "learning_path";
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

function isDone(row: WorkRow): boolean {
  return row.kind === "assessment" ? row.status === "passed" || row.status === "submitted" : row.status === "completed";
}

function readableDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
}

function CourseArtwork({ index }: { index: number }) {
  const className = `learner-course__art learner-course__art--${index % 4}`;
  return (
    <div className={className} aria-hidden="true">
      <span className="learner-course__orb learner-course__orb--one" />
      <span className="learner-course__orb learner-course__orb--two" />
      <span className="learner-course__line learner-course__line--one" />
      <span className="learner-course__line learner-course__line--two" />
      <span className="learner-course__shape" />
    </div>
  );
}

function Status({ row }: { row: WorkRow }) {
  if (row.kind === "assessment") {
    if (row.status === "passed") return <>Passed {readableDate(row.completedAt)}</>;
    if (row.status === "submitted") return <>Submitted {readableDate(row.completedAt)}</>;
    if (row.overdue) return <>Overdue · due {readableDate(row.dueDate)}</>;
    if (row.dueDate) return <>Due {readableDate(row.dueDate)}</>;
    return "Ready to attempt";
  }
  if (row.status === "completed") return <>Completed {readableDate(row.completedAt)}</>;
  if (row.overdue) return <>Overdue · due {readableDate(row.dueDate)}</>;
  if (row.dueDate) return <>Due {readableDate(row.dueDate)}</>;
  return (row.percent ?? 0) > 0 ? "Ready to continue" : "Ready to start";
}

export function LearnerHome({
  canSeeReports,
  canManageOrganization,
  canAuthor,
}: {
  canSeeReports: boolean;
  canManageOrganization: boolean;
  canAuthor: boolean;
}) {
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [certificateCount, setCertificateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/v1/my-work");
      if (cancelled) return;
      if (response.ok) {
        const json = await response.json();
        setRows(json.data.rows ?? []);
        setCertificateCount(json.data.certificateCount ?? 0);
      } else {
        setLoadError(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        const aDone = isDone(a);
        const bDone = isDone(b);
        if (aDone !== bDone) return aDone ? 1 : -1;
        return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      }),
    [rows]
  );
  const next = sorted.find((row) => !isDone(row)) ?? sorted[0];
  const completed = rows.filter(isDone).length;
  const active = rows.length - completed;
  const remainingItems = rows.filter((row) => row.kind === "course" && !isDone(row)).length;
  const dueSoon = sorted.find((row) => row.dueDate && !isDone(row));
  const overdueCount = rows.filter((row) => row.overdue && !isDone(row)).length;

  if (loading) return <p className="learner-loading">Preparing your learning space…</p>;
  if (loadError) return <p className="learner-error">We could not load your learning right now. Please refresh and try again.</p>;

  return (
    <div className="learner-home">
      <div className="learner-home__main">
        <p className="learner-home__eyebrow">Your learning space</p>
        <h1>One useful learning move at a time.</h1>
        <p className="learner-home__intro">Everything assigned to you—courses and assessments—in one place, kept clear enough to act on.</p>

        {next ? (
          <Link className="learner-resume" href={next.href}>
            <span className="learner-resume__icon" aria-hidden="true">↗</span>
            <span>
              <small>{next.kind === "assessment" ? "Continue evidence" : "Continue learning"}</small>
              <strong>{next.title}</strong>
              <em>
                {isDone(next)
                  ? next.kind === "assessment"
                    ? "Review your result"
                    : "Review completed learning"
                  : next.kind === "assessment"
                    ? "Show what you understand"
                    : `${next.percent ?? 0}% complete`}
              </em>
            </span>
            <b>{isDone(next) ? "Review" : next.kind === "assessment" ? "Attempt" : next.percent ? "Continue" : "Start"} →</b>
          </Link>
        ) : (
          <section className="learner-empty" aria-label="No active learning">
            <p className="learner-home__eyebrow">Ready when you are</p>
            <h2>Choose a course that helps with your next challenge.</h2>
            <Link href="/courses">Explore learning →</Link>
          </section>
        )}

        <section className="learner-metrics" aria-label="Learning summary">
          <div><span>Assigned to you</span><strong>{active}</strong><small>{active === 1 ? "item" : "items"}</small></div>
          <div><span>Completed</span><strong>{completed}</strong><small>{completed === 1 ? "item" : "items"}</small></div>
          <div><span>Courses in progress</span><strong>{remainingItems}</strong><small>{remainingItems === 1 ? "course left" : "courses left"}</small></div>
          <div><span>Due next</span><strong>{dueSoon ? readableDate(dueSoon.dueDate) : "—"}</strong><small>{dueSoon ? "learning activity" : "nothing scheduled"}</small></div>
          <div className={overdueCount ? "learner-metric--urgent" : ""}><span>Overdue</span><strong>{overdueCount}</strong><small>{overdueCount === 1 ? "item" : "items"}</small></div>
          <div><span>Certificates earned</span><strong>{certificateCount}</strong><small>{certificateCount === 1 ? "certificate" : "certificates"}</small></div>
        </section>

        <section className="learner-section" aria-labelledby="your-learning-heading">
          <div className="learner-section__heading">
            <div><p className="learner-home__eyebrow">Your worklist</p><h2 id="your-learning-heading">Your learning</h2></div>
            <Link href="/courses">Explore catalogue →</Link>
          </div>
          {!rows.length ? (
            <p className="learner-no-courses">Nothing is assigned to you yet. You can still browse the catalogue.</p>
          ) : (
            <div className="learner-course-grid">
              {sorted.slice(0, 8).map((row, index) => (
                <Link key={`${row.kind}-${row.id}`} href={row.href} className="learner-course" data-testid="my-learning-row">
                  <CourseArtwork index={index} />
                  <span className="learner-course__body">
                    <small className={row.overdue ? "learner-course__status learner-course__status--urgent" : "learner-course__status"}>
                      <span className="learner-course__kind">{row.kind === "assessment" ? "Assessment" : row.kind === "learning_path" ? "Learning path" : "Course"}</span> · <Status row={row} />
                    </small>
                    <strong>{row.title}</strong>
                    {row.kind !== "assessment" ? (
                      <>
                        <span className="learner-course__progress" role="progressbar" aria-label={`${row.title} progress`} aria-valuenow={row.percent ?? 0} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${row.percent ?? 0}%` }} /></span>
                        <span className="learner-course__meta"><span>{row.percent ?? 0}% complete</span><span>{isDone(row) ? "Review" : row.percent ? "Continue" : "Start"} →</span></span>
                      </>
                    ) : (
                      <span className="learner-course__meta"><span>{row.status === "passed" ? "Passed" : row.status === "submitted" ? "Submitted" : "Not attempted"}</span><span>{isDone(row) ? "Review" : "Attempt"} →</span></span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="learner-rail" aria-label="Learning actions">
        <section className="learner-rail__panel">
          <p className="learner-home__eyebrow">Your learning signal</p>
          <h2>{active ? "Keep the momentum." : "Your learning is clear."}</h2>
          <div className="learner-signal-list">
            <p><i aria-hidden="true">↗</i><span><b>{active ? `${active} assigned ${active === 1 ? "item" : "items"}` : "Nothing outstanding"}</b><small>{active ? "Your next move is ready." : "Explore the catalogue when you are ready."}</small></span></p>
            <p><i aria-hidden="true">◌</i><span><b>{dueSoon ? "One date to keep in view" : "Nothing due soon"}</b><small>{dueSoon ? `${dueSoon.title} is due ${readableDate(dueSoon.dueDate)}.` : "There are no upcoming due dates."}</small></span></p>
          </div>
        </section>

        <section className="learner-rail__panel">
          <p className="learner-home__eyebrow">Quick actions</p>
          <nav className="learner-actions" aria-label="Quick actions">
            <Link href="/courses"><span aria-hidden="true">⌁</span>Explore catalogue</Link>
            <Link href="/certificates"><span aria-hidden="true">✦</span>Your certificates</Link>
            {canSeeReports && <Link href="/admin/reports"><span aria-hidden="true">↗</span>Team completion report</Link>}
            {canManageOrganization && <Link href="/admin"><span aria-hidden="true">◌</span>Manage organization</Link>}
            {canAuthor && <Link href="/admin/content"><span aria-hidden="true">✦</span>Authoring</Link>}
            <Link href="/guide"><span aria-hidden="true">O</span>Ask Orbit Guide</Link>
            <span className="learner-actions__disabled"><i aria-hidden="true">□</i>Learning calendar <em>Coming next</em></span>
            <span className="learner-actions__disabled"><i aria-hidden="true">✎</i>Saved reflections <em>Coming next</em></span>
          </nav>
        </section>

        <section className="learner-guide" aria-label="Orbit Guide">
          <div><span aria-hidden="true">O</span>Orbit Guide</div>
          <p>Ask a question and get an answer grounded in your organisation&apos;s published course material.</p>
          <Link href="/guide">Ask your learning →</Link>
        </section>
      </aside>
    </div>
  );
}
