import { redirect } from "next/navigation";
import { getPlatformAccess } from "@/lib/auth/platform";
import { PlatformConsole } from "./platform-console";

// A deliberate separate control plane. It is not nested inside /admin,
// because organization administration must never imply cross-tenant access.
export default async function PlatformPage() {
  const access = await getPlatformAccess();
  if (!access) redirect("/dashboard");

  return <PlatformConsole platformRole={access.role} />;
}
