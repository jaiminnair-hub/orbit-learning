import {
  type LessonStatus,
  type ScormVersion,
  formatSessionTime,
  normalizeScore,
  normalizeStatus,
  parseSessionTime,
} from "./cmi";

/**
 * The SCORM API adapter — the object a package finds on `window` and
 * talks to for its entire life.
 *
 * This is the piece that makes uploaded SCORM content trackable at all.
 * A package reports nothing by itself: on launch it walks up the frame
 * chain looking for `window.API` (1.2) or `window.API_1484_11` (2004),
 * and every completion, score and bookmark it will ever produce arrives
 * through the eight functions below. No adapter, no data.
 *
 * Kept free of DOM and network on purpose. It is a state machine over a
 * flat CMI map, with persistence handed out through `onPersist`, so the
 * conformance rules that actually bite — string returns, error-code
 * sequencing, read-only enforcement — are testable without a browser.
 */

export const ERROR_STRINGS: Record<string, string> = {
  "0": "No error",
  "101": "General exception",
  "102": "General initialization failure",
  "103": "Already initialized",
  "104": "Content instance terminated",
  "111": "General termination failure",
  "112": "Termination before initialization",
  "113": "Termination after termination",
  "122": "Retrieve data before initialization",
  "123": "Retrieve data after termination",
  "132": "Store data before initialization",
  "133": "Store data after termination",
  "142": "Commit before initialization",
  "143": "Commit after termination",
  "201": "Invalid argument error",
  "301": "Not initialized",
  "401": "Undefined data model element",
  "403": "Data model element is read only",
  "404": "Data model element is write only",
  "405": "Data model element type mismatch",
  "406": "Data model element value out of range",
};

/** SCORM returns strings, never booleans. Content does `if (x == "true")`. */
const TRUE = "true";
const FALSE = "false";

export interface ScormSnapshot {
  cmiData: Record<string, string>;
  lessonStatus: LessonStatus;
  scoreRaw: number | null;
  totalTimeSec: number;
}

export interface AdapterOptions {
  version: ScormVersion;
  learnerId: string;
  learnerName: string;
  /** CMI map restored from a previous attempt; empty for a first launch. */
  initialCmi?: Record<string, string>;
  /** Accumulated time across previous attempts, in seconds. */
  totalTimeSec?: number;
  /** Called on Commit, Terminate, and whenever status reaches a terminal value. */
  onPersist?: (snapshot: ScormSnapshot) => void;
  /** Wall clock, injectable so tests need no timers. */
  now?: () => number;
}

