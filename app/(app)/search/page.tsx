import { Suspense } from "react";
import { PageHeading, PageShell } from "@/components/shell/Shell";
import { SearchClient } from "./search-client";

export default function SearchPage() {
  return <PageShell maxWidth="64rem">
    <PageHeading title="Search your learning" description="Published learning and your own assigned or earned records—never another organisation's content." />
    <Suspense fallback={<p className="text-sm text-muted-foreground">Preparing search…</p>}><SearchClient /></Suspense>
  </PageShell>;
}
