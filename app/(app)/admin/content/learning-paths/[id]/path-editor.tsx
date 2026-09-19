"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "../../ui";

interface LearningPath {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  version: number;
}
interface CourseRef {
  itemId: string;
  sequence: number;
  course: { id: string; title: string; status: string };
}
interface Course {
  id: string;
  title: string;
  status: string;
}

export function PathEditor({ pathId }: { pathId: string }) {
  const [path, setPath] = useState<LearningPath | null>(null);
  const [courses, setCourses] = useState<CourseRef[]>([]);
  const [library, setLibrary] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");

  async function load() {
    const [sRes, cRes] = await Promise.all([
      fetch(`/api/v1/content/learning-paths/${pathId}/structure`),
      fetch("/api/v1/content/courses?status=published"),
    ]);
    if (!sRes.ok) {
      setError("This learning path could not be loaded.");
      setLoading(false);
      return;
    }
    const d = (await sRes.json()).data;
    setPath(d.path);
    setCourses(d.courses);
    if (cRes.ok) setLibrary((await cRes.json()).data.courses);
    setLoading(false);
  }

  // Inlined rather than calling load() directly — an effect body that
  // references a named setState-calling function trips
  // react-hooks/set-state-in-effect (same fix applied throughout this
  // codebase's other authoring editors and admin panels).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch(`/api/v1/content/learning-paths/${pathId}/structure`),
          fetch("/api/v1/content/courses?status=published"),
        ]);
        if (cancelled) return;
        if (!sRes.ok) {
          setError("This learning path could not be loaded.");
          return;
        }
        const d = (await sRes.json()).data;
        setPath(d.path);
        setCourses(d.courses);
        if (cRes.ok) setLibrary((await cRes.json()).data.courses);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathId]);

  async function addCourse() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/v1/content/learning-paths/${pathId}/structure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: pick }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not add that course.");
      return;
    }
    setPick("");
    await load();
  }

  async function removeCourse(courseId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/content/learning-paths/${pathId}/structure/${courseId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not remove that course.");
      return;
    }
    await load();
  }

  async function publish() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/v1/content/learning-paths/${pathId}/publish`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not publish this learning path.");
      return;
    }
    setNotice("Learning path published. You can now assign it from Assign & Track.");
    await load();
  }

  if (loading) return <div className="studio-console__loading">Preparing this learning path…</div>;
  if (!path) return <p className="studio-console__message studio-console__message--error">{error}</p>;

  const attachedIds = new Set(courses.map((c) => c.course.id));
  const available = library.filter((c) => !attachedIds.has(c.id));
  const isDraft = path.status === "draft";

  return (
    <div className="studio-console">
      <Link href="/admin/content/learning-paths">← All learning paths</Link>
      <header className="studio-editor__heading">
        <h1>{path.title}</h1>
        <StatusPill status={path.status} />
      </header>
      {path.description && <p>{path.description}</p>}

      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}
      {notice && <p className="studio-console__message studio-console__message--success">{notice}</p>}

      <section className="studio-console__section">
        <header><div><p>02 · The journey</p><h2>Courses, in order.</h2></div><span>{courses.length} course{courses.length === 1 ? "" : "s"}</span></header>
        {courses.length === 0 ? (
          <p className="studio-console__empty">No courses yet. Add at least one published course before publishing this path.</p>
        ) : (
          <ol className="path-editor__list">
            {courses.map((c, index) => (
              <li key={c.itemId}>
                <span className="path-editor__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="path-editor__title">{c.course.title}</span>
                {isDraft && <button type="button" onClick={() => removeCourse(c.course.id)} disabled={busy} aria-label={`Remove ${c.course.title}`}>×</button>}
              </li>
            ))}
          </ol>
        )}

        {isDraft && (
          <div className="path-editor__add">
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a published course…</option>
              {available.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button type="button" onClick={addCourse} disabled={busy || !pick}>Add to path →</button>
          </div>
        )}
      </section>

      {isDraft && (
        <button type="button" onClick={publish} disabled={busy || courses.length === 0}>
          {busy ? "Publishing…" : "Publish learning path →"}
        </button>
      )}
    </div>
  );
}
