"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * "Generate with AI" — AI Course Builder Lite's entry point inside the
 * existing authoring area (app/(app)/admin/authoring/page.tsx), not a new
 * product shell. Pastes source text in, polls the resulting authoring_jobs
 * row, and hands the author into the existing spec editor on success —
 * mirroring the manual "Start a draft" panel it sits beside.
 */

type Status = "checking" | "unconfigured" | "idle" | "submitting" | "generating" | "stalled" | "error";
type BuilderMode = "lite" | "full";
type FullSourceMode = "text" | "url" | "asset";

interface JobRow {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  output: { specId?: string } | null;
  error: string | null;
  steps: Array<{ name?: string; kind?: string; status: string }>;
}

const STEP_LABELS: Record<string, string> = {
  outline: "Drafting the course outline",
  objectives: "Writing learning objectives",
  page_blocks: "Writing the first lesson",
  validate: "Checking the result",
  save: "Saving your draft",
  page: "Writing a lesson",
  items: "Creating a knowledge check",
  skill_tags: "Tagging course skills",
  assemble: "Validating and saving your draft",
};

const POLL_INTERVAL_MS = 2000;
// A healthy step normally lands within ~10-15s (lib/ai/full-course-builder.ts's
// own TIME_BUDGET_PER_INVOCATION_MS chains a fresh invocation before that).
// 60s gives real headroom above a legitimately slow single step before
// treating it as the documented "dropped continuation" stall — a real,
// reproduced-in-production failure mode where a full-course job goes
// permanently silent mid-generation with no error on the job row, because
// nothing before this watched for the *absence* of progress.
const STALL_THRESHOLD_MS = 60_000;

