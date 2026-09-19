"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hosts an ingested xAPI/Tin Can package. Structurally simpler than
 * ScormPlayer: there is no CMI API to mount on `window` and no
 * postMessage bridge to run — a Tin Can package talks to the LRS
 * directly over HTTP, using the endpoint/auth/actor/registration it reads
 * off its own launch URL's query string
 * (app/api/v1/content/xapi/[id]/launch/route.ts).
 *
 * That's also why the iframe sandbox here is *more* restrictive than
 * SCORM's: `allow-same-origin` is deliberately omitted. SCORM content
 * needs it to walk `window.parent` and find the adapter; xAPI content
 * never does, so dropping it forces a unique opaque origin regardless of
 * where the bytes were served from — full isolation from the app's
 * cookies and DOM with no separate content-origin deployment required.
 * See docs/XAPI_INGEST_ARCHITECTURE.md.
 *
 * Completion isn't observed via any in-page signal (there is none to
 * trust from a sandboxed opaque-origin frame) — it's polled from
 * xapi_progress, which app/api/v1/xapi-lrs/statements/route.ts updates
 * server-side the moment the package's own JS posts a completed/passed/
 * failed statement.
 */

interface Props {
  packageId: string;
  /** Fired once the package's own LRS traffic reports completion. */
  onCompleted?: (result: { scoreRaw: number | null }) => void;
}

interface LaunchInfo {
  launchUrl: string;
}

const POLL_MS = 5000;

export function XapiPlayer({ packageId, onCompleted }: Props) {
  const [launch, setLaunch] = useState<LaunchInfo | null>(null);
  const [status, setStatus] = useState<string>("not attempted");
  const [error, setError] = useState<string | null>(null);
  const completedFired = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/content/xapi/${packageId}/launch`);
      const json = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !json?.data?.launchUrl) {
        setError(json?.error?.message ?? "Could not launch this package.");
        return;
      }
      setLaunch({ launchUrl: json.data.launchUrl });
    })();
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  useEffect(() => {
    if (!launch) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/content/xapi/${packageId}/progress`);
        if (!res.ok) return;
        const { data } = await res.json();
        const progress = data?.progress;
        if (!progress || cancelled) return;
        setStatus(progress.lesson_status);
        const terminal = ["completed", "passed", "failed"].includes(progress.lesson_status);
        if (terminal && !completedFired.current) {
          completedFired.current = true;
          onCompletedRef.current?.({ scoreRaw: progress.score_raw ?? null });
        }
      } catch {
        // A missed poll just tries again next tick — not fatal.
      }
    };

    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [launch, packageId]);

  if (error) {
    return <p style={{ color: "#b23a3a" }}>{error}</p>;
  }

  return (
    <div>
      {!launch ? (
        <p>Preparing the course…</p>
      ) : (
        <iframe
          title="xAPI content"
          src={launch.launchUrl}
          data-testid="xapi-frame"
          sandbox="allow-scripts allow-forms allow-popups"
          onError={() => setError("The course content could not be loaded.")}
          style={{ width: "100%", height: 520, border: "1px solid #ccc", borderRadius: 6 }}
        />
      )}
      <p data-testid="xapi-status" style={{ fontSize: ".8rem", color: "#555", marginTop: 8 }}>
        Tracking: {status}
      </p>
    </div>
  );
}
