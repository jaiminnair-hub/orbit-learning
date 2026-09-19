import { PageHeading, PageShell } from "@/components/shell/Shell";
import { SkillsClient } from "./skills-client";
import Link from "next/link";

export default function SkillsPage() {
  return <PageShell maxWidth="78rem">
    <PageHeading title="Skills in your learning" description="See which skills your assigned learning covers and what published learning can help you continue." />
    <Link href="/skills/development" className="mb-5 inline-block rounded-md border border-border px-4 py-2 text-sm">My competency development →</Link>
    <SkillsClient />
  </PageShell>;
}