export function AiGeneratePanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeJobId = searchParams.get("resumeFullJob");
  const [status, setStatus] = useState<Status>("checking");
  const [sourceText, setSourceText] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [mode, setMode] = useState<BuilderMode>("lite");
  const [fullSourceMode, setFullSourceMode] = useState<FullSourceMode>("text");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [assets, setAssets] = useState<Array<{ id: string; type: string; storage_path: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [stalledJobId, setStalledJobId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/v1/authoring/ai/status");
      if (cancelled) return;
      if (!res.ok) {
        setStatus("error");
        setError("Could not check whether AI generation is available.");
        return;
      }
      const json = await res.json();
      setStatus(json.data?.configured ? "idle" : "unconfigured");
      const assetsRes = await fetch("/api/v1/content/assets").catch(() => null);
      if (assetsRes?.ok) {
        const assetsJson = await assetsRes.json();
        if (!cancelled) setAssets(assetsJson.data?.assets ?? []);
      }
    })();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const pollJob = useCallback(
    // `resumable` gates the drive loop and stall detection to full-course
    // jobs — resume-full rejects a "lite" job as NOT_RESUMABLE (it has no
    // continuation chain to resume; it already finished in one call).
    (jobId: string, resumable: boolean) => {
      let lastStepCount = 0;
      let lastProgressAt = Date.now();
      // At most one resume-full call in flight at a time — see
      // lib/ai/full-course-builder.ts's header: nothing server-side
      // continues this job on its own any more, so this tab is what drives
      // every chunk after the first. Not awaited by the tick itself, so the
      // 2s progress-label poll keeps updating while a chunk (up to
      // TIME_BUDGET_PER_INVOCATION_MS of real work) is in flight.
      let advancing = false;

      const tick = async () => {
        const res = await fetch(`/api/v1/authoring/ai/jobs/${jobId}`);
        const json = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(json.error?.message ?? "Lost track of the generation job.");
          return;
        }
        const job = json.data.job as JobRow;
        const lastStep = job.steps[job.steps.length - 1];
        const stepName = lastStep?.name ?? lastStep?.kind;
        setProgressLabel(stepName ? (STEP_LABELS[stepName] ?? stepName) : "Starting…");

        if (job.status === "succeeded" && job.output?.specId) {
          router.push(`/admin/authoring/${job.output.specId}`);
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          setStatus("error");
          setError(job.error ?? "Generation failed.");
          return;
        }

        if (job.steps.length > lastStepCount) {
          lastStepCount = job.steps.length;
          lastProgressAt = Date.now();
        }

        if (resumable && job.status === "running" && !advancing) {
          advancing = true;
          fetch(`/api/v1/authoring/ai/jobs/${jobId}/resume-full`, { method: "POST" })
            .catch(() => {})
            .finally(() => {
              advancing = false;
            });
        }

        if (resumable && Date.now() - lastProgressAt > STALL_THRESHOLD_MS) {
          // Last resort: the drive loop above is itself failing silently
          // for some other reason (repeated server errors, etc.) rather
          // than the job just being mid-chunk. Offer a manual way out
          // instead of polling a frozen progress label forever.
          setStalledJobId(jobId);
          setStatus("stalled");
          return;
        }

        pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
      };
      void tick();
    },
    [router]
  );

  async function generate() {
    setError(null);
    setStatus("submitting");

    const full = mode === "full";
    const body = full
      ? fullSourceMode === "asset"
        ? { sourceAssetId, titleHint: titleHint.trim() || undefined }
        : fullSourceMode === "url"
          ? { sourceUrl: sourceUrl.trim(), titleHint: titleHint.trim() || undefined }
          : { sourceText: sourceText.trim(), titleHint: titleHint.trim() || undefined }
      : { sourceText: sourceText.trim(), titleHint: titleHint.trim() || undefined };
    const res = await fetch(full ? "/api/v1/authoring/ai/generate-full" : "/api/v1/authoring/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();

    if (!res.ok) {
      if (json.error?.code === "AI_NOT_CONFIGURED") {
        setStatus("unconfigured");
        return;
      }
      setStatus("error");
      setError(json.error?.message ?? "Could not start generation.");
      return;
    }

    setStatus("generating");
    setProgressLabel("Starting…");
    pollJob(json.data.job.id, full);
  }

  async function resumeJob(jobId: string) {
    setError(null);
    setStatus("submitting");
    const res = await fetch(`/api/v1/authoring/ai/jobs/${jobId}/resume-full`, { method: "POST" });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus("error");
      setError(json?.error?.message ?? "Could not resume that full-course generation.");
      return;
    }
    setStalledJobId(null);
    setStatus("generating");
    setProgressLabel("Resuming full-course generation…");
    pollJob(jobId, true);
  }

  if (status === "checking") return null;

  const usableAssets = assets.filter((asset) => ["pdf", "document", "ppt"].includes(asset.type));
  const canGenerate =
    status !== "submitting" &&
    (mode === "lite"
      ? sourceText.trim().length >= 40
      : fullSourceMode === "text"
        ? sourceText.trim().length >= 40
        : fullSourceMode === "url"
          ? sourceUrl.trim().length > 8
          : Boolean(sourceAssetId));

  return (
    <section className="legacy-studio-list__create legacy-studio-ai">
      <div>
        <p>Generate with AI</p>
        <h2>Start from source material.</h2>
        <span>
          Choose a quick draft or a full course. Every result is validated and saved as a draft only — AI never
          reaches learners until a person reviews and publishes it.
        </span>
      </div>

      {status === "unconfigured" && (
        <p className="legacy-studio-ai__notice">
          AI generation is not configured for this workspace yet. A provider needs to be added before this feature
          can be used.
        </p>
      )}

      {resumeJobId && status === "idle" && (
        <div className="legacy-studio-ai__notice">
          <p>An interrupted full-course generation can be resumed safely from its last completed step.</p>
          <button onClick={() => resumeJob(resumeJobId)}>Resume full-course generation →</button>
        </div>
      )}

      {(status === "idle" || status === "submitting") && (
        <div className="legacy-studio-ai__form">
          <div role="group" aria-label="AI generation depth">
            <button type="button" onClick={() => setMode("lite")} disabled={status === "submitting"} aria-pressed={mode === "lite"}>
              Quick draft
            </button>
            <button type="button" onClick={() => setMode("full")} disabled={status === "submitting"} aria-pressed={mode === "full"}>
              Full course
            </button>
          </div>
          <p className="legacy-studio-ai__hint">
            {mode === "lite"
              ? "Creates a title, outline, objectives and the first lesson."
              : "Creates every lesson, section knowledge checks and skill tags. It may take a few minutes."}
          </p>
          {mode === "full" && (
            <div role="group" aria-label="Full-course source">
              <button type="button" onClick={() => setFullSourceMode("text")} disabled={status === "submitting"} aria-pressed={fullSourceMode === "text"}>Paste text</button>
              <button type="button" onClick={() => setFullSourceMode("url")} disabled={status === "submitting"} aria-pressed={fullSourceMode === "url"}>Web page URL</button>
              <button type="button" onClick={() => setFullSourceMode("asset")} disabled={status === "submitting"} aria-pressed={fullSourceMode === "asset"}>Library document</button>
            </div>
          )}
          {(mode === "lite" || fullSourceMode === "text") && (
          <textarea
            placeholder="Paste source material here (at least a few sentences)…"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={6}
            maxLength={mode === "full" ? 200_000 : 50_000}
            disabled={status === "submitting"}
          />
          )}
          {mode === "full" && fullSourceMode === "url" && (
            <input
              type="url"
              placeholder="https://example.com/source-material"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={status === "submitting"}
            />
          )}
          {mode === "full" && fullSourceMode === "asset" && (
            <>
              <select value={sourceAssetId} onChange={(e) => setSourceAssetId(e.target.value)} disabled={status === "submitting"}>
                <option value="">{usableAssets.length ? "Choose a PDF, Word or PowerPoint file" : "No supported documents in the library"}</option>
                {usableAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.storage_path.split("/").pop()} · {asset.type}</option>)}
              </select>
              <a href="/admin/content/assets">Upload a source document to the library →</a>
            </>
          )}
          <input
            placeholder="Working title (optional)"
            value={titleHint}
            onChange={(e) => setTitleHint(e.target.value)}
            disabled={status === "submitting"}
          />
          <button onClick={generate} disabled={!canGenerate}>
            {status === "submitting" ? "Starting…" : mode === "full" ? "Generate full draft →" : "Generate quick draft →"}
          </button>
        </div>
      )}

      {status === "generating" && (
        <p className="legacy-studio-ai__progress" role="status">
          {progressLabel ?? "Generating…"}
        </p>
      )}

      {status === "stalled" && stalledJobId && (
        <div className="legacy-studio-ai__notice">
          <p>
            This generation hasn&apos;t made progress in over a minute — it may have been interrupted. Nothing is
            lost; every completed step is saved, and resuming continues from exactly where it stopped.
          </p>
          <button onClick={() => resumeJob(stalledJobId)}>Resume generation →</button>
        </div>
      )}

      {status === "error" && error && (
        <div className="legacy-studio-ai__form">
          <p className="legacy-studio-list__error">{error}</p>
          <button onClick={() => setStatus("idle")}>Try again</button>
        </div>
      )}
    </section>
  );
}
