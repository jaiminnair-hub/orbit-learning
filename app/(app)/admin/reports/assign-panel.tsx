"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/shell/Shell";

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
}
interface Course {
  id: string;
  title: string;
}
interface Assessment {
  id: string;
  title: string;
  status: string;
}
interface LearningPath {
  id: string;
  title: string;
}

/**
 * Assigning learning to people — courses and assessments together, so an
 * admin doesn't have to leave Assign & Track to reach a second, separate
 * assignment flow inside the Assessments console.
 */
export function AssignPanel({ onAssigned }: { onAssigned: () => void }) {
  const [kind, setKind] = useState<"course" | "assessment" | "learning_path">("course");
  const [members, setMembers] = useState<Member[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [learningPaths, setLearningPaths] = useState<LearningPath[]>([]);
  const [itemId, setItemId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mRes, cRes, aRes, pRes] = await Promise.all([
        fetch("/api/v1/orgs/members"),
        // Only published courses/paths can be enrolled into, so offering
        // drafts here would just produce a 409 the admin can do nothing about.
        fetch("/api/v1/content/courses?status=published"),
        fetch("/api/v1/assessments"),
        fetch("/api/v1/content/learning-paths?status=published"),
      ]);
      if (cancelled) return;
      if (mRes.ok) setMembers((await mRes.json()).data.members);
      if (cRes.ok) setCourses((await cRes.json()).data.courses);
      if (aRes.ok) {
        const json = await aRes.json();
        setAssessments((json.data.assessments as Assessment[]).filter((a) => a.status === "published"));
      }
      if (pRes.ok) setLearningPaths((await pRes.json()).data.learningPaths);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function switchKind(next: "course" | "assessment" | "learning_path") {
    setKind(next);
    setItemId("");
    setSelected(new Set());
    setNotice(null);
    setError(null);
  }

  async function assign() {
    if (!itemId || selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const assignUrl =
      kind === "course"
        ? "/api/v1/enrollments"
        : kind === "assessment"
        ? `/api/v1/assessments/${itemId}/assign`
        : `/api/v1/learning-paths/${itemId}/assign`;
    const results = await Promise.all(
      [...selected].map(async (userId) => {
        const res = await fetch(assignUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(kind === "course" ? { courseId: itemId } : {}),
            userId,
            dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          }),
        });
        return { userId, status: res.status };
      })
    );

    const created = results.filter((r) => r.status === 201).length;
    // Already-assigned is not a failure worth shouting about: assigning to
    // a group that partly has it is an ordinary thing to do.
    const already = results.filter((r) => r.status === 409).length;
    const failed = results.filter((r) => r.status !== 201 && r.status !== 409).length;

    if (failed) setError(`${failed} assignment${failed > 1 ? "s" : ""} could not be created.`);
    setNotice(
      `Assigned to ${created} ${created === 1 ? "person" : "people"}` +
        (already ? `; ${already} already had it.` : ".")
    );
    setSelected(new Set());
    setBusy(false);
    onAssigned();
  }

  const items = kind === "course" ? courses : kind === "assessment" ? assessments : learningPaths;
  const kindLabel = kind === "course" ? "a course" : kind === "assessment" ? "an assessment" : "a learning path";

  return (
    <Card>
      <div className="assign-panel__kind-toggle" role="group" aria-label="Assign a course, an assessment, or a learning path">
        <button type="button" className={kind === "course" ? "is-active" : ""} onClick={() => switchKind("course")}>Course</button>
        <button type="button" className={kind === "assessment" ? "is-active" : ""} onClick={() => switchKind("assessment")}>Assessment</button>
        <button type="button" className={kind === "learning_path" ? "is-active" : ""} onClick={() => switchKind("learning_path")}>Learning path</button>
      </div>
      <h2 className="mt-0 mb-3 text-sm font-semibold text-card-foreground">Assign {kindLabel}</h2>

      {notice && <p className="text-sm text-success">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kind === "course"
            ? "No published courses yet. A course has to be published before anyone can be assigned to it."
            : kind === "assessment"
            ? "No published assessments yet. An assessment has to be published before anyone can be assigned to it."
            : "No published learning paths yet. A path has to be published before anyone can be assigned to it."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-card-foreground">
              {kind === "course" ? "Course" : kind === "assessment" ? "Assessment" : "Learning path"}
              <br />
              <select
                data-testid="assign-course-select"
                className="mt-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">Choose…</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-card-foreground">
              Due date (optional)
              <br />
              <input
                type="date"
                className="mt-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>

            <button
              onClick={assign}
              disabled={busy || !itemId || selected.size === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Assigning…" : `Assign to ${selected.size} selected`}
            </button>
          </div>

          <fieldset className="mt-3 rounded-md border border-border p-2">
            <legend className="px-1 text-xs text-muted-foreground">People</legend>
            <div className="max-h-[180px] overflow-y-auto">
              {members.map((m) => (
                <label key={m.id} className="block py-0.5 text-sm text-card-foreground">
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                  />{" "}
                  {m.full_name || m.email}
                  {m.status !== "active" && (
                    <span className="text-muted-foreground"> · {m.status}</span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </Card>
  );
}
