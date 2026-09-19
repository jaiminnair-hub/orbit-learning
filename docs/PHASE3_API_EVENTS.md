# Phase 3 — API and Event Requirements

**Deliverable E.** Routes and events Phase 3 introduces. Conventions inherited from [API_SPEC.md](API_SPEC.md) without change: `/api/v1/...`, `withAuth()` wrapper, standard success/error envelope, role gates enforced at both API and RLS layers.

## 1. Authoring — specifications

| Method | Route | minRole | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/authoring/specs` | `org_admin` | List specifications (filter by status) |
| `POST` | `/api/v1/authoring/specs` | `org_admin` | Create blank / from template |
| `GET` | `/api/v1/authoring/specs/[id]` | `org_admin` | Full spec document |
| `PATCH` | `/api/v1/authoring/specs/[id]` | `org_admin` | Update spec (whole or JSON-Patch); **validates before write** |
| `POST` | `/api/v1/authoring/specs/[id]/validate` | `org_admin` | Validate without saving → `spec_validation_reports` |
| `POST` | `/api/v1/authoring/specs/[id]/publish` | `org_admin` | Workflow transition, reusing `lib/content/publish.ts` |
| `GET` | `/api/v1/authoring/specs/[id]/versions` | `org_admin` | Version history (extends the Phase 2 versions route) |
| `POST` | `/api/v1/authoring/specs/[id]/duplicate` | `org_admin` | Copy as new draft |

**PATCH semantics matter.** Autosave from a block editor is frequent and partial. Recommendation: accept a JSON-Patch document and apply server-side with optimistic concurrency (`If-Match` on `updated_at` or a `revision` counter), returning `409` on conflict. Last-write-wins on a whole-document PUT would silently lose concurrent edits.

## 2. Authoring — components and templates

| Method | Route | minRole | Purpose |
|---|---|---|---|
| `GET`/`POST` | `/api/v1/authoring/components` | `org_admin` | Library list / create |
| `GET`/`PATCH`/`DELETE` | `/api/v1/authoring/components/[id]` | `org_admin` | Manage a component |
| `POST` | `/api/v1/authoring/components/[id]/publish` | `org_admin` | Workflow transition |
| `GET`/`POST` | `/api/v1/authoring/templates` | `org_admin` | Template list / create |
| `GET` | `/api/v1/authoring/templates/[id]` | `org_admin` | Template detail |

## 3. AI generation

| Method | Route | minRole | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/ai/authoring/generate` | `org_admin` | Start generation → returns `authoring_jobs` id |
| `GET` | `/api/v1/ai/authoring/jobs/[id]` | `org_admin` | Poll job status + per-step progress |
| `GET` | `/api/v1/ai/authoring/jobs/[id]/stream` | `org_admin` | SSE progress (optional; polling is the baseline) |
| `POST` | `/api/v1/ai/authoring/jobs/[id]/cancel` | `org_admin` | Cancel a running job |
| `POST` | `/api/v1/ai/authoring/regenerate` | `org_admin` | Regenerate one section/page/block, not the whole course |

**Asynchronous by design.** Generation over a large PDF exceeds a request lifetime and Workers CPU limits. The route accepts and returns a job id; it never blocks. Partial regeneration matters as much as full generation — authors iterate on one section far more often than they regenerate everything.

## 4. Publishing

| Method | Route | minRole | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/publishing/packages` | `org_admin` | Build a package (`format` in body) → job id |
| `GET` | `/api/v1/publishing/packages` | `org_admin` | List built packages |
| `GET` | `/api/v1/publishing/packages/[id]/download` | `org_admin` | Short-lived signed URL |

Package building is a job for the same reason generation is: zipping a course with media is not a request-time operation.

## 5. Runtime (learner-facing)

| Method | Route | minRole | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/runtime/courses/[specId]` | *authenticated* | Published spec for playback (published version only, unless author previewing) |
| `GET`/`PUT` | `/api/v1/runtime/courses/[specId]/state` | *authenticated* | Resume state — learner's own row only |
| `POST` | `/api/v1/runtime/xapi/statements` | *authenticated* | Emit statement(s) |

**No `minRole`** on these three, deliberately — learners must reach them. RLS scopes every one, exactly as the Phase 2 player routes do.

**Preview access.** An author previewing a draft needs the unpublished spec. Rather than weakening the runtime route, preview passes an explicit `?preview=true`, which the route honours **only** when the caller passes the `org_admin` check — so a learner cannot request a draft by adding a query parameter.

## 6. xAPI endpoint conformance

Phase 3 emits statements; it is not yet a conformant LRS.

| Phase 3 | Phase 6 (full LRS) |
|---|---|
| `POST /statements` (store) | `GET /statements` with full filtering |
| Basic actor/verb/object/result/context | State/Activity/Agent Profile resources |
| Our own package endpoints | External LRS federation; conformance test suite |

Stating this split explicitly prevents claiming LRS conformance we have not earned.

## 7. Events

Two distinct streams, deliberately not merged:

### 7.1 `activity_log` — platform/audit events
Reuses the existing table and its generic `event_type` discriminator. No schema change.

| `event_type` | When |
|---|---|
| `spec.created` / `spec.updated` / `spec.published` / `spec.archived` | Authoring lifecycle |
| `spec.validation_failed` | A publish attempt blocked by validation |
| `component.published` | Library change |
| `ai.generation_started` / `ai.generation_succeeded` / `ai.generation_failed` | Generation lifecycle |
| `package.built` / `package.downloaded` | Publishing and distribution |

### 7.2 `xapi_statements` — learning-experience events
Learner behaviour, xAPI-shaped, emitted by the runtime.

| Verb | When |
|---|---|
| `initialized` / `terminated` | Course session boundaries |
| `progressed` | Page/block completion |
| `experienced` | Block viewed |
| `answered` | Quiz/knowledge-check response |
| `completed` / `passed` / `failed` | Course outcome |
| `interacted` | Interaction engaged (branching choice, state change) |

**Why separate:** `activity_log` answers *"what did the platform do, and who did it?"* for audit; xAPI answers *"what did the learner experience?"* for learning analytics. Conflating them would make both worse — and `activity_log` is already documented as the consolidation of an earlier project's four log tables; adding learner telemetry to it would recreate the problem it exists to solve.

## 8. Rate limiting and quotas

| Surface | Control |
|---|---|
| AI generation | Per-org concurrent job cap + monthly token/cost budget, enforced at the gateway |
| Spec autosave | Per-user write throttle; batched patches |
| Package building | Per-org concurrent build cap |
| xAPI ingest | Per-org statement rate limit (a misbehaving package must not flood the table) |

## 9. Backward compatibility

- No existing route changes signature or behaviour.
- `/api/v1/content/*` (Phase 2) continues to serve asset/learning-object/course management unchanged.
- The Phase 2 course player continues to work for `source = 'assets'` and `source = 'scorm'` learning objects; the new interactive runtime handles `source = 'authored'`. Both coexist behind the same player entry point.
