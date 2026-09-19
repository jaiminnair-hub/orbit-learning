"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SpecSummary {
  id: string;
  title: string;
  status: string;
  version: number;
  updated_at: string;
}

interface TemplateSummary {
  id: string;
  name: string;
}

export function SpecList() {
  const router = useRouter();
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [specRes, templateRes] = await Promise.all([
        fetch("/api/v1/authoring/specs"),
        fetch("/api/v1/authoring/templates"),
      ]);
      const specJson = await specRes.json();
      if (cancelled) return;
      if (!specRes.ok) {
        setError(specJson.error?.message ?? "Could not load courses.");
        setLoading(false);
        return;
      }
      setSpecs(specJson.data.specs ?? []);
      if (templateRes.ok) {
        const templateJson = await templateRes.json();
        if (!cancelled) setTemplates(templateJson.data.templates ?? []);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function create() {
    if (!title.trim()) return;
    setCreating(true);
    const res = await fetch("/api/v1/authoring/specs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), templateId: templateId || undefined }),
    });
    const json = await res.json();
    setCreating(false);
    if (!res.ok) {
      setError(json.error?.message ?? "Could not create the course.");
      return;
    }
    setTitle("");
    router.push(`/admin/authoring/${json.data.spec.id}`);
  }

  async function duplicate(id: string) {
    const res = await fetch(`/api/v1/authoring/specs/${id}/duplicate`, { method: "POST" });
    if (res.ok) reload();
  }

  if (loading) return <div className="legacy-studio-list__loading">Preparing authored courses…</div>;

  return (
    <div className="legacy-studio-list">
      <section className="legacy-studio-list__create">
        <div><p>Start a draft</p><h2>New interactive course.</h2><span>Give the course a working title now. You can select a template when one fits the learning objective.</span></div>
        <div>
          <input
            placeholder="Course title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {templates.length > 0 && (
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Blank course</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  From: {t.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={create} disabled={creating || !title.trim()}>
            {creating ? "Creating…" : "Create course →"}
          </button>
        </div>
      </section>

      {error && <p className="legacy-studio-list__error">{error}</p>}

      {specs.length === 0 ? (
        <p className="legacy-studio-list__empty">No authored courses yet. Create one above.</p>
      ) : (
        <section className="legacy-studio-list__table-card"><header><div><p>Your drafts</p><h2>Interactive courses</h2></div><span>{specs.length} courses</span></header><div className="legacy-studio-list__table-wrap"><table>
          <thead>
            <tr>
              <th>Title</th><th>Status</th><th>Version</th><th>Updated</th><th />
            </tr>
          </thead>
          <tbody>
            {specs.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/authoring/${s.id}`}>{s.title}</Link>
                </td>
                <td>{s.status}</td><td>v{s.version}</td><td>{new Date(s.updated_at).toLocaleDateString()}</td><td>
                  <button onClick={() => duplicate(s.id)}>
                    Duplicate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div></section>
      )}
    </div>
  );
}