/** The eight functions SCORM 1.2 requires, exactly as named in the spec. */
export interface Scorm12Api {
  LMSInitialize(param: string): string;
  LMSFinish(param: string): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(param: string): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

/** The 2004 equivalents. Same contract, different names. */
export interface Scorm2004Api {
  Initialize(param: string): string;
  Terminate(param: string): string;
  GetValue(element: string): string;
  SetValue(element: string, value: string): string;
  Commit(param: string): string;
  GetLastError(): string;
  GetErrorString(code: string): string;
  GetDiagnostic(code: string): string;
}

export interface ScormAdapter {
  api: Scorm12Api | Scorm2004Api;
  snapshot(): ScormSnapshot;
  /** True once the content has reported completed / passed / failed. */
  isTerminal(): boolean;
}

const READ_ONLY_12 = new Set([
  "cmi.core.student_id",
  "cmi.core.student_name",
  "cmi.core.credit",
  "cmi.core.entry",
  "cmi.core.lesson_mode",
  "cmi.core.total_time",
  "cmi.launch_data",
  "cmi.comments_from_lms",
  "cmi.student_data.mastery_score",
  "cmi.student_data.max_time_allowed",
  "cmi.student_data.time_limit_action",
]);

const READ_ONLY_2004 = new Set([
  "cmi._version",
  "cmi.learner_id",
  "cmi.learner_name",
  "cmi.credit",
  "cmi.entry",
  "cmi.mode",
  "cmi.total_time",
  "cmi.launch_data",
  "cmi.max_time_allowed",
  "cmi.time_limit_action",
  "cmi.scaled_passing_score",
  "cmi.completion_threshold",
]);

const WRITE_ONLY_12 = new Set(["cmi.core.exit", "cmi.core.session_time"]);
const WRITE_ONLY_2004 = new Set(["cmi.exit", "cmi.session_time"]);

/** Legal values, so a typo in third-party content surfaces as an error rather than corruption. */
const VOCABULARY: Record<string, readonly string[]> = {
  "cmi.core.lesson_status": [
    "passed",
    "completed",
    "failed",
    "incomplete",
    "browsed",
    "not attempted",
  ],
  "cmi.core.exit": ["time-out", "suspend", "logout", ""],
  "cmi.completion_status": ["completed", "incomplete", "not attempted", "unknown"],
  "cmi.success_status": ["passed", "failed", "unknown"],
  "cmi.exit": ["time-out", "suspend", "logout", "normal", "suspend_all", ""],
};

const CHILDREN: Record<string, string> = {
  "cmi.core._children":
    "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time",
  "cmi.core.score._children": "raw,min,max",
  "cmi.objectives._children": "id,score,status",
  "cmi.interactions._children":
    "id,objectives,time,type,correct_responses,weighting,student_response,result,latency",
  "cmi.score._children": "scaled,raw,min,max",
};

function defaultsFor(
  version: ScormVersion,
  learnerId: string,
  learnerName: string,
  resuming: boolean
): Record<string, string> {
  const entry = resuming ? "resume" : "ab-initio";
  if (version === "1.2") {
    return {
      "cmi.core.student_id": learnerId,
      "cmi.core.student_name": learnerName,
      "cmi.core.lesson_location": "",
      "cmi.core.credit": "credit",
      "cmi.core.lesson_status": "not attempted",
      "cmi.core.entry": entry,
      "cmi.core.score.raw": "",
      "cmi.core.score.min": "",
      "cmi.core.score.max": "",
      "cmi.core.total_time": "0000:00:00.00",
      "cmi.core.lesson_mode": "normal",
      "cmi.core.exit": "",
      "cmi.core.session_time": "0000:00:00.00",
      "cmi.suspend_data": "",
      "cmi.launch_data": "",
      "cmi.comments": "",
      "cmi.comments_from_lms": "",
    };
  }
  return {
    "cmi._version": "1.0",
    "cmi.learner_id": learnerId,
    "cmi.learner_name": learnerName,
    "cmi.location": "",
    "cmi.credit": "credit",
    "cmi.completion_status": "unknown",
    "cmi.success_status": "unknown",
    "cmi.entry": entry,
    "cmi.score.scaled": "",
    "cmi.score.raw": "",
    "cmi.score.min": "",
    "cmi.score.max": "",
    "cmi.progress_measure": "",
    "cmi.total_time": "PT0H0M0S",
    "cmi.mode": "normal",
    "cmi.exit": "",
    "cmi.session_time": "PT0H0M0S",
    "cmi.suspend_data": "",
    "cmi.launch_data": "",
  };
}

export function createScormAdapter(options: AdapterOptions): ScormAdapter {
  const {
    version,
    learnerId,
    learnerName,
    initialCmi = {},
    totalTimeSec = 0,
    onPersist,
    now = () => Date.now(),
  } = options;

  const is12 = version === "1.2";
  const readOnly = is12 ? READ_ONLY_12 : READ_ONLY_2004;
  const writeOnly = is12 ? WRITE_ONLY_12 : WRITE_ONLY_2004;
  const sessionTimeKey = is12 ? "cmi.core.session_time" : "cmi.session_time";
  const totalTimeKey = is12 ? "cmi.core.total_time" : "cmi.total_time";

  // A restored map means the learner is returning, which is exactly what
  // `entry` reports — get it wrong and content replays from the start
  // even though its bookmark survived.
  const resuming = Object.keys(initialCmi).length > 0;
  const entryValue = resuming ? "resume" : "ab-initio";

  const cmi: Record<string, string> = {
    ...defaultsFor(version, learnerId, learnerName, resuming),
    ...initialCmi,
    // Identity and accumulated time are the LMS's to state, never the
    // restored attempt's — a stale name inside suspended data must not win.
    ...(is12
      ? {
          "cmi.core.student_id": learnerId,
          "cmi.core.student_name": learnerName,
          "cmi.core.entry": entryValue,
        }
      : {
          "cmi.learner_id": learnerId,
          "cmi.learner_name": learnerName,
          "cmi.entry": entryValue,
        }),
    [totalTimeKey]: formatSessionTime(version, totalTimeSec),
  };

  let initialized = false;
  let terminated = false;
  let lastError = "0";
  let startedAt = 0;
  /** Session time as reported by the content, when it bothers to report it. */
  let reportedSessionSec: number | null = null;

  const setError = (code: string) => {
    lastError = code;
  };

  function elapsedSessionSec(): number {
    if (reportedSessionSec != null) return reportedSessionSec;
    return startedAt ? Math.max(0, Math.round((now() - startedAt) / 1000)) : 0;
  }

  function snapshot(): ScormSnapshot {
    return {
      cmiData: { ...cmi },
      lessonStatus: normalizeStatus(version, cmi),
      scoreRaw: normalizeScore(version, cmi),
      totalTimeSec: totalTimeSec + elapsedSessionSec(),
    };
  }

  function persist() {
    onPersist?.(snapshot());
  }

  function isTerminalNow(): boolean {
    const s = normalizeStatus(version, cmi);
    return s === "completed" || s === "passed" || s === "failed";
  }

  /**
   * Collections are addressed positionally (`cmi.interactions.3.id`), and
   * `_count` has to reflect what has actually been written — content uses
   * it to append the next interaction.
   */
  function collectionCount(prefix: string): number {
    let max = -1;
    for (const key of Object.keys(cmi)) {
      if (!key.startsWith(prefix + ".")) continue;
      const idx = Number(key.slice(prefix.length + 1).split(".")[0]);
      if (Number.isInteger(idx) && idx > max) max = idx;
    }
    return max + 1;
  }

  function getValue(element: string): string {
    if (terminated) {
      setError(is12 ? "301" : "123");
      return "";
    }
    if (!initialized) {
      setError(is12 ? "301" : "122");
      return "";
    }
    if (!element) {
      setError("201");
      return "";
    }

    if (element in CHILDREN) {
      setError("0");
      return CHILDREN[element];
    }
    if (element.endsWith("._count")) {
      setError("0");
      return String(collectionCount(element.slice(0, -"._count".length)));
    }
    if (writeOnly.has(element)) {
      setError("404");
      return "";
    }

    const value = cmi[element];
    if (value === undefined) {
      // Unset-but-legal collection members read as empty rather than as an
      // error: content commonly probes an index before writing it.
      if (/\.\d+\./.test(element)) {
        setError("0");
        return "";
      }
      setError("401");
      return "";
    }

    setError("0");
    return value;
  }

  function setValue(element: string, value: string): string {
    if (terminated) {
      setError(is12 ? "301" : "133");
      return FALSE;
    }
    if (!initialized) {
      setError(is12 ? "301" : "132");
      return FALSE;
    }
    if (!element) {
      setError("201");
      return FALSE;
    }
    if (readOnly.has(element) || element.endsWith("._children") || element.endsWith("._count")) {
      setError("403");
      return FALSE;
    }

    const vocabulary = VOCABULARY[element];
    if (vocabulary && !vocabulary.includes(value)) {
      setError(is12 ? "405" : "406");
      return FALSE;
    }

    const wasTerminal = isTerminalNow();
    cmi[element] = value;

    if (element === sessionTimeKey) {
      reportedSessionSec = parseSessionTime(version, value);
    }

    // Reaching a terminal status is the one event worth a write of its own:
    // content often sets it and then never calls Commit, and a browser that
    // closes before the next flush would otherwise lose the completion.
    if (!wasTerminal && isTerminalNow()) persist();

    setError("0");
    return TRUE;
  }

  function initialize(): string {
    if (terminated) {
      setError(is12 ? "101" : "104");
      return FALSE;
    }
    if (initialized) {
      setError(is12 ? "101" : "103");
      return FALSE;
    }
    initialized = true;
    startedAt = now();
    setError("0");
    return TRUE;
  }

  function terminate(): string {
    if (terminated) {
      setError(is12 ? "301" : "113");
      return FALSE;
    }
    if (!initialized) {
      setError(is12 ? "301" : "112");
      return FALSE;
    }
    // Persist before flipping the flag: this is the last chance to capture
    // the session, and a terminated adapter reports nothing.
    persist();
    terminated = true;
    initialized = false;
    setError("0");
    return TRUE;
  }

  function commit(): string {
    if (terminated) {
      setError(is12 ? "301" : "143");
      return FALSE;
    }
    if (!initialized) {
      setError(is12 ? "301" : "142");
      return FALSE;
    }
    persist();
    setError("0");
    return TRUE;
  }

  const api: Scorm12Api | Scorm2004Api = is12
    ? {
        LMSInitialize: initialize,
        LMSFinish: terminate,
        LMSGetValue: getValue,
        LMSSetValue: setValue,
        LMSCommit: commit,
        LMSGetLastError: () => lastError,
        LMSGetErrorString: (code: string) => ERROR_STRINGS[code] ?? "",
        LMSGetDiagnostic: (code: string) => ERROR_STRINGS[code] ?? "",
      }
    : {
        Initialize: initialize,
        Terminate: terminate,
        GetValue: getValue,
        SetValue: setValue,
        Commit: commit,
        GetLastError: () => lastError,
        GetErrorString: (code: string) => ERROR_STRINGS[code] ?? "",
        GetDiagnostic: (code: string) => ERROR_STRINGS[code] ?? "",
      };

  return { api, snapshot, isTerminal: isTerminalNow };
}
