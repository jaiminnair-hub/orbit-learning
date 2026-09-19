import { describe, expect, it, vi } from "vitest";
import {
  createScormAdapter,
  type Scorm12Api,
  type Scorm2004Api,
  type ScormSnapshot,
} from "@/lib/scorm/adapter";

/**
 * The adapter is the contract between third-party content and this LMS.
 * Every rule tested here is one that real packages depend on and that
 * fails silently when wrong — a boolean instead of "true", a missing
 * error code, a lost bookmark. A course that reports nothing looks
 * identical to a learner who did nothing.
 */

function make12(over: Partial<Parameters<typeof createScormAdapter>[0]> = {}) {
  const persisted: ScormSnapshot[] = [];
  const adapter = createScormAdapter({
    version: "1.2",
    learnerId: "u-1",
    learnerName: "Ada Lovelace",
    onPersist: (s) => persisted.push(s),
    ...over,
  });
  return { api: adapter.api as Scorm12Api, adapter, persisted };
}

function make2004(over: Partial<Parameters<typeof createScormAdapter>[0]> = {}) {
  const persisted: ScormSnapshot[] = [];
  const adapter = createScormAdapter({
    version: "2004",
    learnerId: "u-1",
    learnerName: "Ada Lovelace",
    onPersist: (s) => persisted.push(s),
    ...over,
  });
  return { api: adapter.api as Scorm2004Api, adapter, persisted };
}

describe("SCORM 1.2 — the API surface a package expects", () => {
  it("exposes exactly the eight required functions", () => {
    const { api } = make12();
    for (const fn of [
      "LMSInitialize",
      "LMSFinish",
      "LMSGetValue",
      "LMSSetValue",
      "LMSCommit",
      "LMSGetLastError",
      "LMSGetErrorString",
      "LMSGetDiagnostic",
    ]) {
      expect(typeof (api as unknown as Record<string, unknown>)[fn], fn).toBe("function");
    }
  });

  it("returns strings, never booleans — content compares against \"true\"", () => {
    const { api } = make12();
    const init = api.LMSInitialize("");
    expect(init).toBe("true");
    expect(typeof init).toBe("string");

    const set = api.LMSSetValue("cmi.core.lesson_status", "completed");
    expect(set).toBe("true");
    expect(typeof set).toBe("string");

    expect(typeof api.LMSCommit("")).toBe("string");
    expect(typeof api.LMSFinish("")).toBe("string");
  });

  it("refuses data access before initialization, with error 301", () => {
    const { api } = make12();
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("");
    expect(api.LMSGetLastError()).toBe("301");
    expect(api.LMSSetValue("cmi.core.lesson_status", "completed")).toBe("false");
    expect(api.LMSGetLastError()).toBe("301");
  });

  it("clears the error code after a successful call", () => {
    const { api } = make12();
    api.LMSGetValue("cmi.core.lesson_status");
    expect(api.LMSGetLastError()).toBe("301");
    api.LMSInitialize("");
    expect(api.LMSGetLastError()).toBe("0");
    api.LMSGetValue("cmi.core.lesson_status");
    expect(api.LMSGetLastError()).toBe("0");
  });

  it("serves the learner identity the LMS supplied", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.student_id")).toBe("u-1");
    expect(api.LMSGetValue("cmi.core.student_name")).toBe("Ada Lovelace");
  });

  it("rejects writes to read-only elements with 403", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSSetValue("cmi.core.student_id", "someone-else")).toBe("false");
    expect(api.LMSGetLastError()).toBe("403");
    expect(api.LMSGetValue("cmi.core.student_id")).toBe("u-1");
  });

  it("rejects reads of write-only elements with 404", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.session_time")).toBe("");
    expect(api.LMSGetLastError()).toBe("404");
  });

  it("reports 401 for an element outside the data model", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.invented.element")).toBe("");
    expect(api.LMSGetLastError()).toBe("401");
  });

  it("enforces the lesson_status vocabulary", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSSetValue("cmi.core.lesson_status", "finished")).toBe("false");
    expect(api.LMSGetLastError()).toBe("405");
    expect(api.LMSSetValue("cmi.core.lesson_status", "passed")).toBe("true");
  });

  it("answers _children queries so content can enumerate the model", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core._children")).toContain("lesson_status");
    expect(api.LMSGetLastError()).toBe("0");
  });

  it("tracks interaction count as interactions are written", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.interactions._count")).toBe("0");
    api.LMSSetValue("cmi.interactions.0.id", "q1");
    api.LMSSetValue("cmi.interactions.0.result", "correct");
    api.LMSSetValue("cmi.interactions.1.id", "q2");
    expect(api.LMSGetValue("cmi.interactions._count")).toBe("2");
    expect(api.LMSGetValue("cmi.interactions.0.result")).toBe("correct");
  });

  it("reads an unwritten collection member as empty, not as an error", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.interactions.5.id")).toBe("");
    expect(api.LMSGetLastError()).toBe("0");
  });
});

