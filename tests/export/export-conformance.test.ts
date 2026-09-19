import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { validateCourseSpec } from "@/lib/spec";
import { buildScorm2004Package } from "@/lib/export/scorm2004";
import { buildCmi5Package } from "@/lib/export/cmi5";
import { fixtureSpec } from "../../spikes/export-conformance/fixture";
import { renderCourse } from "../../spikes/export-conformance/render";

/**
 * Phase 3 step 3 — Export conformance spike (DEVELOPMENT_SEQUENCE_PHASE3.md).
 *
 * Proves, with real evidence, that a course specification packages as a
 * structurally conformant SCORM 2004 SCO and a structurally conformant cmi5
 * AU. This is the automatable half of the step. It does NOT and cannot prove
 * the other half the step actually requires — "run both in a real
 * third-party LMS, confirming completion and score report back" — since that
 * needs a live LMS session outside this test process. The two zips this test
 * writes to spikes/export-conformance/output/ are exactly what a human (or a
 * future CI job with real credentials) uploads to close that out.
 */
describe("Phase 3 step 3 — export conformance", () => {
  it("the fixture spec validates against the real schema", () => {
    const report = validateCourseSpec(fixtureSpec);
    expect(report.errorCount, JSON.stringify(report.findings)).toBe(0);
    expect(report.valid).toBe(true);
  });

  const rendered = renderCourse(fixtureSpec);

  it("renders both pages with real content", () => {
    expect(rendered.pages).toHaveLength(2);
    expect(rendered.pages[0]!.bodyHtml).toContain("Workplace Fire Safety");
    expect(rendered.pages[1]!.bodyHtml).toContain("fire-quiz");
  });

  it("the content script carries a real, non-trivial answer key", () => {
    // 5 questions authored in the fixture -> 5 entries in the embedded key.
    const matches = rendered.contentScript.match(/"q\d"/g) ?? [];
    expect(new Set(matches).size).toBe(5);
    expect(rendered.contentScript).toContain("course:complete");
  });

  const scorm = buildScorm2004Package({
    title: rendered.title,
    identifier: "COM.LEARNING-PLATFORM.EXPORT-CONFORMANCE.FIRE-SAFETY",
    pages: rendered.pages,
    contentScript: rendered.contentScript,
  });

  const cmi5 = buildCmi5Package({
    title: rendered.title,
    description: "Phase 3 step 3 export conformance fixture.",
    courseId: "https://lms.example.com/export-conformance/course",
    auId: "https://lms.example.com/export-conformance/au",
    pages: rendered.pages,
    contentScript: rendered.contentScript,
  });

  it("writes both packages to disk for manual LMS upload", () => {
    const outDir = join(process.cwd(), "spikes/export-conformance/output");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "fire-safety-scorm2004.zip"), scorm);
    writeFileSync(join(outDir, "fire-safety-cmi5.zip"), cmi5);
    expect(scorm.byteLength).toBeGreaterThan(0);
    expect(cmi5.byteLength).toBeGreaterThan(0);
  });

  describe("SCORM 2004 package structure", () => {
    const files = unzipSync(scorm);
    const decoder = new TextDecoder();

    it("contains imsmanifest.xml, index.html, content.js, scorm-api.js", () => {
      expect(Object.keys(files).sort()).toEqual(["content.js", "imsmanifest.xml", "index.html", "scorm-api.js"]);
    });

    it("declares SCORM 2004 3rd Edition and a single sco resource", () => {
      const xml = decoder.decode(files["imsmanifest.xml"]!);
      expect(xml).toContain("<schemaversion>2004 3rd Edition</schemaversion>");
      expect(xml).toContain('adlcp:scormType="sco"');
      expect(xml).toContain('href="index.html"');
    });

    it("the RTE adapter implements real Initialize/SetValue/Commit/Terminate calls, not stubs", () => {
      const js = decoder.decode(files["scorm-api.js"]!);
      expect(js).toContain("API_1484_11");
      expect(js).toContain('API.Initialize("")');
      expect(js).toContain("cmi.completion_status");
      expect(js).toContain("cmi.success_status");
      expect(js).toContain("cmi.score.scaled");
      expect(js).toContain('API.Commit("")');
      expect(js).toContain('API.Terminate("")');
      expect(js).toContain("course:complete");
    });

    it("index.html references both scripts", () => {
      const html = decoder.decode(files["index.html"]!);
      expect(html).toContain('src="scorm-api.js"');
      expect(html).toContain('src="content.js"');
    });
  });

  describe("cmi5 package structure", () => {
    const files = unzipSync(cmi5);
    const decoder = new TextDecoder();

    it("contains cmi5.xml, index.html, content.js, cmi5.js", () => {
      expect(Object.keys(files).sort()).toEqual(["cmi5.js", "cmi5.xml", "content.js", "index.html"]);
    });

    it("declares one AU with moveOn=CompletedOrPassed pointing at index.html", () => {
      const xml = decoder.decode(files["cmi5.xml"]!);
      expect(xml).toContain('moveOn="CompletedOrPassed"');
      expect(xml).toContain("<url>index.html</url>");
      expect(xml).toContain("<course id=");
      expect(xml).toContain("<au id=");
    });

    it("the AU adapter implements a real launch/statement lifecycle, not stubs", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain("launch.fetch");
      expect(js).toContain("auth-token");
      expect(js).toContain("http://adlnet.gov/expapi/verbs/initialized");
      expect(js).toContain("http://adlnet.gov/expapi/verbs/completed");
      expect(js).toContain("http://adlnet.gov/expapi/verbs/passed");
      expect(js).toContain("http://adlnet.gov/expapi/verbs/failed");
      expect(js).toContain("http://adlnet.gov/expapi/verbs/terminated");
      expect(js).toContain("statements");
      expect(js).toContain("course:complete");
    });

    it("index.html references both scripts", () => {
      const html = decoder.decode(files["index.html"]!);
      expect(html).toContain('src="cmi5.js"');
      expect(html).toContain('src="content.js"');
    });

    // Regression: real SCORM Cloud run on 2026-08-20 showed the auth-token
    // fetch failing with "Invalid HTTP method (not a POST): GET" — the cmi5
    // spec requires a POST to the `fetch` launch parameter, not a GET. Found
    // via the on-page debug panel below, not guessed.
    it("fetches the auth token via POST, per the cmi5 spec", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toMatch(/fetch\(launch\.fetch,\s*\{\s*method:\s*"POST"\s*\}\)/);
    });

    it("carries an on-page debug panel, since a real LMS launch has no open console", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain("cmi5-debug");
    });

    // Regression: a real SCORM Cloud run on 2026-08-20 rejected a
    // self-generated session id with 403 "session id does not match request
    // context" - the LRS expects its own session (carried as a "session"
    // query parameter on the fetch launch URL) echoed back, not one the AU
    // invents. Found via the debug panel, not guessed.
    it("uses the LMS's own session id from the fetch URL when present, not a self-generated one", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain('new URL(launch.fetch).searchParams.get("session")');
      expect(js).toContain("sessionIdFromFetch");
    });

    // Added 2026-08-20 alongside the grouping fix below. Confirmed harmless
    // (a legitimate field real cmi5 content includes) but NOT confirmed as
    // the actual fix for the 500 - a real run with only this field added
    // still 500'd identically. Left in; the grouping fix below is the one
    // with real evidence behind it.
    it("statements carry an object.definition.type", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain('definition: { type: "http://adlnet.gov/expapi/activities/lesson" }');
    });

    // Regression: adding only the parent course to `grouping` (previous
    // fix) moved the real SCORM Cloud error from an opaque 500
    // NullPointerException to a specific, named 403: "grouping does not
    // contain Publisher Activity". Per https://risc-inc.com/cmi5-publisher-id/,
    // the Publisher Activity is the AU's OWN id as authored in cmi5.xml
    // (opts.auId at build time) - a value completely distinct from the
    // LMS-generated `activityId` in the launch params, which is what this
    // statement's object.id correctly uses instead. Both course and AU
    // publisher id must be present in grouping.
    it("statements' context.contextActivities.grouping include both the parent course and this AU's own Publisher Activity id", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain("var COURSE_ID = ");
      expect(js).toContain("var PUBLISHER_AU_ID = ");
      expect(js).toContain("grouping:");
      expect(js).toContain("id: COURSE_ID");
      expect(js).toContain("id: PUBLISHER_AU_ID");
    });

    it("the built script embeds the real course id and AU id from the build options, not placeholders", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain(JSON.stringify("https://lms.example.com/export-conformance/course"));
      expect(js).toContain(JSON.stringify("https://lms.example.com/export-conformance/au"));
    });

    // Regression: a real SCORM Cloud run on 2026-08-20 rejected the
    // Initialized statement itself with 403 "The AU must retrieve Learner
    // Preferences document from the Agent Profile" - a genuine cmi5 spec
    // requirement (AICC/CMI-5_Spec_Current) never implemented before this.
    it("retrieves the cmi5LearnerPreferences document from the Agent Profile API before sending Initialized", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain("cmi5LearnerPreferences");
      expect(js).toContain("agents/profile?profileId=");
      expect(js).toContain("fetchLearnerPreferences()");
    });

    // Regression: a real SCORM Cloud run on 2026-08-20 got Initialized
    // accepted (OK 200) but Completed rejected with 403 "moveon Activity
    // required in context.contextActivities.category" - the base cmi5
    // category alone is only enough for statements with no result; anything
    // whose result carries success/completion (Completed, Passed, Failed)
    // needs a second, distinct "moveon" category too, per
    // https://aicc.github.io/CMI-5_Spec_Current/samples/scenarios/.
    it("Completed/Passed/Failed statements declare the moveon category; Initialized does not", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain("https://w3id.org/xapi/cmi5/context/categories/moveon");
      expect(js).toContain('baseStatement("http://adlnet.gov/expapi/verbs/completed", "completed", true)');
      expect(js).toContain('baseStatement(verbId, passed ? "passed" : "failed", true)');
      expect(js).toContain('baseStatement("http://adlnet.gov/expapi/verbs/initialized", "initialized")');
      expect(js).not.toContain('baseStatement("http://adlnet.gov/expapi/verbs/initialized", "initialized", true)');
    });

    // Regression: the same run rejected the Failed statement with 403
    // "result.completion not allowed" - completion is signalled only by the
    // separate Completed statement, confirmed against the reference example
    // at 05-completed_or_passed-failed_completed.
    it("the Passed/Failed statement's result does not include completion", () => {
      const js = decoder.decode(files["cmi5.js"]!);
      expect(js).toContain("success: passed,");
      expect(js).not.toMatch(/success:\s*passed,\s*completion/);
    });
  });
});
