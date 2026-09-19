import type { CourseSpecType } from "../../lib/spec";
import { SPEC_SCHEMA_VERSION } from "../../lib/spec";

/**
 * The hand-written fixture spec for Phase 3 step 3 (Export conformance
 * spike). Deliberately not AI-generated — the step exists to prove
 * packaging/tracking, not content generation (that's step 8). Uses the real
 * CourseSpec schema from lib/spec, not an invented shape, so this is a
 * genuine proof of "a real spec document packages and tracks correctly."
 *
 * completion.rule "passedQuiz" at 80% against 5 questions gives a real
 * percentage boundary (4/5 = 80% pass, 3/5 = 60% fail) rather than a binary
 * single-question pass/fail, so the score actually reported to the LMS is
 * meaningfully computed, not hardcoded.
 */
function paragraph(text: string) {
  return { blocks: [{ kind: "paragraph" as const, spans: [{ text }] }] };
}

export const fixtureSpec: CourseSpecType = {
  specSchemaVersion: SPEC_SCHEMA_VERSION,
  meta: {
    title: "Fire Safety Basics — Export Conformance Fixture",
    description: paragraph("A hand-written fixture proving SCORM 2004 and cmi5 export conformance."),
    locale: "en",
    estimatedMinutes: 3,
  },
  navigation: { mode: "linear", showMenu: true, showProgress: true },
  completion: { rule: "passedQuiz", quizBlockId: "fire-quiz", passingScorePercent: 80 },
  sections: [
    {
      id: "intro",
      title: "Introduction",
      pages: [
        {
          id: "welcome",
          title: "Welcome",
          blocks: [
            { id: "welcome-heading", type: "heading", text: "Workplace Fire Safety", level: 1 },
            {
              id: "welcome-text",
              type: "text",
              content: paragraph(
                "This short check exists to prove that a course specification packages correctly for SCORM 2004 and cmi5, and that completion and score report back to the LMS. Answer all five questions, then submit.",
              ),
            },
          ],
        },
        {
          id: "check",
          title: "Knowledge Check",
          blocks: [
            {
              id: "fire-quiz",
              type: "quiz",
              title: "Fire Safety Check",
              passingScorePercent: 80,
              items: [
                {
                  id: "q1",
                  kind: "multipleChoice",
                  prompt: paragraph("What is the first step when a fire alarm sounds?"),
                  choices: [
                    { id: "q1a", text: paragraph("Evacuate immediately via the nearest exit"), correct: true },
                    { id: "q1b", text: paragraph("Finish your current task first") },
                    { id: "q1c", text: paragraph("Wait for a second alarm to confirm") },
                  ],
                },
                {
                  id: "q2",
                  kind: "multipleChoice",
                  prompt: paragraph("Where should you assemble after evacuating?"),
                  choices: [
                    { id: "q2a", text: paragraph("Anywhere convenient nearby") },
                    { id: "q2b", text: paragraph("The designated muster point"), correct: true },
                    { id: "q2c", text: paragraph("Back inside once the noise stops") },
                  ],
                },
                {
                  id: "q3",
                  kind: "multipleChoice",
                  prompt: paragraph("Should you use a lift (elevator) during a fire evacuation?"),
                  choices: [
                    { id: "q3a", text: paragraph("Yes, it's faster") },
                    { id: "q3b", text: paragraph("No, use the stairs"), correct: true },
                    { id: "q3c", text: paragraph("Only if it's nearby") },
                  ],
                },
                {
                  id: "q4",
                  kind: "multipleChoice",
                  prompt: paragraph("What should you do before opening a closed door during a fire?"),
                  choices: [
                    { id: "q4a", text: paragraph("Open it quickly to check") },
                    { id: "q4b", text: paragraph("Feel it for heat first"), correct: true },
                    { id: "q4c", text: paragraph("Kick it open") },
                  ],
                },
                {
                  id: "q5",
                  kind: "multipleChoice",
                  prompt: paragraph("Who should you report to at the muster point?"),
                  choices: [
                    { id: "q5a", text: paragraph("The fire warden / floor marshal"), correct: true },
                    { id: "q5b", text: paragraph("No one, just wait") },
                    { id: "q5c", text: paragraph("Head back in to get your things") },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
