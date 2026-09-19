"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface TranscriptRow {
  kind: "course" | "assessment" | "learning_path" | "certificate";
  id: string;
  title: string;
  status: string;
  percent: number | null;
  score: number | null;
  dueDate: string | null;
  completedAt: string | null;
  issuedAt: string | null;
  overdue: boolean;
  href: string;
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function TranscriptClient() {
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [summary, setSummary] = useState({ total: 0, completed: 0, overdue: 0, certificates: 0 });
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [score, setScore] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    if (score) params.set("minScore", score);
    return params.toString();
  }, [kind, score, status]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/transcript${query ? `?${query}` : ""}`)
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message ?? "Could not load your transcript.");
        if (!cancelled) {
          setRows(json.data.rows ?? []);
          setSummary(json.data.summary);
        }
      })
      .catch((caught) => !cancelled && setError(caught instanceof Error ? caught.message : "Could not load your transcript."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [query]);

  return <>
    <section className="grid gap-px border border-border bg-border sm:grid-cols-4" aria-label="Transcript summary">
      {[["Assigned", summary.total], ["Completed", summary.completed], ["Overdue", summary.overdue], ["Certificates", summary.certificates]].map(([name, value]) =>
        <div className="bg-card p-4" key={name}><span className="text-xs uppercase tracking-widest text-muted-foreground">{name}</span><strong className="mt-2 block text-3xl">{value}</strong></div>
      )}
    </section>

    <section className="mt-6 border border-border bg-card p-4" aria-label="Transcript filters">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm"><span>Type</span><select className="border border-input bg-background p-2" value={kind} onChange={(event) => { setLoading(true); setError(null); setKind(event.target.value); }}><option value="">All learning</option><option value="course">Courses</option><option value="learning_path">Learning paths</option><option value="assessment">Assessments</option><option value="certificate">Certificates</option></select></label>
        <label className="grid gap-1 text-sm"><span>Completion</span><select className="border border-input bg-background p-2" value={status} onChange={(event) => { setLoading(true); setError(null); setStatus(event.target.value); }}><option value="">All statuses</option><option value="complete">Complete</option><option value="incomplete">Incomplete</option><option value="overdue">Overdue</option></select></label>
        <label className="grid gap-1 text-sm"><span>Minimum score</span><select className="border border-input bg-background p-2" value={score} onChange={(event) => { setLoading(true); setError(null); setScore(event.target.value); }}><option value="">Any score</option><option value="50">50%+</option><option value="70">70%+</option><option value="80">80%+</option><option value="90">90%+</option></select></label>
      </div>
    </section>

    <div className="mt-6" aria-live="polite" aria-busy={loading}>
      {loading && <p className="text-sm text-muted-foreground">Loading your learning record…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && rows.length === 0 && <section className="border border-border bg-card p-8 text-center"><h2 className="text-xl font-semibold">No records match these filters.</h2><p className="mt-2 text-sm text-muted-foreground">Clear a filter to see more of your learning history.</p></section>}
      {!loading && rows.length > 0 && <div className="grid gap-2">
        {rows.map((row) => <Link className="grid gap-3 border border-border bg-card p-4 transition hover:border-accent sm:grid-cols-[minmax(0,1.7fr)_repeat(4,minmax(6rem,.7fr))] sm:items-center" href={row.href} key={`${row.kind}-${row.id}`}>
          <span><small className="block text-xs uppercase tracking-widest text-accent">{label(row.kind)}</small><strong className="mt-1 block">{row.title}</strong></span>
          <span className="text-sm"><small className="block text-muted-foreground">Status</small>{row.overdue ? "Overdue" : label(row.status)}</span>
          <span className="text-sm"><small className="block text-muted-foreground">Progress</small>{row.percent == null ? "—" : `${row.percent}%`}</span>
          <span className="text-sm"><small className="block text-muted-foreground">Score</small>{row.score == null ? "—" : `${row.score}%`}</span>
          <span className="text-sm"><small className="block text-muted-foreground">Due / completed</small>{date(row.completedAt ?? row.issuedAt ?? row.dueDate)}</span>
        </Link>)}
      </div>}
    </div>
  </>;
}
