import { CapabilityHero } from "@/components/three/capability-hero";
import { SiteHeader } from "@/components/site/site-header";

// The public landing page: the brain hero (an active neural network that
// organises across the six-stage capability journey shown in the left
// stepper). Platform/Engine map is the planned next section (not built yet).
// No authenticated LMS surface is affected.
//
// force-dynamic: see app/orbit/complete/page.tsx — static prerendering
// leaves this page's hydration scripts without a nonce matching proxy.ts's
// per-request CSP, silently disabling any client-side JS on the page.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main style={{ background: "var(--color-bg)" }}>
      <SiteHeader />
      <CapabilityHero />
    </main>
  );
}
