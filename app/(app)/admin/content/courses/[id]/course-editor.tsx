"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusPill, WorkflowBar, VersionHistory } from "../../ui";

interface Course {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  version: number;
  published_at: string | null;
}
interface AttachedObject {
  id: string;
  title: string;
  kind: string;
  status: string;
  sequence: number;
}
interface Lesson {
  id: string;
  title: string;
  sequence: number;
  learningObjects: AttachedObject[];
}
interface ModuleNode {
  id: string;
  title: string;
  sequence: number;
  lessons: Lesson[];
}
interface LibraryObject {
  id: string;
  title: string;
  kind: string;
  status: string;
}

export function CourseEditor({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<ModuleNode[]>([]);
  const [library, setLibrary] = useState<LibraryObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [moduleTitle, setModuleTitle] = useState("");
  const [lessonTitles, setLessonTitles] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [sRes, lRes] = await Promise.all([
      fetch(`/api/v1/content/courses/${courseId}/structure`),
      fetch("/api/v1/content/learning-objects"),
    ]);
    if (!sRes.ok) {
      setError("This course could not be loaded.");
      setLoading(false);
      return;
    }
    const d = (await sRes.json()).data;
    setCourse(d.course);
    setModules(d.modules);
    setTitle(d.course.title);
    setDescription(d.course.description ?? "");
    if (lRes.ok) setLibrary((await lRes.json()).data.learningObjects);
    setLoading(false);
  }, [courseId]);

  // Inlined for the same reason as the learning-object editor: the
  // react-hooks rule traces setState through a called function, so the
  // initial fetch lives here and load() serves imperative refreshes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // try/finally so any parsing failure can't strand the page on
      // "Loading…" forever — which is exactly what happened before.
      try {
        const [sRes, lRes] = await Promise.all([
          fetch(`/api/v1/content/courses/${courseId}/structure`),
          fetch("/api/v1/content/learning-objects"),
        ]);
        if (cancelled) return;
        if (!sRes.ok) {
          setError("This course could not be loaded.");
          return;
        }
        const d = (await sRes.json()).data;
        if (cancelled) return;
        setCourse(d.course);
        setModules(d.modules);
        setTitle(d.course.title);
        setDescription(d.course.description ?? "");
        if (lRes.ok) {
          const lib = await lRes.json();
          if (!cancelled) setLibrary(lib.data.learningObjects);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load this course.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  async function post(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/v1/content/courses/${courseId}/structure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "That didn't work.");
      return false;
    }
    await load();
    return true;
  }

  async function saveDetails() {
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/v1/content/courses/${courseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null }),
    });
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not save.");
      return;
    }
    setSaved(true);
    await load();
  }

  if (loading) return <div className="studio-editor__loading">Opening course studio…</div>;
  if (!course) return <p className="studio-console__message studio-console__message--error">{error ?? "Not found."}</p>;

  return (
    <div className="studio-editor">
      <p className="studio-editor__back">
        <Link href="/admin/content/courses">← All courses</Link>
      </p>

      <header className="studio-editor__heading">
        <div><p>Course studio</p><h1>{course.title}</h1><span>Shape the sequence, then preview exactly what learners will experience.</span></div>
        <div className="studio-editor__meta">
        <StatusPill status={course.status} />
        <span>v{course.version}</span>
        {/* Preview opens the same player a learner uses. It works for
            drafts too, which is the point — you can see exactly what
            you're about to publish. */}
        <Link href={`/courses/${courseId}`} target="_blank">Preview as learner ↗</Link>
        </div>
      </header>

      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}

      <WorkflowBar
        status={course.status}
        publishUrl={`/api/v1/content/courses/${courseId}/publish`}
        onChanged={() => {
          void load();
          setRefreshKey((k) => k + 1);
        }}
      />

      <section className="studio-editor__section">
        <header><p>01 · Framing</p><h2>Course details</h2></header>
        <div className="studio-editor__details">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <div>
            <button onClick={saveDetails}>Save details</button>
            {saved && <span className="studio-editor__saved">Saved</span>}
          </div>
        </div>
      </section>

      <section className="studio-editor__section">
        <header><p>02 · Learning flow</p><h2>Course structure</h2></header>

        {modules.length === 0 && (
          <p className="studio-editor__empty">
            No modules yet. A course needs at least one module, containing at least one lesson, with
            at least one learning object in it.
          </p>
        )}

        {modules.map((m) => (
          <div key={m.id} className="studio-editor__module">
            <h3>{m.title} <span>module</span>
            </h3>

            {m.lessons.map((l) => (
              <div key={l.id} className="studio-editor__lesson">
                <div>{l.title}</div>

                {l.learningObjects.length === 0 ? (
                  <p>No content in this lesson yet.</p>
                ) : (
                  <ul>
                    {l.learningObjects.map((lo) => (
                      <li key={lo.id}>
                        <Link href={`/admin/content/learning-objects/${lo.id}`}>{lo.title}</Link>{" "}
                        <StatusPill status={lo.status} />
                      </li>
                    ))}
                  </ul>
                )}

                {/* Reuse: this picker lists every learning object in the
                    org, so the same one can be added to as many lessons
                    as you like — no copying. */}
                <div className="studio-editor__attach">
                  <select
                    value={picks[l.id] ?? ""}
                    onChange={(e) => setPicks({ ...picks, [l.id]: e.target.value })}
                  >
                    <option value="">Add an existing learning object…</option>
                    {library.map((o) => (
                      <option key={o.id} value={o.id}>
                        [{o.kind}] {o.title}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!picks[l.id]}
                    onClick={async () => {
                      const ok = await post({
                        kind: "attach",
                        lessonId: l.id,
                        learningObjectId: picks[l.id],
                        sequence: l.learningObjects.length,
                      });
                      if (ok) setPicks({ ...picks, [l.id]: "" });
                    }}
                  >
                    Add to lesson
                  </button>
                  {/* Content & AI authors learning objects — this lesson's
                      own picker above is how one gets attached once it
                      exists, so the path there starts from here rather than
                      a separate, independently-discovered top-level tab. */}
                  <Link href="/admin/authoring" target="_blank" className="studio-editor__author-link">
                    or author new content →
                  </Link>
                </div>
              </div>
            ))}

            <div className="studio-editor__lesson-new">
              <input
                placeholder="New lesson title"
                value={lessonTitles[m.id] ?? ""}
                onChange={(e) => setLessonTitles({ ...lessonTitles, [m.id]: e.target.value })}
              />
              <button
                disabled={!(lessonTitles[m.id] ?? "").trim()}
                onClick={async () => {
                  const ok = await post({
                    kind: "lesson",
                    moduleId: m.id,
                    title: lessonTitles[m.id],
                    sequence: m.lessons.length,
                  });
                  if (ok) setLessonTitles({ ...lessonTitles, [m.id]: "" });
                }}
              >
                Add lesson
              </button>
            </div>
          </div>
        ))}

        <div className="studio-editor__module-new">
          <input
            placeholder="New module title"
            value={moduleTitle}
            onChange={(e) => setModuleTitle(e.target.value)}
          />
          <button
            disabled={!moduleTitle.trim()}
            onClick={async () => {
              const ok = await post({ kind: "module", title: moduleTitle, sequence: modules.length });
              if (ok) setModuleTitle("");
            }}
          >
            Add module
          </button>
        </div>
      </section>

      <VersionHistory entityType="course" entityId={courseId} refreshKey={refreshKey} />
    </div>
  );
}
