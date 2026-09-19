import { PageHeading, PageShell } from "@/components/shell/Shell";
import { TranscriptClient } from "./transcript-client";

export default function TranscriptPage() {
  return <PageShell maxWidth="78rem">
    <PageHeading title="Your learning transcript" description="Courses, learning paths, assessments, scores and certificates in one private record." />
    <TranscriptClient />
  </PageShell>;
}