describe("SCORM 1.2 — persistence", () => {
  it("persists on commit", () => {
    const { api, persisted } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.lesson_location", "page-4");
    expect(persisted).toHaveLength(0);
    api.LMSCommit("");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].cmiData["cmi.core.lesson_location"]).toBe("page-4");
  });

  it("persists the moment a terminal status is set, without waiting for a commit", () => {
    // Content routinely sets completion and then closes the window. If the
    // adapter waited for Commit, that completion would be lost.
    const { api, persisted } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.lesson_status", "completed");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].lessonStatus).toBe("completed");
  });

  it("does not re-persist on every write once already terminal", () => {
    const { api, persisted } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.lesson_status", "completed");
    api.LMSSetValue("cmi.core.lesson_location", "page-9");
    expect(persisted).toHaveLength(1);
  });

  it("persists on finish, capturing the final state", () => {
    const { api, persisted } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.score.raw", "88");
    api.LMSFinish("");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].scoreRaw).toBe(88);
  });

  it("reports the score as a number for the database column", () => {
    const { api, adapter } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.score.raw", "73.5");
    expect(adapter.snapshot().scoreRaw).toBe(73.5);
  });

  it("leaves the score null when content never sets one", () => {
    const { api, adapter } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.lesson_status", "completed");
    expect(adapter.snapshot().scoreRaw).toBeNull();
  });
});

describe("SCORM 1.2 — resume", () => {
  it("reports ab-initio on a first launch and resume on a return", () => {
    const fresh = make12();
    fresh.api.LMSInitialize("");
    expect(fresh.api.LMSGetValue("cmi.core.entry")).toBe("ab-initio");

    const returning = make12({
      initialCmi: { "cmi.core.lesson_location": "page-4", "cmi.suspend_data": "state" },
    });
    returning.api.LMSInitialize("");
    expect(returning.api.LMSGetValue("cmi.core.entry")).toBe("resume");
  });

  it("restores the bookmark and suspend data the learner left behind", () => {
    const { api } = make12({
      initialCmi: {
        "cmi.core.lesson_location": "page-4",
        "cmi.suspend_data": "chapter=2;score=40",
        "cmi.core.lesson_status": "incomplete",
      },
    });
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.lesson_location")).toBe("page-4");
    expect(api.LMSGetValue("cmi.suspend_data")).toBe("chapter=2;score=40");
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("incomplete");
  });

  it("never lets a restored attempt override the current learner's identity", () => {
    const { api } = make12({
      initialCmi: { "cmi.core.student_name": "Someone Else", "cmi.suspend_data": "x" },
    });
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.student_name")).toBe("Ada Lovelace");
  });

  it("presents accumulated time from previous attempts as total_time", () => {
    const { api } = make12({ totalTimeSec: 3661, initialCmi: { "cmi.suspend_data": "x" } });
    api.LMSInitialize("");
    expect(api.LMSGetValue("cmi.core.total_time")).toBe("0001:01:01.00");
  });

  it("adds this session's reported time to the accumulated total", () => {
    const { api, adapter } = make12({ totalTimeSec: 100 });
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.session_time", "0000:02:30.00");
    expect(adapter.snapshot().totalTimeSec).toBe(250);
  });

  it("falls back to wall-clock time when content never reports a session time", () => {
    const clock = vi.fn();
    clock.mockReturnValueOnce(1_000_000).mockReturnValue(1_000_000 + 45_000);
    const { api, adapter } = make12({ totalTimeSec: 10, now: clock });
    api.LMSInitialize("");
    expect(adapter.snapshot().totalTimeSec).toBe(55);
  });
});

