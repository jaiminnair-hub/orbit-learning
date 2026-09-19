import Link from "next/link";
import { SpecEditor } from "@/components/authoring/spec-editor";

export default async function AuthoringEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1400 }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/admin/authoring">← All courses</Link>
      </p>
      <SpecEditor specId={id} />
    </main>
  );
}
