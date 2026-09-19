"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  externalRef: string | null;
  state: "completed_learning" | "in_progress" | "not_started";
  evidence: Array<{ kind: "course" | "assessment"; id: string; title: string; status: string; score: number | null; href: string }>;
  recommendations: Array<{ id: string; title: string; status: "continue" | "available"; href: string }>;
}

const STATE_LABEL = { completed_learning: "Learning completed", in_progress: "In progress", not_started: "Not started" };

export function SkillsClient() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [summary, setSummary] = useState({ total: 0, completedLearning: 0, inProgress: 0, recommendations: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/skills")
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message ?? "Could not load your skills.");
        if (!cancelled) { setSkills(json.data.skills ?? []); setSummary(json.data.summary); }
      })
      .catch((caught) => !cancelled && setError(caught instanceof Error ? caught.message : "Could not load your skills."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return <>
    <section className="grid gap-px border border-border bg-border sm:grid-cols-4" aria-label="Skills summary">
      {[["Skills mapped", summary.total], ["Learning completed", summary.completedLearning], ["In progress", summary.inProgress], ["Next options", summary.recommendations]].map(([label, value]) =>
        <div className="bg-card p-4" key={label}><span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span><strong className="mt-2 block text-3xl">{value}</strong></div>
      )}
    </section>
    <p className="mt-4 border-l-2 border-accent bg-muted p-3 text-sm text-muted-foreground">This is learning evidence, not a proficiency score. Orbit will only show a competency gap here after an authorised assessment supplies one.</p>
    <div className="mt-6" aria-live="polite" aria-busy={loading}>
      {loading && <p className="text-sm text-muted-foreground">Mapping your learning to skills…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && skills.length === 0 && <section className="border border-border bg-card p-8"><h2 className="text-xl font-semibold">No skills are mapped yet.</h2><p className="mt-2 text-sm text-muted-foreground">Your learning administrator can add skill tags and map them to published authored courses or assessment questions.</p></section>}
      {!loading && skills.length > 0 && <div className="grid gap-3 lg:grid-cols-2">
        {skills.map((skill) => <article className="border border-border bg-card p-5" key={skill.id}>
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-accent">{STATE_LABEL[skill.state]}</p><h2 className="mt-1 text-xl font-semibold">{skill.name}</h2></div>{skill.externalRef && <code className="text-xs text-muted-foreground">{skill.externalRef}</code>}</div>
          {skill.description && <p className="mt-2 text-sm text-muted-foreground">{skill.description}</p>}
          {skill.evidence.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Your evidence</h3><ul className="mt-2 grid gap-1 text-sm">{skill.evidence.map((item) => <li key={`${item.kind}-${item.id}`}><Link className="text-accent underline-offset-4 hover:underline" href={item.href}>{item.title}</Link> · {item.status.replaceAll("_", " ")}{item.score == null ? "" : ` · ${item.score}%`}</li>)}</ul></div>}
          {skill.recommendations.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Recommended next learning</h3><ul className="mt-2 grid gap-2">{skill.recommendations.slice(0, 3).map((item) => <li key={item.id}><Link className="flex justify-between border border-border p-2 text-sm hover:border-accent" href={item.href}><span>{item.title}</span><b>{item.status === "continue" ? "Continue →" : "View →"}</b></Link></li>)}</ul></div>}
        </article>)}
      </div>}
    </div>
  </>;
}
