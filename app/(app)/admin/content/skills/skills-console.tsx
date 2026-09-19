"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface SkillTag { id: string; name: string; description: string | null; external_ref: string | null }

export function SkillsConsole() {
  const [skills, setSkills] = useState<SkillTag[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const response = await fetch("/api/v1/authoring/skill-tags");
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "Could not load skills.");
    setSkills(json.data.skillTags ?? []);
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/v1/authoring/skill-tags");
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message ?? "Could not load skills.");
        if (!cancelled) setSkills(json.data.skillTags ?? []);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load skills.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const response = await fetch("/api/v1/authoring/skill-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, externalRef }) });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) { setError(json.error?.message ?? "Could not create skill."); return; }
    setName(""); setDescription(""); setExternalRef(""); await reload();
  }

  async function remove(skill: SkillTag) {
    if (!window.confirm(`Delete ${skill.name}? Existing content keeps working but loses this label.`)) return;
    const response = await fetch(`/api/v1/authoring/skill-tags/${skill.id}`, { method: "DELETE" });
    const json = await response.json();
    if (!response.ok) { setError(json.error?.message ?? "Could not delete skill."); return; }
    await reload();
  }

  return <div className="studio-console">
    <p><Link href="/admin/content/courses">← Curriculum</Link></p>
    {error && <p className="studio-console__message studio-console__message--error">{error}</p>}
    <section className="studio-console__action-card">
      <div><p>01 · Define the vocabulary</p><h2>Add a skill.</h2><span>Use an external reference when this tag corresponds to the future shared Competencies taxonomy.</span></div>
      <form onSubmit={create}>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} /></label>
        <label>External reference<input value={externalRef} onChange={(event) => setExternalRef(event.target.value)} placeholder="e.g. ESCO code" /></label>
        <button type="submit" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Add skill →"}</button>
      </form>
    </section>
    <section className="studio-console__section">
      <header><div><p>Organisation vocabulary</p><h2>Skills</h2></div><span>{skills.length} skills</span></header>
      {skills.length === 0 ? <p className="studio-console__empty">No skills yet. Add the first skill above.</p> : <div className="studio-console__table-wrap"><table className="studio-console__table"><thead><tr><th style={{ textAlign: "left" }}>Skill</th><th style={{ textAlign: "left" }}>External reference</th><th /></tr></thead><tbody>{skills.map((skill) => <tr key={skill.id}><td><b>{skill.name}</b>{skill.description && <small style={{ display: "block" }}>{skill.description}</small>}</td><td>{skill.external_ref ?? "—"}</td><td><button type="button" onClick={() => remove(skill)}>Delete</button></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
