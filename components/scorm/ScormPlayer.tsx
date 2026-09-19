"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createScormAdapter, type ScormSnapshot } from "@/lib/scorm/adapter";
import type { ScormVersion } from "@/lib/scorm/cmi";

/**
 * Hosts a SCORM package and gives it something to talk to.
 *
 * Two pieces of ordering are load-bearing and easy to get wrong:
 *
 * 1. The API object must be on `window` *before* the iframe starts
 *    loading. Content looks for it during its own startup and gives up
 *    if it is absent — mounting the adapter in an effect that runs after
 *    the iframe would produce a course that silently tracks nothing.
 * 2. The iframe is same-origin (it is served from our own asset route),
 *    which is what lets the package walk `window.parent` and find us.
 *    A signed storage URL on another origin would break that walk.
 */

interface Props {
  packageId: string;
  scormVersion: ScormVersion;
  /** Same-origin URL of the package's entry point. */
  entryUrl: string;
  learnerId: string;
  learnerName: string;
  /** Fired once the package reports completed / passed / failed. */
  onCompleted?: (snapshot: ScormSnapshot) => void;
}

interface StoredProgress {
  cmi_data: Record<string, string> | null;
  lesson_status: string;
  score_raw: number | null;
  total_time_sec: number;
}

const SAVE_DEBOUNCE_MS = 1000;

declare global {
  interface Window {
    API?: unknown;
    API_1484_11?: unknown;
  }
}

export function ScormPlayer({
  packageId,
  scormVersion,
  entryUrl,
  learnerId,
  learnerName,
  onCompleted,
}: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("not attempted");

  const pending = useRef<ScormSnapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedFired = useRef(false);
  // Held in a ref so the unload handler always flushes the latest state
  // without re-registering the listener on every keystroke of progress.
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const url = `/api/v1/content/scorm/${packageId}/progress`;

  const flush = useCallback(
    (leaving = false) => {
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

      // Same lesson as the authored-runtime player: fetch with `keepalive`
      // was measured being dropped on unload, so a departing learner's
      // final state goes out via sendBeacon, which the browser guarantees.
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
    },
    [url]
  );

  const queueSave = useCallback(
    (snapshot: ScormSnapshot) => {
      pending.current = snapshot;
      setStatus(snapshot.lessonStatus);

      const terminal = ["completed", "passed", "failed"].includes(snapshot.lessonStatus);
      if (terminal) {
        // A completion is worth a round trip immediately — the course
        // may close the window in its very next statement.
        flush();
        if (!completedFired.current) {
          completedFired.current = true;
          onCompletedRef.current?.(snapshot);
        }
        return;
      }

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Resume state first: the adapter has to be constructed with the
      // learner's bookmark already in hand, because `cmi.core.entry` is
      // read once at startup and decides whether content replays.
      let stored: StoredProgress | null = null;
      try {
        const res = await fetch(url);
        if (res.ok) stored = (await res.json()).data.progress ?? null;
      } catch {
        // A failed resume fetch is not fatal — the learner starts over
        // rather than being locked out of content they can access.
      }
      if (cancelled) return;

      const adapter = createScormAdapter({
        version: scormVersion,
        learnerId,
        learnerName,
        initialCmi: stored?.cmi_data ?? {},
        totalTimeSec: stored?.total_time_sec ?? 0,
        onPersist: queueSave,
      });

      if (stored?.lesson_status) setStatus(stored.lesson_status);
      if (["completed", "passed", "failed"].includes(stored?.lesson_status ?? "")) {
        completedFired.current = true;
      }

      // Both names are published regardless of version. Some packages
      // probe for the other one before settling, and an unexpected
      // `undefined` during that probe is a common source of silent
      // failure in the wild.
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
  }, [packageId, scormVersion, learnerId, learnerName, url, queueSave, flush]);

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  if (error) {
    return <p style={{ color: "#b23a3a" }}>{error}</p>;
  }

  return (
    <div>
      {!ready ? (
        <p>Preparing the course…</p>
      ) : (
        <iframe
          title="SCORM content"
          src={entryUrl}
          data-testid="scorm-frame"
          onError={() => setError("The course content could not be loaded.")}
          style={{ width: "100%", height: 520, border: "1px solid #ccc", borderRadius: 6 }}
        />
      )}
      <p data-testid="scorm-status" style={{ fontSize: ".8rem", color: "#555", marginTop: 8 }}>
        Tracking: {status}
      </p>
    </div>
  );
}
