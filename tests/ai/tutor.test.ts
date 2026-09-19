import { describe, expect, it } from "vitest";
import { SPEC_SCHEMA_VERSION } from "@/lib/spec";
import { buildKnowledgeChunks, chunkPlainText, filterPassagesForContext } from "@/lib/ai/tutor";

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    course_id: "course-1",
    course_title: "Giving useful feedback",
    course_description: "Build trust through specific observations.",
    module_id: "module-1",
    module_title: "Feedback foundations",
    lesson_id: "lesson-1",
    lesson_title: "Describe what happened",
    learning_object_id: "object-1",
    learning_object_title: "Observation before assumption",
    learning_object_description: "Separate visible behaviour from interpretation.",
    source: "authored",
    course_specification_id: "spec-1",
    specification: {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Giving useful feedback", locale: "en" },
      sections: [
        {
          id: "section-1",
          title: "Foundations",
          pages: [
            {
              id: "page-1",
              title: "Use specific observations",
              blocks: [
                { id: "heading-1", type: "heading", level: 1, text: "Name the behaviour" },
                {
                  id: "text-1",
                  type: "text",
                  content: {
                    blocks: [
                      {
                        kind: "paragraph",
                        spans: [{ text: "Describe the action you observed without guessing the person's intent." }],
                      },
                    ],
                  },
                },
              ],
            },
            { id: "hidden-page", title: "Facilitator notes", hiddenFromMenu: true, blocks: [{ id: "hidden", type: "heading", level: 1, text: "Never reveal this" }] },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("AI Tutor knowledge chunks", () => {
  it("splits long text on word boundaries with bounded overlap", () => {
    const text = Array.from({ length: 80 }, (_, index) => `word-${index}`).join(" ");
    const chunks = chunkPlainText(text, 120, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.join(" ")).toContain("word-0");
    expect(chunks.join(" ")).toContain("word-79");
  });

  it("extracts learner-visible authored page text with its course hierarchy", () => {
    const chunks = buildKnowledgeChunks("org-1", [sourceRow()] as never);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Course: Giving useful feedback");
    expect(chunks[0].content).toContain("Page: Use specific observations");
    expect(chunks[0].content).toContain("Describe the action you observed");
    expect(chunks[0].content).not.toContain("Never reveal this");
    expect(chunks[0].content).not.toContain("<h1>");
    expect(chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("indexes the visible title and description of a published asset-backed item", () => {
    const chunks = buildKnowledgeChunks("org-1", [sourceRow({ source: "assets", specification: null })] as never);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("Learning item: Observation before assumption");
    expect(chunks[0].content).toContain("Separate visible behaviour from interpretation.");
  });

  it("uses stable source keys but changes the hash when learner-visible text changes", () => {
    const first = buildKnowledgeChunks("org-1", [sourceRow()] as never)[0];
    const changed = buildKnowledgeChunks(
      "org-1",
      [sourceRow({ learning_object_description: "A newly published description." })] as never
    )[0];

    expect(changed.sourceKey).toBe(first.sourceKey);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it("keeps an in-player question inside its current course and prefers the active page", () => {
    const passages = [
      { id: "other", courseId: "course-2", learningObjectId: "object-2", courseTitle: "Other", moduleTitle: null, lessonTitle: null, pageTitle: "Same words", content: "Other content", similarity: 0.99 },
      { id: "course", courseId: "course-1", learningObjectId: "object-3", courseTitle: "Current", moduleTitle: null, lessonTitle: null, pageTitle: "Another page", content: "Course content", similarity: 0.8 },
      { id: "page", courseId: "course-1", learningObjectId: "object-1", courseTitle: "Current", moduleTitle: null, lessonTitle: null, pageTitle: "Active page", content: "Active content", similarity: 0.7 },
    ];

    const filtered = filterPassagesForContext(passages, {
      courseId: "course-1",
      courseTitle: "Current",
      learningObjectId: "object-1",
      pageTitle: "Active page",
    });

    expect(filtered.map((passage) => passage.id)).toEqual(["page", "course"]);
    expect(filtered.some((passage) => passage.courseId === "course-2")).toBe(false);
  });
});
