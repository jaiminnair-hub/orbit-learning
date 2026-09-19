"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RuntimeCoursePlayer } from "@/components/runtime/RuntimeCoursePlayer";
import { ScormPlayer } from "@/components/scorm/ScormPlayer";
import { IsolatedScormPlayer } from "@/components/scorm/IsolatedScormPlayer";
import { XapiPlayer } from "@/components/xapi/XapiPlayer";
import { CourseGuide } from "@/components/learner/CourseGuide";
import type { ScormVersion } from "@/lib/scorm/cmi";

// Presence of the content origin *is* the flag — one source of truth
// rather than a separate boolean that could drift out of sync with it.
// See docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md.
const SCORM_CONTENT_ORIGIN = process.env.NEXT_PUBLIC_SCORM_CONTENT_ORIGIN || null;

// Isolation is documented as "implemented and live in Production" — once
// that's true, a missing origin in a real Vercel production deployment
// must refuse to play SCORM content rather than silently falling back to
// the legacy same-origin player (full session cookie in ambient scope),
// which reopens exactly the vulnerability isolation exists to close.
//
// Deliberately NOT NODE_ENV === "production": this codebase's own e2e
// suite runs a *production build* locally/in CI for reliability
// (docs/ORBIT_STATUS.md §1 — `next build && next start`, NODE_ENV is
// "production" there too) while intentionally testing the legacy player
// without the second app deployed. NEXT_PUBLIC_VERCEL_ENV is Vercel's own
// client-visible signal — set only by an actual Vercel deployment, never
// by a local or CI production build — so it's the one check that means
// "really deployed to Vercel prod," matching proxy.ts's server-side
// VERCEL_ENV check for the same reason.
const SCORM_ISOLATION_REQUIRED = process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

if (SCORM_ISOLATION_REQUIRED && !SCORM_CONTENT_ORIGIN && typeof window !== "undefined") {
  console.error(
    "[security] NEXT_PUBLIC_SCORM_CONTENT_ORIGIN is unset in production — SCORM playback will refuse to render until content isolation is configured."
  );
}

interface LearningObject {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  source?: string;
  course_specification_id?: string | null;
}
interface Lesson {
  id: string;
  title: string;
  learningObjects: LearningObject[];
}
interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}
interface CourseMeta {
  id: string;
  title: string;
  description: string | null;
}

interface AssetView {
  assetId: string;
  url: string;
  type: string;
}

