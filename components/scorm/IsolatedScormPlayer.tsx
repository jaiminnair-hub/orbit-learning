"use client";

import { useEffect, useRef, useState } from "react";
import type { ScormSnapshot } from "@/lib/scorm/adapter";

/**
 * The isolated counterpart to ScormPlayer.tsx — see
 * docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md. Kept as a separate
 * component rather than a branch inside ScormPlayer.tsx: that component
 * is proven and tested for the same-origin path, and this one has a
 * genuinely different shape (an iframe pointed at a different origin,
 * fed by a token, listening for postMessage instead of holding the
 * adapter itself). Mixing the two would risk the working path to build
 * the new one.
 *
 * Persistence is unchanged: this still calls
 * /api/v1/content/scorm/[id]/progress directly, from this window, with
 * the caller's own session cookie — only *what triggers* that call
 * changes (a validated postMessage instead of a same-window callback).
 */

interface Props {
  packageId: string;
  token: string;
  contentOrigin: string;
  onCompleted?: (snapshot: ScormSnapshot) => void;
}

const SAVE_DEBOUNCE_MS = 1000;

interface SnapshotMessage {
  type: "scorm-snapshot";
  packageId: string;
  snapshot: ScormSnapshot;
}

function isSnapshotMessage(data: unknown): data is SnapshotMessage {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.type === "scorm-snapshot" &&
    typeof d.packageId === "string" &&
    typeof d.snapshot === "object" &&
    d.snapshot !== null
  );
}

export function IsolatedScormPlayer({ packageId, token, contentOrigin, onCompleted }: Props) {
  const [status, setStatus] = useState("not attempted");
  const pending = useRef<ScormSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedFired = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const url = `/api/v1/content/scorm/${packageId}/progress`;

  useEffect(() => {
    const flush = (leaving = false) => {
      const snapshot = pending.current;
      if (!snapshot) return;
      pending.current = null;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }

      const body = JSON.stringify({
        cmiData: snapshot.cmiData,
        lessonStatus: snapshot.lessonStatus,
        scoreRaw: snapshot.scoreRaw,
        totalTimeSec: snapshot.totalTimeSec,
      });

      if (leaving && typeof navigator?.sendBeacon === "function") {
        const queued = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        if (queued) return;
      }
      void fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: leaving,
      }).catch(() => {});
    };

    // Origins never carry a trailing slash by spec, but the configured
    // NEXT_PUBLIC_SCORM_CONTENT_ORIGIN value is free-form dashboard input
    // — stripping one defensively costs nothing and closes off an entire
    // class of "postMessage silently never matches" bug.
    const normalizedContentOrigin = contentOrigin.replace(/\/+$/, "");

    const onMessage = (event: MessageEvent) => {
      // The one check this whole boundary depends on: only the content
      // origin this player itself was told to use, nothing else.
      if (event.origin !== normalizedContentOrigin) return;
      if (!isSnapshotMessage(event.data)) return;
      if (event.data.packageId !== packageId) return;

      const snapshot = event.data.snapshot;
      pending.current = snapshot;
      setStatus(snapshot.lessonStatus);

      const terminal = ["completed", "passed", "failed"].includes(snapshot.lessonStatus);
      if (terminal) {
        flush();
        if (!completedFired.current) {
          completedFired.current = true;
          onCompletedRef.current?.(snapshot);
        }
        return;
      }

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), SAVE_DEBOUNCE_MS);
    };

    window.addEventListener("message", onMessage);
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [packageId, contentOrigin, url]);

  const bridgeUrl = `${contentOrigin}/bridge/${packageId}?token=${encodeURIComponent(token)}`;

  return (
    <div>
      <iframe
        title="SCORM content"
        src={bridgeUrl}
        data-testid="scorm-frame"
        // allow-same-origin is required, not optional, despite this
        // already being a genuinely different origin: per the HTML
        // sandboxing spec, omitting it here would force the bridge
        // *document itself* into a unique opaque origin — and its own
        // nested content iframe (which does keep allow-same-origin,
        // see bridge-client.tsx) would then fail same-origin policy
        // against it, breaking the exact window.parent walk this whole
        // design depends on. What omitting allow-top-navigation and
        // allow-modals below still buys: the content can't redirect or
        // replace the real app tab, and can't raise a native-looking
        // dialog — the phishing surface, not the isolation itself.
        sandbox="allow-scripts allow-same-origin allow-forms"
        style={{ width: "100%", height: 520, border: "1px solid #ccc", borderRadius: 6 }}
      />
      <p data-testid="scorm-status" style={{ fontSize: ".8rem", color: "#555", marginTop: 8 }}>
        Tracking: {status}
      </p>
    </div>
  );
}
