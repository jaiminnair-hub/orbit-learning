import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnvConfig } from "@next/env";
import { SPEC_SCHEMA_VERSION } from "@/lib/spec";
import { getLocalStatus } from "../setup/local-supabase";
import { adminClient, cleanupOrg, seedOrgWithUser, type SeededOrg } from "../setup/seed";
import { answerTutorQuestion, retrievePublishedKnowledge } from "@/lib/ai/tutor";

const live = process.env.RUN_AI_TUTOR_LIVE === "1";

describe.skipIf(!live)("AI Tutor live provider verification", () => {
  let org: SeededOrg;

  beforeAll(async () => {
    // Next deliberately excludes .env.local when NODE_ENV=test. This is an
    // explicitly opted-in live test, so load the development environment for
    // this one process and immediately restore the test mode marker.
    const nodeEnv = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "development");
    loadEnvConfig(process.cwd(), true, console, true);
    if (nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", nodeEnv);
    const local = getLocalStatus();
    // Usage logging inside the real gateway must remain in the disposable
    // local database during this test, never whichever Supabase URL happens
    // to be present in a developer's .env.local.
    process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
    process.env.SUPABASE_SECRET_KEY = local.SERVICE_ROLE_KEY;
    org = await seedOrgWithUser("ai-tutor-live");

    const specification = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Nebula Chamber Safety", locale: "en" },
      sections: [
        {
          id: "section-entry",
          title: "Safe entry",
          pages: [
            {
              id: "page-pressure-seal",
              title: "The pressure seal",
              blocks: [
                { id: "heading-entry", type: "heading", level: 1, text: "Before entering the chamber" },
                {
                  id: "text-entry",
                  type: "text",
                  content: {
                    blocks: [
                      {
                        kind: "paragraph",
                        spans: [
                          {
                            text: "Check that the blue pressure seal is steady, then turn the copper lever exactly twice before opening the hatch.",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const spec = await adminClient
      .from("course_specifications")
      .insert({
        org_id: org.orgId,
        title: "Nebula Chamber Safety",
        spec: specification,
        spec_schema_version: SPEC_SCHEMA_VERSION,
        status: "published",
        version: 1,
        source_kind: "manual",
      })
      .select("id")
      .single();
    if (spec.error) throw spec.error;

    const course = await adminClient
      .from("courses")
      .insert({ org_id: org.orgId, title: "Nebula Chamber Safety", slug: `nebula-${org.slug}`, status: "published", version: 1, published_at: new Date().toISOString() })
      .select("id")
      .single();
    if (course.error) throw course.error;

    const moduleRow = await adminClient
      .from("modules")
      .insert({ org_id: org.orgId, course_id: course.data.id, title: "Safe entry", sequence: 0 })
      .select("id")
      .single();
    if (moduleRow.error) throw moduleRow.error;

    const lesson = await adminClient
      .from("lessons")
      .insert({ org_id: org.orgId, module_id: moduleRow.data.id, title: "Opening the hatch", sequence: 0 })
      .select("id")
      .single();
    if (lesson.error) throw lesson.error;

    const learningObject = await adminClient
      .from("learning_objects")
      .insert({
        org_id: org.orgId,
        kind: "content",
        title: "The entry sequence",
        description: "The required checks before entering.",
        status: "published",
        version: 1,
        source: "authored",
        course_specification_id: spec.data.id,
      })
      .select("id")
      .single();
    if (learningObject.error) throw learningObject.error;

    const link = await adminClient.from("lesson_learning_objects").insert({
      org_id: org.orgId,
      lesson_id: lesson.data.id,
      learning_object_id: learningObject.data.id,
      sequence: 0,
    });
    if (link.error) throw link.error;
  }, 60_000);

  afterAll(async () => {
    if (org) await cleanupOrg(org);
  });

  it("retrieves the relevant published passage and answers with a real AICredits citation", async () => {
    const result = await answerTutorQuestion(adminClient, {
      orgId: org.orgId,
      userId: org.userId,
      question: "What must I check and do before opening the nebula chamber hatch?",
    });

    expect(result.provider).toBe("aicredits");
    expect(result.grounded).toBe(true);
    expect(result.answer.toLowerCase()).toContain("blue pressure seal");
    expect(result.answer.toLowerCase()).toContain("copper lever");
    expect(result.citations.some((citation) => citation.courseTitle === "Nebula Chamber Safety")).toBe(true);
  }, 180_000);

  it("declines a question the published course does not answer", async () => {
    const retrieved = await retrievePublishedKnowledge(adminClient, {
      orgId: org.orgId,
      userId: org.userId,
      question: "What are the tax filing deadlines for a corporation in Brazil?",
    });
    const result = await answerTutorQuestion(adminClient, {
      orgId: org.orgId,
      userId: org.userId,
      question: "What are the tax filing deadlines for a corporation in Brazil?",
    });

    expect(retrieved.length).toBe(0);
    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.provider).toBeNull();
  }, 120_000);
});
