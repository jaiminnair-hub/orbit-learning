"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/shell/Shell";

interface Course {
  id: string;
  title: string;
}
interface Rule {
  id: string;
  course_id: string;
  trigger: "on_join" | "role_equals";
  role_value: string | null;
  recur_after_days: number | null;
  active: boolean;
  courses: { title: string } | { title: string }[] | null;
}

const ROLE_LABEL: Record<string, string> = {
  learner: "Learner",
  manager: "Manager",
  org_admin: "Organisation admin",
  org_owner: "Organisation owner",
};

function courseTitle(rule: Rule): string {
  const c = Array.isArray(rule.courses) ? rule.courses[0] : rule.courses;
  return c?.title ?? "Untitled course";
}

function triggerLabel(rule: Rule): string {
  return rule.trigger === "on_join" ? "Every new member" : `Role: ${ROLE_LABEL[rule.role_value ?? ""] ?? rule.role_value}`;
}

/**
 * Automated enrollment rules — item 2 of the comparison-matrix follow-up.
 * A rule fires once, at the real moment someone joins the org (accepting
 * an invitation); an optional recurrence re-enrolls them automatically
 * once their prior completion is old enough, checked the next time they
 * load their own worklist. See lib/lms/enrollment-rules.ts for both.
 */
export function EnrollmentRulesPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseId, setCourseId] = useState("");
  const [trigger, setTrigger] = useState<"on_join" | "role_equals">("on_join");
  const [roleValue, setRoleValue] = useState("learner");
  const [recurAfterDays, setRecurAfterDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [rRes, cRes] = await Promise.all([
      fetch("/api/v1/enrollment-rules"),
      fetch("/api/v1/content/courses?status=published"),
    ]);
    if (rRes.ok) setRules((await rRes.json()).data.rules);
    if (cRes.ok) setCourses((await cRes.json()).data.courses);
    setLoading(false);
  }

  // Inlined rather than calling load() directly, matching activity-panel.tsx
  // and assign-panel.tsx: an effect body that references a named
  // setState-calling function (even fire-and-forget) trips
  // react-hooks/set-state-in-effect, which can't see the awaits inside it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rRes, cRes] = await Promise.all([
        fetch("/api/v1/enrollment-rules"),
        fetch("/api/v1/content/courses?status=published"),
      ]);
      if (cancelled) return;
      if (rRes.ok) setRules((await rRes.json()).data.rules);
      if (cRes.ok) setCourses((await cRes.json()).data.courses);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createRule() {
    if (!courseId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/enrollment-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId,
        trigger,
        roleValue: trigger === "role_equals" ? roleValue : undefined,
        recurAfterDays: recurAfterDays ? Number(recurAfterDays) : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not create the rule.");
      return;
    }
    setCourseId("");
    setRecurAfterDays("");
    await load();
  }

  async function removeRule(id: string) {
    await fetch(`/api/v1/enrollment-rules/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Card className="reports-workspace__table-card">
      <header>
        <div>
          <p>Automation</p>
          <h2>Automated enrollment rules</h2>
        </div>
        <span>{loading ? "Updating…" : `${rules.length} active`}</span>
      </header>

      {error && <p className="reports-workspace__empty">{error}</p>}

      <div className="reports-workspace__controls" style={{ padding: 0, boxShadow: "none", border: "none" }}>
        <div>
          <label>
            Course
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Choose a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            When
            <select value={trigger} onChange={(e) => setTrigger(e.target.value as "on_join" | "role_equals")}>
              <option value="on_join">Every new member joins</option>
              <option value="role_equals">A member joins with a role</option>
            </select>
          </label>
          {trigger === "role_equals" && (
            <label>
              Role
              <select value={roleValue} onChange={(e) => setRoleValue(e.target.value)}>
                {Object.entries(ROLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Re-enrol after (days, optional)
            <input
              type="number"
              min={1}
              placeholder="e.g. 365 for annual training"
              value={recurAfterDays}
              onChange={(e) => setRecurAfterDays(e.target.value)}
            />
          </label>
          <button className="reports-workspace__export" onClick={createRule} disabled={busy || !courseId}>
            {busy ? "Adding…" : "Add rule"}
          </button>
        </div>
      </div>

      {!loading && rules.length === 0 ? (
        <p className="reports-workspace__empty">
          No automation yet. Add a rule to auto-enrol new members into a course, optionally re-enrolling them on a
          recurring schedule (e.g. annual compliance training).
        </p>
      ) : (
        <div className="reports-workspace__table-wrap">
          <table className="reports-workspace__table">
            <thead>
              <tr>
                {["Course", "Applies to", "Recurs", ""].map((h) => (
                  <th key={h} className="px-2 py-1.5 border-b border-border text-sm">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-2 py-1.5 border-b border-border text-sm">{courseTitle(rule)}</td>
                  <td className="px-2 py-1.5 border-b border-border text-sm">{triggerLabel(rule)}</td>
                  <td className="px-2 py-1.5 border-b border-border text-sm">
                    {rule.recur_after_days ? `Every ${rule.recur_after_days} days` : "—"}
                  </td>
                  <td className="px-2 py-1.5 border-b border-border text-sm">
                    <button type="button" className="reports-workspace__learner-link" onClick={() => removeRule(rule.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
