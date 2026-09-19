"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StatusPill } from "../ui";

interface LearningPath {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  version: number;
  created_at: string;
}

export function LearningPathsConsole() {
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/content/learning-paths");
      if (cancelled) return;
      if (res.ok) setPaths((await res.json()).data.learningPaths);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    const res = await fetch("/api/v1/content/learning-paths");
    if (res.ok) setPaths((await res.json()).data.learningPaths);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/content/learning-paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not create the learning path.");
      return;
    }
    setTitle("");
    setDescription("");
    await reload();
  }

  if (loading) return <div className="studio-console__loading">Preparing your learning paths…</div>;

  return (
    <div className="studio-console">
      <p><Link href="/admin/content/courses">← Curriculum</Link></p>

      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}

      <section className="studio-console__action-card">
        <div><p>01 · Sequence a journey</p><h2>Create a learning path.</h2><span>A path is an ordered sequence of published courses a learner works through as one assignment. Add courses to it inside the path editor.</span></div>
        <form onSubmit={create}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
          <button type="submit" disabled={busy || !title.trim()}>{busy ? "Creating…" : "Open path editor →"}</button>
        </form>
      </section>

      <section className="studio-console__section">
        <header><div><p>Published and in progress</p><h2>Learning paths</h2></div><span>{paths.length} paths</span></header>
        {paths.length === 0 ? (
          <p className="studio-console__empty">No learning paths yet. Create one to sequence several courses into a single assignment.</p>
        ) : (
          <div className="studio-console__table-wrap"><table className="studio-console__table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Title</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Version</th>
              </tr>
            </thead>
            <tbody>
              {paths.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/admin/content/learning-paths/${p.id}`}>{p.title}</Link></td>
                  <td><StatusPill status={p.status} /></td>
                  <td>v{p.version}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
