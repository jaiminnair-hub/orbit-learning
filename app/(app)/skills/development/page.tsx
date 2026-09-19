import { PageHeading, PageShell } from "@/components/shell/Shell";
import { DevelopmentClient } from "./development-client";
export default function DevelopmentPage() {
  return <PageShell maxWidth="78rem"><PageHeading title="Your development" description="Connect released feedback to an approved learning plan. You control whether your feedback is used."/><DevelopmentClient/></PageShell>;
}
