"use client";

import { useEffect, useRef, useState } from "react";
import { createScormAdapter, type ScormSnapshot } from "@/lib/adapter";
import type { ScormVersion } from "@/lib/cmi";

declare global {
  interface Window {
    API?: unknown;
    API_1484_11?: unknown;
  }
}

/**
 * Runs entirely on content-origin. See
 * docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md — this is where
 * lib/scorm/adapter.ts (copied, see ../../../lib/adapter.ts) actually
 * executes now, instead of on the app's own window as it did before
 * this isolation work. The SCORM content below is loaded in a nested
 * iframe that shares *this* origin, which is what lets its own
 * window.parent walk find the adapter mounted here.
 */
export function BridgeClient({
  packageId,
  token,
  learnerId,
  learnerName,
  scormVersion,
  entryPoint,
  appOrigin,
}: {
  packageId: string;
  token: string;
  learnerId: string;
  learnerName: string;
  scormVersion: ScormVersion;
  entryPoint: string;
  appOrigin: string;
}) {
  const [ready, setReady] = useState(false);
  const pending = useRef<ScormSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postSnapshot = (snapshot: ScormSnapshot) => {
    // The one message type, one direction, one payload shape this
    // boundary carries — see the architecture doc's "minimal, audited"
    // section. `appOrigin` as the explicit target origin means this
    // silently fails rather than leaking anywhere else if it's ever
    // misconfigured.
    window.parent.postMessage({ type: "scorm-snapshot", packageId, snapshot }, appOrigin);
  };

  const flush = (leaving = false) => {
    const snapshot = pending.current;
    if (!snapshot) return;
    pending.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    postSnapshot(snapshot);
    if (leaving) {
      // A learner closing this tab can't wait for the parent's own
      // network round trip; sendBeacon-equivalent isn't available for
      // cross-window messaging, but postMessage is synchronous enough
      // to reliably queue before unload where a fetch would not be.
      void 0;
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let initial: { cmi_data: Record<string, string> | null; total_time_sec: number } | null = null;
      try {
        // Same-origin proxy, not the app origin directly — see
        // app/bridge/[packageId]/resume-state/route.ts for why: that
        // main-app endpoint is server-to-server only and has no CORS
        // headers, deliberately, since serving them would mean shipping
        // CONTENT_BRIDGE_SECRET to this browser-side code.
        const res = await fetch(`/bridge/${packageId}/resume-state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) initial = (await res.json()).data.progress;
      } catch {
        // A failed resume fetch starts the learner over rather than
        // blocking them out of content they're otherwise authorized for.
      }
      if (cancelled) return;

      const adapter = createScormAdapter({
        version: scormVersion,
        learnerId,
        learnerName,
        initialCmi: initial?.cmi_data ?? {},
        totalTimeSec: initial?.total_time_sec ?? 0,
        onPersist: (snapshot) => {
          pending.current = snapshot;
          const terminal = ["completed", "passed", "failed"].includes(snapshot.lessonStatus);
          if (terminal) {
            flush();
            return;
          }
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(), 1000);
        },
      });

      if (scormVersion === "1.2") window.API = adapter.api;
      else window.API_1484_11 = adapter.api;

      setReady(true);
    })();

    return () => {
      cancelled = true;
      flush(true);
      delete window.API;
      delete window.API_1484_11;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId, token]);

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  });

  const entryUrl = `/bridge/${packageId}/assets/${encodeURIComponent(token)}/${entryPoint}`;

  return ready ? (
    <iframe
      title="SCORM content"
      src={entryUrl}
      sandbox="allow-scripts allow-same-origin allow-forms"
      style={{ width: "100vw", height: "100vh", border: "none", display: "block" }}
    />
  ) : null;
}