// The learner-facing player. Renders the course tree from
// /courses/[id]/structure and plays whatever a learning object is
// composed of: SCORM packages in an iframe against the extracted-assets
// route (step 2), everything else through a short-lived signed URL.
//
// SCORM packages are handed to ScormPlayer, which mounts the API adapter
// they report through; when one reports completion the enclosing learning
// object is marked complete automatically, so SCORM completion is
// observed rather than self-declared by the learner.
export function CoursePlayer({
  courseId,
  learnerId,
  learnerName,
}: {
  courseId: string;
  learnerId: string;
  learnerName: string;
}) {
  const [course, setCourse] = useState<CourseMeta | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLo, setActiveLo] = useState<LearningObject | null>(null);
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [scorm, setScorm] = useState<{
    packageId: string;
    entryUrl: string;
    version: ScormVersion;
    /** Set only when SCORM_CONTENT_ORIGIN is configured — see below. */
    bridgeToken?: string;
  } | null>(null);
  const [xapi, setXapi] = useState<{ packageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<{ total: number; completed: number; percent: number } | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [authoredPage, setAuthoredPage] = useState<{ pageId: string; pageTitle: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/content/courses/${courseId}/structure`);
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error?.message ?? "Could not load this course.");
        setLoading(false);
        return;
      }
      setCourse(json.data.course);
      setModules(json.data.modules);

      const [progRes, enrRes] = await Promise.all([
        fetch(`/api/v1/progress?courseId=${courseId}`),
        fetch("/api/v1/enrollments"),
      ]);
      const progJson = await progRes.json();
      const enrJson = await enrRes.json();
      if (cancelled) return;

      if (progRes.ok) {
        setCompleted(
          new Set(
            (progJson.data.progress ?? [])
              .filter((p: { status: string }) => p.status === "completed")
              .map((p: { learning_object_id: string }) => p.learning_object_id)
          )
        );
        setSummary(progJson.data.summary ?? null);
      }
      if (enrRes.ok) {
        setEnrolled(
          (enrJson.data.enrollments ?? []).some(
            (e: { enrollable_id: string }) => e.enrollable_id === courseId
          )
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const refreshProgress = useCallback(async () => {
    const res = await fetch(`/api/v1/progress?courseId=${courseId}`);
    const json = await res.json();
    if (!res.ok) return;
    setCompleted(
      new Set(
        (json.data.progress ?? [])
          .filter((p: { status: string }) => p.status === "completed")
          .map((p: { learning_object_id: string }) => p.learning_object_id)
      )
    );
    setSummary(json.data.summary ?? null);
  }, [courseId]);

  const enrol = useCallback(async () => {
    const res = await fetch("/api/v1/enrollments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId }),
    });
    if (res.ok) setEnrolled(true);
    else {
      const j = await res.json();
      setError(j.error?.message ?? "Could not enrol.");
    }
  }, [courseId]);

  const markComplete = useCallback(
    async (lo: LearningObject, score?: number | null, timeSpentSec?: number) => {
      const res = await fetch("/api/v1/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // A SCORM package's score and time belong in the progress row too,
        // not only in scorm_progress — otherwise the completion report can
        // show that someone finished but never what they scored.
        body: JSON.stringify({
          learningObjectId: lo.id,
          courseId,
          status: "completed",
          ...(score != null ? { score } : {}),
          ...(timeSpentSec != null ? { timeSpentSec } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error?.message ?? "Could not save progress.");
        return;
      }
      await refreshProgress();
    },
    [courseId, refreshProgress]
  );

  const openLearningObject = useCallback(async (lo: LearningObject) => {
    setActiveLo(lo);
    setAssets([]);
    setScorm(null);
    setXapi(null);
    setError(null);
    setAuthoredPage(null);

    // Authored content (step 5) is played entirely by RuntimeCoursePlayer,
    // which fetches its own spec and resume state — the SCORM/asset fetch
    // below is for the two existing Phase 2 content kinds only.
    if (lo.source === "authored") return;

    const res = await fetch(`/api/v1/content/learning-objects/${lo.id}/assets`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error?.message ?? "Could not load this content.");
      return;
    }

    setAssets(json.data.assets ?? []);
    if (json.data.scorm) {
      const { packageId, entryPoint, scormVersion } = json.data.scorm;

      // Isolated mode needs a signed token instead of a same-origin URL —
      // minted server-side (the secret that signs it never reaches this
      // client) via the same authorization check the classic asset route
      // already enforces.
      let bridgeToken: string | undefined;
      if (SCORM_CONTENT_ORIGIN) {
        const tokenRes = await fetch(`/api/v1/content/scorm/${packageId}/bridge-token`);
        if (tokenRes.ok) bridgeToken = (await tokenRes.json()).data.token;
      }

      setScorm({
        packageId,
        entryUrl: `/api/v1/content/scorm/${packageId}/assets/${entryPoint}`,
        version: scormVersion === "1.2" ? "1.2" : "2004",
        bridgeToken,
      });
    }
    if (json.data.xapi) {
      setXapi({ packageId: json.data.xapi.packageId });
    }
  }, []);

  const courseItems = useMemo(
    () =>
      modules.flatMap((module) =>
        module.lessons.flatMap((lesson) =>
          lesson.learningObjects.map((learningObject) => ({ module, lesson, learningObject }))
        )
      ),
    [modules]
  );
  const activeIndex = activeLo
    ? courseItems.findIndex((item) => item.learningObject.id === activeLo.id)
    : -1;
  const activeContext = activeIndex >= 0 ? courseItems[activeIndex] : null;
  const nextItem = activeIndex >= 0 ? courseItems[activeIndex + 1] : null;

  if (loading) return <p className="text-sm text-muted-foreground">Loading course…</p>;
  if (!course) return <p className="text-sm text-destructive">{error ?? "Course not found."}</p>;

  return (
    <div className="focus-player">
      <aside className="focus-player__outline" aria-label="Course outline">
        <div className="focus-player__outline-heading">
          <span>Course progress</span>
          <strong>{summary ? `${summary.percent}%` : "—"}</strong>
        </div>
        <div className="focus-player__progress" aria-label="Course completion progress">
          <span style={{ width: `${summary?.percent ?? 0}%` }} />
        </div>

        {!enrolled ? (
          <button onClick={enrol} className="focus-player__enrol">Enrol in this course</button>
        ) : (
          <p className="focus-player__enrolled">
            Enrolled{summary ? ` · ${summary.completed} of ${summary.total} complete` : ""}
          </p>
        )}

        {modules.length === 0 && <p className="focus-player__empty">This course has no content yet.</p>}
        {modules.map((module, moduleIndex) => (
          <section className="focus-player__module" key={module.id}>
            <p>Module {String(moduleIndex + 1).padStart(2, "0")}</p>
            <h2>{module.title}</h2>
            {module.lessons.map((lesson) => (
              <div className="focus-player__lesson" key={lesson.id}>
                <span>{lesson.title}</span>
                {lesson.learningObjects.map((learningObject) => {
                  const isActive = activeLo?.id === learningObject.id;
                  const isComplete = completed.has(learningObject.id);
                  return (
                    <button
                      key={learningObject.id}
                      onClick={() => openLearningObject(learningObject)}
                      className={`focus-player__item${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}`}
                      aria-current={isActive ? "step" : undefined}
                    >
                      <i aria-hidden="true">{isComplete ? "✓" : isActive ? "→" : "○"}</i>
                      {learningObject.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </aside>

      <main className="focus-player__stage">
        {!activeLo && (
          <div className="focus-player__welcome">
            <span className="focus-player__eyebrow">{enrolled ? "Ready when you are" : "Course overview"}</span>
            <h1>{course.title}</h1>
            <p>{course.description || "Choose a lesson from the course outline to begin."}</p>
            <div className="focus-player__welcome-orbit" aria-hidden="true"><span>O</span></div>
          </div>
        )}

        {activeLo && (
          <>
            <header className="focus-player__lesson-header">
              <div>
                <span className="focus-player__eyebrow">
                  {activeContext?.module.title} · {activeContext?.lesson.title}
                </span>
                <h1>{activeLo.title}</h1>
                {activeLo.description && <p>{activeLo.description}</p>}
              </div>
              {completed.has(activeLo.id) && <span className="focus-player__complete">✓ Completed</span>}
            </header>

            {error && <p className="focus-player__error">{error}</p>}

            <div className="focus-player__content">
              {activeLo.source === "authored" && activeLo.course_specification_id && (
                <RuntimeCoursePlayer
                  specId={activeLo.course_specification_id}
                  onComplete={() => markComplete(activeLo)}
                  onPageContextChange={setAuthoredPage}
                />
              )}

              {scorm && SCORM_CONTENT_ORIGIN && scorm.bridgeToken && (
                <IsolatedScormPlayer
                  key={scorm.packageId}
                  packageId={scorm.packageId}
                  token={scorm.bridgeToken}
                  contentOrigin={SCORM_CONTENT_ORIGIN}
                  onCompleted={(snapshot) => markComplete(activeLo, snapshot.scoreRaw, snapshot.totalTimeSec)}
                />
              )}

              {scorm && !SCORM_CONTENT_ORIGIN && !SCORM_ISOLATION_REQUIRED && (
                <ScormPlayer
                  key={scorm.packageId}
                  packageId={scorm.packageId}
                  scormVersion={scorm.version}
                  entryUrl={scorm.entryUrl}
                  learnerId={learnerId}
                  learnerName={learnerName}
                  onCompleted={(snapshot) => markComplete(activeLo, snapshot.scoreRaw, snapshot.totalTimeSec)}
                />
              )}

              {scorm && !SCORM_CONTENT_ORIGIN && SCORM_ISOLATION_REQUIRED && (
                <p className="focus-player__error" role="alert">
                  This SCORM package can&apos;t be played right now — content isolation is not
                  configured for this environment. Contact your platform administrator.
                </p>
              )}

              {scorm && SCORM_CONTENT_ORIGIN && !scorm.bridgeToken && (
                <p className="focus-player__error" role="alert">
                  This SCORM package could not be loaded securely. Please try again or contact support.
                </p>
              )}

              {xapi && (
                <XapiPlayer
                  key={xapi.packageId}
                  packageId={xapi.packageId}
                  onCompleted={(result) => markComplete(activeLo, result.scoreRaw)}
                />
              )}

              {assets.map((asset) => (
                <div key={asset.assetId} className="focus-player__asset">
                  {asset.type === "video" && <video controls src={asset.url} className="w-full rounded-md" />}
                  {asset.type === "audio" && <audio controls src={asset.url} className="w-full" />}
                  {asset.type === "pdf" && <iframe title={`asset-${asset.assetId}`} src={asset.url} className="h-[420px] w-full rounded-md border border-border" />}
                  {["text", "document", "ppt", "url", "embed"].includes(asset.type) && (
                    <a href={asset.url} target="_blank" rel="noopener noreferrer" className="focus-player__asset-link">Open {asset.type}</a>
                  )}
                </div>
              ))}

              {activeLo.source !== "authored" && !scorm && !xapi && assets.length === 0 && !error && (
                <p className="focus-player__empty-content">This item has no attached material yet.</p>
              )}
            </div>

            <CourseGuide
              courseId={course.id}
              courseTitle={course.title}
              learningObjectId={activeLo.id}
              learningObjectTitle={activeLo.title}
              moduleTitle={activeContext?.module.title}
              lessonTitle={activeContext?.lesson.title}
              pageTitle={authoredPage?.pageTitle}
            />

            <footer className="focus-player__actions">
              <div>
                {enrolled && (
                  completed.has(activeLo.id) ? <span className="focus-player__completed-copy">Progress saved.</span>
                    : activeLo.source === "authored" || scorm || xapi ? <span>Completion is recorded by this course.</span>
                    : <button onClick={() => markComplete(activeLo)} className="focus-player__mark-complete">Mark as complete</button>
                )}
              </div>
              {nextItem && (
                <button onClick={() => openLearningObject(nextItem.learningObject)} className="focus-player__next">
                  Next: {nextItem.learningObject.title} →
                </button>
              )}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
