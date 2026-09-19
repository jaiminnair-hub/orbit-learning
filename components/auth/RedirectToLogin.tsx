"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// The protected route-group layout can't know the request path server-side
// without Proxy (ruled out for this app's Cloudflare Workers deployment --
// see app/(app)/layout.tsx), so an unauthenticated visit renders this
// instead of calling redirect("/login") directly. It carries the path the
// visitor was actually headed to, so the login screen can show relevant
// copy (e.g. Platform Control) instead of generic Learning copy.
export function RedirectToLogin() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [router, pathname]);

  return null;
}
