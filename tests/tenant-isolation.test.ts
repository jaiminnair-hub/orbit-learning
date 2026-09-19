// Phase 1 tenant-isolation suite — docs/TESTING.md §4-5, docs/DEFINITION_OF_DONE.md.
// Covers every table that exists as of Phase 1's schema (docs/DATABASE.md §2, §6).
// Each later phase adds its own tables to this same suite as they ship —
// this is the first installment, not a one-time complete test.
//
// Runs against the local, disposable Supabase instance (`supabase start`),
// never the real project — deterministic, safe to reseed every run.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  seedOrgWithUser,
  cleanupOrg,
  makePlatformAdmin,
  adminClient,
  type SeededOrg,
} from "./setup/seed";

describe("Phase 1 tenant isolation", () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let platformAdmin: SeededOrg;

  beforeAll(async () => {
    orgA = await seedOrgWithUser("a");
    orgB = await seedOrgWithUser("b");
    platformAdmin = await seedOrgWithUser("platform-admin");
    await makePlatformAdmin(platformAdmin.userId);
  }, 30_000);

  afterAll(async () => {
    await cleanupOrg(orgA);
    await cleanupOrg(orgB);
    await cleanupOrg(platformAdmin);
  });

  it("Org A cannot read Org B's organization row", async () => {
    const { data, error } = await orgA.client.from("organizations").select("*").eq("id", orgB.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's profiles", async () => {
    const { data, error } = await orgA.client.from("profiles").select("*").eq("org_id", orgB.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's departments", async () => {
    const { data: dept, error: seedError } = await adminClient
      .from("departments")
      .insert({ org_id: orgB.orgId, name: "Dept B" })
      .select()
      .single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("departments").select("*").eq("id", dept!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot create a department inside Org B", async () => {
    const { error } = await orgA.client.from("departments").insert({ org_id: orgB.orgId, name: "Malicious dept" });
    expect(error).not.toBeNull();
  });

  it("Org A cannot read Org B's invitations", async () => {
    const { error: seedError } = await adminClient.from("org_invitations").insert({
      org_id: orgB.orgId,
      email: "invitee@example.test",
      role: "learner",
      token: crypto.randomUUID(),
    });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("org_invitations").select("*").eq("org_id", orgB.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's subscription", async () => {
    const { data: plan } = await adminClient.from("plans").select("id").limit(1).maybeSingle();
    let planId = plan?.id;
    if (!planId) {
      const { data: newPlan, error } = await adminClient
        .from("plans")
        .insert({ name: `test-plan-${crypto.randomUUID().slice(0, 8)}`, tier: "free" })
        .select()
        .single();
      expect(error).toBeNull();
      planId = newPlan!.id;
    }
    const { error: seedError } = await adminClient
      .from("subscriptions")
      .insert({ org_id: orgB.orgId, plan_id: planId, status: "active" });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("subscriptions").select("*").eq("org_id", orgB.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's activity log", async () => {
    const { error: seedError } = await adminClient
      .from("activity_log")
      .insert({ org_id: orgB.orgId, event_type: "test.event" });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("activity_log").select("*").eq("org_id", orgB.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // Phase 2 (step 1) extends this suite with content_assets, exactly as
  // this file's header anticipated — each phase adds its own tables here
  // rather than starting a separate suite.
  it("Org A cannot read Org B's content assets", async () => {
    const { data: asset, error: seedError } = await adminClient
      .from("content_assets")
      .insert({ org_id: orgB.orgId, type: "pdf", storage_path: `${orgB.orgId}/isolation-test.pdf` })
      .select()
      .single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("content_assets").select("*").eq("id", asset!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot create a content asset inside Org B", async () => {
    const { error } = await orgA.client
      .from("content_assets")
      .insert({ org_id: orgB.orgId, type: "pdf", storage_path: `${orgB.orgId}/should-not-exist.pdf` });
    expect(error).not.toBeNull();
  });

  // Phase 2 step 2 — SCORM tables join the same matrix.
  it("Org A cannot read Org B's SCORM packages", async () => {
    const { data: assetB } = await adminClient
      .from("content_assets")
      .insert({ org_id: orgB.orgId, type: "scorm", storage_path: `${orgB.orgId}/pkg-${Date.now()}.zip` })
      .select().single();

    const { data: pkg, error: seedError } = await adminClient
      .from("scorm_packages")
      .insert({
        org_id: orgB.orgId,
        content_asset_id: assetB!.id,
        title: "Org B private course",
        entry_point: "index.html",
        extracted_prefix: `${orgB.orgId}/scorm/x`,
      })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("scorm_packages").select("*").eq("id", pkg!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a learner cannot read another user's SCORM progress", async () => {
    const { data: assetB } = await adminClient
      .from("content_assets")
      .insert({ org_id: orgB.orgId, type: "scorm", storage_path: `${orgB.orgId}/pkg2-${Date.now()}.zip` })
      .select().single();
    const { data: pkg } = await adminClient
      .from("scorm_packages")
      .insert({
        org_id: orgB.orgId,
        content_asset_id: assetB!.id,
        title: "Org B course 2",
        entry_point: "index.html",
        extracted_prefix: `${orgB.orgId}/scorm/y`,
      })
      .select().single();

    const { error: seedError } = await adminClient.from("scorm_progress").insert({
      org_id: orgB.orgId,
      user_id: orgB.userId,
      scorm_package_id: pkg!.id,
      lesson_status: "completed",
    });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client
      .from("scorm_progress")
      .select("*")
      .eq("scorm_package_id", pkg!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // Phase 2 step 3 — learning objects and their version history.
  it("Org A cannot read Org B's learning objects", async () => {
    const { data: lo, error: seedError } = await adminClient
      .from("learning_objects")
      .insert({ org_id: orgB.orgId, title: "Org B private object" })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("learning_objects").select("*").eq("id", lo!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's published version snapshots", async () => {
    const { data: lo } = await adminClient
      .from("learning_objects")
      .insert({ org_id: orgB.orgId, title: "Org B versioned" })
      .select().single();

    const { error: seedError } = await adminClient.from("content_versions").insert({
      org_id: orgB.orgId,
      entity_type: "learning_object",
      entity_id: lo!.id,
      version_number: 1,
      snapshot: { title: "Org B confidential content" },
    });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client
      .from("content_versions").select("*").eq("entity_id", lo!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // Phase 2 step 4 — the "Org A cannot read Org B's courses" row that
  // DEFINITION_OF_DONE.md has carried as "doesn't apply yet" since Phase 1.
  // It applies now.
  it("Org A cannot read Org B's courses", async () => {
    const { data: course, error: seedError } = await adminClient
      .from("courses")
      .insert({ org_id: orgB.orgId, title: "Org B course", slug: `org-b-course-${Date.now()}` })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("courses").select("*").eq("id", course!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's modules, lessons or lesson-object links", async () => {
    const { data: course } = await adminClient
      .from("courses")
      .insert({ org_id: orgB.orgId, title: "Org B structured", slug: `org-b-struct-${Date.now()}` })
      .select().single();
    const { data: mod } = await adminClient
      .from("modules")
      .insert({ org_id: orgB.orgId, course_id: course!.id, title: "B module", sequence: 0 })
      .select().single();
    const { data: lesson } = await adminClient
      .from("lessons")
      .insert({ org_id: orgB.orgId, module_id: mod!.id, title: "B lesson", sequence: 0 })
      .select().single();
    const { data: lo } = await adminClient
      .from("learning_objects")
      .insert({ org_id: orgB.orgId, title: "B object" })
      .select().single();
    const { error: linkError } = await adminClient.from("lesson_learning_objects").insert({
      org_id: orgB.orgId, lesson_id: lesson!.id, learning_object_id: lo!.id, sequence: 0,
    });
    expect(linkError).toBeNull();

    const mods = await orgA.client.from("modules").select("*").eq("id", mod!.id);
    const les = await orgA.client.from("lessons").select("*").eq("id", lesson!.id);
    const links = await orgA.client.from("lesson_learning_objects").select("*").eq("lesson_id", lesson!.id);
    expect(mods.data).toHaveLength(0);
    expect(les.data).toHaveLength(0);
    expect(links.data).toHaveLength(0);
  });

  it("Org A cannot create a course inside Org B", async () => {
    const { error } = await orgA.client
      .from("courses")
      .insert({ org_id: orgB.orgId, title: "Should not exist", slug: `nope-${Date.now()}` });
    expect(error).not.toBeNull();
  });

  // Phase 2 step 6 — enrolment and progress.
  it("Org A cannot read Org B's enrollments or progress", async () => {
    const { data: course } = await adminClient
      .from("courses")
      .insert({ org_id: orgB.orgId, title: "B enrol course", slug: `b-enrol-${Date.now()}` })
      .select().single();
    const { data: lo } = await adminClient
      .from("learning_objects")
      .insert({ org_id: orgB.orgId, title: "B object for progress" })
      .select().single();

    const { data: enr, error: enrError } = await adminClient
      .from("enrollments")
      .insert({
        org_id: orgB.orgId, user_id: orgB.userId,
        enrollable_type: "course", enrollable_id: course!.id,
      })
      .select().single();
    expect(enrError).toBeNull();

    const { error: progError } = await adminClient.from("progress").insert({
      org_id: orgB.orgId, user_id: orgB.userId,
      learning_object_id: lo!.id, enrollment_id: enr!.id, status: "completed",
    });
    expect(progError).toBeNull();

    const enrs = await orgA.client.from("enrollments").select("*").eq("id", enr!.id);
    const progs = await orgA.client.from("progress").select("*").eq("learning_object_id", lo!.id);
    expect(enrs.data).toHaveLength(0);
    expect(progs.data).toHaveLength(0);
  });

  it("a learner cannot write progress rows attributed to another user", async () => {
    const { data: lo } = await adminClient
      .from("learning_objects")
      .insert({ org_id: orgA.orgId, title: "A object" })
      .select().single();

    // orgA's user trying to record progress as orgB's user
    const { error } = await orgA.client.from("progress").insert({
      org_id: orgA.orgId, user_id: orgB.userId,
      learning_object_id: lo!.id, status: "completed",
    });
    expect(error).not.toBeNull();
  });

  // Phase 2 step 7 — full-text search is still bounded by RLS. A search
  // is just a SELECT, so it must not become a side channel into another
  // org's content.
  it("full-text search never returns another org's courses", async () => {
    const { error: seedError } = await adminClient.from("courses").insert({
      org_id: orgB.orgId,
      title: "Confidential Org B Strategy",
      slug: `org-b-secret-${Date.now()}`,
      description: "Highly distinctive searchable text zebra quokka.",
      status: "published",
    });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client
      .from("courses")
      .select("id, title")
      .textSearch("search_vector", "zebra quokka", { type: "websearch", config: "english" });

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a user cannot self-escalate role via a direct update", async () => {
    // RLS's profiles_update_self permits the update to run (id = auth.uid());
    // the privilege-escalation trigger is what must actually stop it.
    await orgA.client.from("profiles").update({ role: "org_owner" }).eq("id", orgA.userId);

    const { data } = await adminClient.from("profiles").select("role").eq("id", orgA.userId).single();
    expect(data?.role).toBe("learner");
  });

  it("a user cannot move their own profile to another org via a direct update", async () => {
    await orgA.client.from("profiles").update({ org_id: orgB.orgId }).eq("id", orgA.userId);

    const { data } = await adminClient.from("profiles").select("org_id").eq("id", orgA.userId).single();
    expect(data?.org_id).toBe(orgA.orgId);
  });

  it("platform admin CAN read across orgs", async () => {
    const { data, error } = await platformAdmin.client.from("organizations").select("*").eq("id", orgA.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("platform admin cannot write into a tenant's data through the normal tenant-facing path", async () => {
    const { error } = await platformAdmin.client
      .from("departments")
      .insert({ org_id: orgA.orgId, name: "Should not be allowed" });
    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Phase 3 step 4 — the 9 new tables from docs/PHASE3_DATA_MODEL.md,
  // added to this same suite per this file's own header comment: "each
  // later phase adds its own tables to this same suite as they ship."
  // ---------------------------------------------------------------------

  it("Org A cannot read Org B's skill tags", async () => {
    const { data: tag, error: seedError } = await adminClient
      .from("skill_tags")
      .insert({ org_id: orgB.orgId, name: `Org B skill ${Date.now()}` })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("skill_tags").select("*").eq("id", tag!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot create a skill tag inside Org B", async () => {
    const { error } = await orgA.client.from("skill_tags").insert({ org_id: orgB.orgId, name: "Malicious tag" });
    expect(error).not.toBeNull();
  });

  it("Org A cannot read Org B's course specifications", async () => {
    const { data: spec, error: seedError } = await adminClient
      .from("course_specifications")
      .insert({
        org_id: orgB.orgId,
        title: "Org B confidential course",
        spec: { meta: { title: "Org B confidential course" }, sections: [] },
        spec_schema_version: "1.0.0",
      })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("course_specifications").select("*").eq("id", spec!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot create a course specification inside Org B", async () => {
    const { error } = await orgA.client.from("course_specifications").insert({
      org_id: orgB.orgId,
      title: "Malicious spec",
      spec: {},
      spec_schema_version: "1.0.0",
    });
    expect(error).not.toBeNull();
  });

  it("Org A cannot read Org B's component definitions", async () => {
    const { data: comp, error: seedError } = await adminClient
      .from("component_definitions")
      .insert({ org_id: orgB.orgId, name: "Org B component", definition: {}, spec_schema_version: "1.0.0" })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("component_definitions").select("*").eq("id", comp!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's course templates", async () => {
    const { data: tmpl, error: seedError } = await adminClient
      .from("course_templates")
      .insert({ org_id: orgB.orgId, name: "Org B template", spec: {}, spec_schema_version: "1.0.0" })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("course_templates").select("*").eq("id", tmpl!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's authoring jobs", async () => {
    const { data: job, error: seedError } = await adminClient
      .from("authoring_jobs")
      .insert({ org_id: orgB.orgId, kind: "generate_course", input: {} })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("authoring_jobs").select("*").eq("id", job!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot create an authoring job inside Org B", async () => {
    const { error } = await orgA.client.from("authoring_jobs").insert({ org_id: orgB.orgId, kind: "generate_course" });
    expect(error).not.toBeNull();
  });

  it("Org A cannot read Org B's spec validation reports", async () => {
    const { data: spec } = await adminClient
      .from("course_specifications")
      .insert({ org_id: orgB.orgId, title: "Org B spec for report", spec: {}, spec_schema_version: "1.0.0" })
      .select().single();

    const { data: report, error: seedError } = await adminClient
      .from("spec_validation_reports")
      .insert({
        org_id: orgB.orgId,
        course_specification_id: spec!.id,
        spec_version: 1,
        kind: "schema",
        severity: "error",
        findings: [],
      })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("spec_validation_reports").select("*").eq("id", report!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot read Org B's course runtime state", async () => {
    const { data: spec } = await adminClient
      .from("course_specifications")
      .insert({ org_id: orgB.orgId, title: "Org B runtime spec", spec: {}, spec_schema_version: "1.0.0" })
      .select().single();

    const { data: state, error: seedError } = await adminClient
      .from("course_runtime_state")
      .insert({ org_id: orgB.orgId, user_id: orgB.userId, course_specification_id: spec!.id, spec_version: 1 })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("course_runtime_state").select("*").eq("id", state!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a learner cannot write course runtime state attributed to another user", async () => {
    const { data: spec } = await adminClient
      .from("course_specifications")
      .insert({ org_id: orgA.orgId, title: "Org A runtime spec", spec: {}, spec_schema_version: "1.0.0" })
      .select().single();

    // orgA's user trying to record runtime state as orgB's user.
    const { error } = await orgA.client.from("course_runtime_state").insert({
      org_id: orgA.orgId, user_id: orgB.userId, course_specification_id: spec!.id, spec_version: 1,
    });
    expect(error).not.toBeNull();
  });

  it("Org A cannot read Org B's published packages", async () => {
    const { data: spec } = await adminClient
      .from("course_specifications")
      .insert({ org_id: orgB.orgId, title: "Org B spec for package", spec: {}, spec_schema_version: "1.0.0" })
      .select().single();

    const { data: pkg, error: seedError } = await adminClient
      .from("published_packages")
      .insert({
        org_id: orgB.orgId,
        course_specification_id: spec!.id,
        spec_version: 1,
        format: "scorm2004",
        storage_path: `${orgB.orgId}/published/pkg-${Date.now()}.zip`,
      })
      .select().single();
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("published_packages").select("*").eq("id", pkg!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("Org A cannot insert a published package directly - write-restricted to the service role", async () => {
    const { data: spec } = await adminClient
      .from("course_specifications")
      .insert({ org_id: orgA.orgId, title: "Org A spec for package", spec: {}, spec_schema_version: "1.0.0" })
      .select().single();

    const { error } = await orgA.client.from("published_packages").insert({
      org_id: orgA.orgId,
      course_specification_id: spec!.id,
      spec_version: 1,
      format: "scorm2004",
      storage_path: "malicious/path.zip",
    });
    expect(error).not.toBeNull();
  });

  it("Org A cannot read Org B's xAPI statements", async () => {
    const { error: seedError } = await adminClient.from("xapi_statements").insert({
      id: randomUUID(),
      org_id: orgB.orgId,
      actor: { objectType: "Agent", account: { name: "b", homePage: "https://example.test" } },
      verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
      object: { id: "https://example.test/activity", objectType: "Activity" },
      timestamp: new Date().toISOString(),
    });
    expect(seedError).toBeNull();

    // orgA's user is a plain learner in a different org - proves cross-org
    // denial specifically (the role gate is proved separately below).
    const { data, error } = await orgA.client.from("xapi_statements").select("*").eq("org_id", orgB.orgId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a plain learner cannot read xAPI statements even within their own org - manager+ only", async () => {
    const { error: seedError } = await adminClient.from("xapi_statements").insert({
      id: randomUUID(),
      org_id: orgB.orgId,
      actor: { objectType: "Agent", account: { name: "b", homePage: "https://example.test" } },
      verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
      object: { id: "https://example.test/activity-2", objectType: "Activity" },
      timestamp: new Date().toISOString(),
    });
    expect(seedError).toBeNull();

    // orgB.client is a learner by default (seedOrgWithUser never elevates
    // role) - same org as the row above, but must still not see it.
    const asLearner = await orgB.client.from("xapi_statements").select("*").eq("org_id", orgB.orgId);
    expect(asLearner.error).toBeNull();
    expect(asLearner.data).toHaveLength(0);

    // Promote to manager and confirm the SAME row becomes visible - proves
    // the role gate genuinely opens, not that it silently denies everything.
    await adminClient.from("profiles").update({ role: "manager" }).eq("id", orgB.userId);
    const asManager = await orgB.client.from("xapi_statements").select("*").eq("org_id", orgB.orgId);
    expect(asManager.error).toBeNull();
    expect(asManager.data!.length).toBeGreaterThan(0);

    // Revert immediately so later tests in this suite still see orgB as a
    // plain learner, regardless of file run order.
    await adminClient.from("profiles").update({ role: "learner" }).eq("id", orgB.userId);
  });

  it("a learner can insert their own org's xAPI statement", async () => {
    const { error } = await orgA.client.from("xapi_statements").insert({
      id: randomUUID(),
      org_id: orgA.orgId,
      actor: { objectType: "Agent", account: { name: "a", homePage: "https://example.test" } },
      verb: { id: "http://adlnet.gov/expapi/verbs/initialized" },
      object: { id: "https://example.test/activity-3", objectType: "Activity" },
      timestamp: new Date().toISOString(),
    });
    expect(error).toBeNull();
  });

  it("Org A cannot insert an xAPI statement into Org B", async () => {
    const { error } = await orgA.client.from("xapi_statements").insert({
      id: randomUUID(),
      org_id: orgB.orgId,
      actor: { objectType: "Agent" },
      verb: { id: "http://adlnet.gov/expapi/verbs/initialized" },
      object: { id: "https://example.test/activity-4", objectType: "Activity" },
      timestamp: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});

// Orbit Foundation integration — first safe slice, docs/ORBIT_LMS_INTEGRATION_PLAN.md.
// These three tables are written exclusively by the service-role client from
// app/api/orbit/entry/route.ts — never by a tenant session — so the data-layer
// guarantee to prove is that a normal authenticated client gets nothing back
// from any of them, not even its own org's rows. The route-level behavior
// (replay rejection, POST-only, the actual entry redirect flow, and role
// mapping end to end) is covered by tests/e2e/orbit-entry.spec.ts, which
// exercises the real route the same way tests/e2e/publishing.spec.ts does.
describe("Orbit integration — first safe slice", () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    orgA = await seedOrgWithUser("orbit-a");
    orgB = await seedOrgWithUser("orbit-b");
  }, 30_000);

  afterAll(async () => {
    await cleanupOrg(orgA);
    await cleanupOrg(orgB);
  });

  it("a tenant session cannot read orbit_organization_links at all", async () => {
    const { error: seedError } = await adminClient
      .from("orbit_organization_links")
      .insert({ orbit_organization_id: randomUUID(), lms_organization_id: orgB.orgId });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("orbit_organization_links").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a tenant session cannot insert into orbit_organization_links", async () => {
    const { error } = await orgA.client
      .from("orbit_organization_links")
      .insert({ orbit_organization_id: randomUUID(), lms_organization_id: orgA.orgId });
    expect(error).not.toBeNull();
  });

  it("a tenant session cannot read orbit_entry_token_uses at all", async () => {
    const jti = randomUUID();
    const { error: seedError } = await adminClient.from("orbit_entry_token_uses").insert({ jti });
    expect(seedError).toBeNull();

    const { data, error } = await orgA.client.from("orbit_entry_token_uses").select("*").eq("jti", jti);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a tenant session cannot read orbit_role_map at all", async () => {
    const { data, error } = await orgA.client.from("orbit_role_map").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("orbit_role_map seed data maps every current Orbit lms product role exactly as designed", async () => {
    const { data, error } = await adminClient
      .from("orbit_role_map")
      .select("orbit_product_role_key, lms_role")
      .order("orbit_product_role_key");
    expect(error).toBeNull();
    expect(data).toEqual([
      { orbit_product_role_key: "content_author", lms_role: null },
      { orbit_product_role_key: "instructor", lms_role: "learner" },
      { orbit_product_role_key: "l_and_d_admin", lms_role: "org_admin" },
      { orbit_product_role_key: "learner", lms_role: "learner" },
      { orbit_product_role_key: "learning_manager", lms_role: "manager" },
    ]);
  });

  it("orbit_organization_links enforces one LMS org per Orbit org and vice versa", async () => {
    const orbitOrgId = randomUUID();
    const { error: firstLink } = await adminClient
      .from("orbit_organization_links")
      .insert({ orbit_organization_id: orbitOrgId, lms_organization_id: orgA.orgId });
    expect(firstLink).toBeNull();

    // Same Orbit org cannot be linked to a second LMS org (primary key).
    const { error: dupeOrbitOrg } = await adminClient
      .from("orbit_organization_links")
      .insert({ orbit_organization_id: orbitOrgId, lms_organization_id: orgB.orgId });
    expect(dupeOrbitOrg).not.toBeNull();

    // Same LMS org cannot be linked to a second Orbit org (unique constraint).
    const { error: dupeLmsOrg } = await adminClient
      .from("orbit_organization_links")
      .insert({ orbit_organization_id: randomUUID(), lms_organization_id: orgA.orgId });
    expect(dupeLmsOrg).not.toBeNull();
  });
});
