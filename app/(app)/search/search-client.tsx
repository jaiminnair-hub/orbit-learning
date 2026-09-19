"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface SearchResult {
  kind: "course" | "learning_path" | "assessment" | "certificate" | "course_page";
  id: string;
  title: string;
  description: string | null;
  context: string | null;
  href: string;
}

function kindLabel(kind: SearchResult["kind"]) {
  return { course: "Course", learning_path: "Learning path", assessment: "Assessment", certificate: "Certificate", course_page: "Course page" }[kind];
}

export function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeQuery = (searchParams.get("q") ?? "").trim();
  const [query, setQuery] = useState(activeQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeQuery.length < 2) return;
    let cancelled = false;
    fetch(`/api/v1/search?q=${encodeURIComponent(activeQuery)}`)
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message ?? "Search could not be completed.");
        if (!cancelled) setResults(json.data.results ?? []);
      })
      .catch((caught) => !cancelled && setError(caught instanceof Error ? caught.message : "Search could not be completed."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [activeQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = query.trim();
    if (clean.length >= 2) {
      setLoading(true);
      setError(null);
      setResults([]);
      router.push(`/search?q=${encodeURIComponent(clean)}`);
    }
  }

  return <>
    <form className="flex flex-col gap-2 border border-border bg-card p-4 sm:flex-row" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="workspace-search">Search your learning workspace</label>
      <input autoFocus className="min-w-0 flex-1 border border-input bg-background px-3 py-3 text-foreground" id="workspace-search" maxLength={100} minLength={2} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses, pages, paths, assessments and certificates" type="search" value={query} />
      <button className="bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50" disabled={query.trim().length < 2 || loading} type="submit">{loading ? "Searching…" : "Search"}</button>
    </form>
    <section className="mt-6" aria-live="polite" aria-busy={loading}>
      {!activeQuery && <div className="border border-border bg-card p-8"><h2 className="text-xl font-semibold">Find your next learning move.</h2><p className="mt-2 text-muted-foreground">Search everything you can access. Private records and other organisations never appear.</p></div>}
      {error && <p className="text-destructive">{error}</p>}
      {activeQuery && !loading && !error && <p className="mb-3 text-sm text-muted-foreground">{results.length} {results.length === 1 ? "result" : "results"} for “{activeQuery}”</p>}
      {!loading && activeQuery && !error && results.length === 0 && <div className="border border-border bg-card p-8"><h2 className="text-xl font-semibold">Nothing matched.</h2><p className="mt-2 text-muted-foreground">Try a course title, skill, topic or certificate name.</p></div>}
      <div className="grid gap-2">
        {activeQuery && results.map((result) => <Link className="group border border-border bg-card p-4 transition hover:border-accent" href={result.href} key={`${result.kind}-${result.id}`}>
          <small className="uppercase tracking-widest text-accent">{kindLabel(result.kind)}</small>
          <div className="mt-1 flex items-start justify-between gap-3"><h2 className="font-semibold">{result.title}</h2><span aria-hidden="true" className="group-hover:text-accent">→</span></div>
          {result.context && <p className="mt-1 text-xs text-muted-foreground">{result.context}</p>}
          {result.description && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{result.description}</p>}
        </Link>)}
      </div>
    </section>
  </>;
}
