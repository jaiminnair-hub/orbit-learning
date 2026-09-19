import { describe, expect, it } from "vitest";
import { filterTranscriptRows, transcriptSummary, type TranscriptRow } from "@/lib/lms/transcript";

const rows: TranscriptRow[] = [
  { kind: "course", id: "course", title: "Course", status: "completed", percent: 100, score: 82, dueDate: null, completedAt: "2026-09-01", issuedAt: null, overdue: false, href: "/courses/1" },
  { kind: "assessment", id: "assessment", title: "Assessment", status: "assigned", percent: null, score: null, dueDate: "2026-08-01", completedAt: null, issuedAt: null, overdue: true, href: "/assessments/1" },
  { kind: "learning_path", id: "path", title: "Path", status: "in_progress", percent: 50, score: null, dueDate: null, completedAt: null, issuedAt: null, overdue: false, href: "/paths/1" },
  { kind: "certificate", id: "certificate", title: "Certificate", status: "issued", percent: 100, score: 90, dueDate: null, completedAt: "2026-09-02", issuedAt: "2026-09-02", overdue: false, href: "/certificates/1" },
];

describe("learner transcript filters", () => {
  it("filters independently by completion, overdue state, kind and score", () => {
    expect(filterTranscriptRows(rows, { status: "complete" }).map((row) => row.id)).toEqual(["course", "certificate"]);
    expect(filterTranscriptRows(rows, { status: "overdue" }).map((row) => row.id)).toEqual(["assessment"]);
    expect(filterTranscriptRows(rows, { kind: "learning_path" }).map((row) => row.id)).toEqual(["path"]);
    expect(filterTranscriptRows(rows, { minScore: 85 }).map((row) => row.id)).toEqual(["certificate"]);
  });

  it("summarizes work separately from earned certificates", () => {
    expect(transcriptSummary(rows)).toEqual({ total: 3, completed: 1, overdue: 1, certificates: 1 });
  });
});
