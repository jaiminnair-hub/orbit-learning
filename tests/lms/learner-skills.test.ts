import { describe, expect, it } from "vitest";
import { assembleLearnerSkillRows, collectSkillTagIds } from "@/lib/lms/learner-skills";
import type { WorkRow } from "@/lib/lms/my-work";

const tag = { id: "11111111-1111-4111-8111-111111111111", name: "Active Listening", description: null, external_ref: "ESCO:listening" };

describe("learner skills", () => {
  it("collects nested skill tags without duplicates", () => {
    expect([...collectSkillTagIds({ skillTagIds: [tag.id], objectives: [{ skillTagIds: [tag.id] }] })]).toEqual([tag.id]);
  });

  it("shows honest learning evidence and excludes completed courses from recommendations", () => {
    const work: WorkRow[] = [{ kind: "course", id: "enrollment-1", refId: "course-1", title: "Listening well", status: "completed", percent: 100, score: 88, dueDate: null, completedAt: "2026-09-16", overdue: false, href: "/courses/course-1" }];
    const rows = assembleLearnerSkillRows({
      tags: [tag],
      courses: [{ id: "course-1", title: "Listening well" }, { id: "course-2", title: "Advanced listening" }],
      courseSkills: new Map([["course-1", new Set([tag.id])], ["course-2", new Set([tag.id])]]),
      assessmentSkills: new Map(),
      work,
    });
    expect(rows[0]).toMatchObject({ state: "completed_learning", evidence: [{ title: "Listening well" }], recommendations: [{ id: "course-2", status: "available" }] });
  });

  it("does not turn an assessment mapping into an invented proficiency score", () => {
    const work: WorkRow[] = [{ kind: "assessment", id: "assignment-1", refId: "assessment-1", title: "Listening check", status: "assigned", percent: null, score: null, dueDate: null, completedAt: null, overdue: false, href: "/assessments/assessment-1" }];
    const rows = assembleLearnerSkillRows({ tags: [tag], courses: [], courseSkills: new Map(), assessmentSkills: new Map([["assessment-1", new Set([tag.id])]]), work });
    expect(rows[0]).toMatchObject({ state: "in_progress", evidence: [{ score: null }] });
  });
});
