"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StatusPill } from "../ui";

interface LearningObject {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  version: number;
}

const KINDS = ["content", "knowledge_check", "assignment", "scenario"];

export function ObjectsConsole() {
  const [objects, setObjects] = useState<LearningObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("content");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/content/learning-objects");
      if (cancelled) return;
      if (res.ok) setObjects((await res.json()).data.learningObjects);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    const res = await fetch("/api/v1/content/learning-objects");
    if (res.ok) setObjects((await res.json()).data.learningObjects);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/content/learning-objects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error?.message ?? "Could not create.");
      return;
    }
    setTitle("");
    await reload();
  }

  if (loading) return <div className="studio-console__loading">Preparing your learning objects…</div>;

  return (
    <div className="studio-console">
      {error && <p className="studio-console__message studio-console__message--error">{error}</p>}

      <section className="studio-console__action-card">
        <div><p>01 · Reusable building block</p><h2>Create a learning object.</h2><span>Use a clear title and choose the object type. You can add its learning material and reuse it across multiple courses afterwards.</span></div>
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
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !title.trim()}>{busy ? "Creating…" : "Create object →"}</button>
        </form>
      </section>

      <section className="studio-console__section">
        <header><div><p>Reusable library</p><h2>Learning objects</h2></div><span>{objects.length} objects</span></header>
        {objects.length === 0 ? (
          <p className="studio-console__empty">No learning objects yet. Start with material from the library, then use it across one or many courses.</p>
        ) : (
          <div className="studio-console__table-wrap"><table className="studio-console__table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Title</th>
                <th style={{ textAlign: "left" }}>Kind</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Version</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/content/learning-objects/${o.id}`}>{o.title}</Link>
                  </td>
                  <td>{o.kind}</td>
                  <td>
                    <StatusPill status={o.status} />
                  </td>
                  <td>v{o.version}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
