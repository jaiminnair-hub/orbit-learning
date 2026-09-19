import Link from "next/link";
import { SpecList } from "./spec-list";
import { AiGeneratePanel } from "@/components/authoring/ai-generate-panel";

export default function AuthoringPage() {
  return (
    <main className="legacy-studio-page">
      <p className="legacy-studio-page__back">
        <Link href="/admin">← Admin</Link>
      </p>
      <header className="legacy-studio-page__heading"><p>Interactive authoring</p><h1>Build learning that feels alive.</h1><span>Create block-based courses, start from an approved template, and preview the exact learner experience before release.</span></header>
      <AiGeneratePanel />
      <SpecList />
    </main>
  );
}
