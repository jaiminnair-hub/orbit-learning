"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StatusPill } from "../ui";

interface Course {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  version: number;
  published_at: string | null;
}

export function CoursesConsole() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/content/courses");
      if (cancelled) return;
      if (res.ok) setCourses((await res.json()).data.courses);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    const res = await fetch("/api/v1/content/courses");
    if (res.ok) setCourses((await res.json()).data.courses);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/content/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not create the course.");
      return;
    }
    setTitle("");
    setDescription("");
    await reload();
  }

  if (loading) return <div className="studio-console__loading">Preparing your courses…</div>;

  return (
    <div className="studio-console">
      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}

      <p><Link href="/admin/content/learning-paths">Sequence published courses into a learning path →</Link> · <Link href="/admin/content/skills">Manage the skills vocabulary →</Link></p>

      <section className="studio-console__action-card">
        <div><p>01 · Learning journey</p><h2>Create a course.</h2><span>Start with its learning promise. You can build the sequence of modules, lessons and reusable objects inside the course studio.</span></div>
        <form onSubmit={create}>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </label>
          <button type="submit" disabled={busy || !title.trim()}>{busy ? "Creating…" : "Open course studio →"}</button>
        </form>
      </section>

      <section className="studio-console__section">
        <header><div><p>Published and in progress</p><h2>Courses</h2></div><span>{courses.length} courses</span></header>
        {courses.length === 0 ? (
          <p className="studio-console__empty">No courses yet. Create one when you are ready to shape a complete learning journey.</p>
        ) : (
          <div className="studio-console__table-wrap"><table className="studio-console__table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Title</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Version</th>
                <th style={{ textAlign: "left" }}>Published</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/content/courses/${c.id}`}>{c.title}</Link>
                  </td>
                  <td>
                    <StatusPill status={c.status} />
                  </td>
                  <td>v{c.version}</td>
                  <td>{c.published_at ? new Date(c.published_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