describe("SCORM 2004 — the differences that matter", () => {
  it("exposes the 2004 function names", () => {
    const { api } = make2004();
    for (const fn of [
      "Initialize",
      "Terminate",
      "GetValue",
      "SetValue",
      "Commit",
      "GetLastError",
      "GetErrorString",
      "GetDiagnostic",
    ]) {
      expect(typeof (api as unknown as Record<string, unknown>)[fn], fn).toBe("function");
    }
  });

  it("uses the 2004 error codes for out-of-sequence calls", () => {
    const { api } = make2004();
    api.GetValue("cmi.completion_status");
    expect(api.GetLastError()).toBe("122");

    api.Initialize("");
    expect(api.Initialize("")).toBe("false");
    expect(api.GetLastError()).toBe("103");

    api.Terminate("");
    expect(api.GetValue("cmi.completion_status")).toBe("");
    expect(api.GetLastError()).toBe("123");
    expect(api.Terminate("")).toBe("false");
    expect(api.GetLastError()).toBe("113");
  });

  it("collapses the split completion/success model onto one stored status", () => {
    const passed = make2004();
    passed.api.Initialize("");
    passed.api.SetValue("cmi.completion_status", "completed");
    passed.api.SetValue("cmi.success_status", "passed");
    expect(passed.adapter.snapshot().lessonStatus).toBe("passed");

    // The consequential case: finished the course, failed the assessment.
    // Reporting that as merely "completed" would lose the fact that matters.
    const failed = make2004();
    failed.api.Initialize("");
    failed.api.SetValue("cmi.completion_status", "completed");
    failed.api.SetValue("cmi.success_status", "failed");
    expect(failed.adapter.snapshot().lessonStatus).toBe("failed");

    const partial = make2004();
    partial.api.Initialize("");
    partial.api.SetValue("cmi.completion_status", "incomplete");
    expect(partial.adapter.snapshot().lessonStatus).toBe("incomplete");
  });

  it("derives a percentage from a scaled score when no raw score is given", () => {
    const { api, adapter } = make2004();
    api.Initialize("");
    api.SetValue("cmi.score.scaled", "0.85");
    expect(adapter.snapshot().scoreRaw).toBe(85);
  });

  it("prefers the raw score when content reports both", () => {
    const { api, adapter } = make2004();
    api.Initialize("");
    api.SetValue("cmi.score.scaled", "0.5");
    api.SetValue("cmi.score.raw", "42");
    expect(adapter.snapshot().scoreRaw).toBe(42);
  });

  it("reads and writes ISO 8601 durations, not the 1.2 timespan format", () => {
    const { api, adapter } = make2004({ totalTimeSec: 60 });
    api.Initialize("");
    expect(api.GetValue("cmi.total_time")).toBe("PT0H1M0S");
    api.SetValue("cmi.session_time", "PT1H30M5S");
    expect(adapter.snapshot().totalTimeSec).toBe(60 + 5405);
  });

  it("persists as soon as completion is reported", () => {
    const { api, persisted } = make2004();
    api.Initialize("");
    api.SetValue("cmi.completion_status", "completed");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].lessonStatus).toBe("completed");
  });

  it("uses cmi.location as the bookmark, not cmi.core.lesson_location", () => {
    const { api } = make2004({ initialCmi: { "cmi.location": "slide-12" } });
    api.Initialize("");
    expect(api.GetValue("cmi.location")).toBe("slide-12");
    expect(api.GetValue("cmi.entry")).toBe("resume");
  });
});

describe("malformed input from third-party content", () => {
  it("survives an unparseable session time rather than corrupting the total", () => {
    const { api, adapter } = make12({ totalTimeSec: 30 });
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.session_time", "not-a-time");
    expect(adapter.snapshot().totalTimeSec).toBe(30);
  });

  it("treats a non-numeric score as no score at all", () => {
    const { api, adapter } = make12();
    api.LMSInitialize("");
    api.LMSSetValue("cmi.core.score.raw", "n/a");
    expect(adapter.snapshot().scoreRaw).toBeNull();
  });

  it("reports 201 for an empty element name", () => {
    const { api } = make12();
    api.LMSInitialize("");
    expect(api.LMSGetValue("")).toBe("");
    expect(api.LMSGetLastError()).toBe("201");
  });

  it("returns a human-readable string for an error code", () => {
    const { api } = make12();
    expect(api.LMSGetErrorString("403")).toBe("Data model element is read only");
    expect(api.LMSGetErrorString("9999")).toBe("");
  });
});
