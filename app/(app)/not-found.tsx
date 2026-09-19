import Link from "next/link";
import { PageShell, PageHeading, Card } from "@/components/shell/Shell";

export default function AppNotFound() {
  return (
    <PageShell>
      <PageHeading title="We couldn't find that page" description="It may have moved, been removed, or the link may be out of date." />
      <Card>
        <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">
          ← Back to My learning
        </Link>
      </Card>
    </PageShell>
  );
}
