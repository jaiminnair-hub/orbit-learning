# Phase 3 — Data Model Changes Required

**Deliverable D.** Every schema change Phase 3 needs. Conceptual — column names indicative, not final. No migrations written.

## 1. Change classification

| Class | Count | Risk |
|---|---|---|
| New tables | 9 | Low — additive, standard tenancy pattern |
| Altered existing tables | 2 (`learning_objects`, `content_versions`) | Low — both additive columns / new enum values |
| Storage buckets | 1 new (`published-packages`) | Low |
| Rewrites of existing tables | **0** | — |

**No Phase 1 or Phase 2 table is restructured.** The two alterations are an added nullable column and an added check-constraint value.

## 2. New tables

### 2.1 `course_specifications`
The versioned specification document — the contract between AI, editor, renderer, and publisher.

| Column | Notes |
|---|---|
| `id`, `org_id`, `created_at`, `updated_at`, `created_by` | Standard tenant pattern |
| `title` | Denormalised for listing without parsing the spec |
| `spec` `jsonb` | The document itself |
| `spec_schema_version` `text` | Which schema version `spec` conforms to — required for safe evolution |
| `status`, `version` | Reuses the Phase 2 workflow state machine verbatim |
| `source_kind` | `prompt` \| `pdf` \| `docx` \| `pptx` \| `url` \| `manual` |
| `source_asset_id` | FK → `content_assets`, nullable (null for prompt/manual) |
| `generated_by_job_id` | FK → `authoring_jobs`, nullable — provenance for AI-generated specs |
| `locale` | Primary locale; translations are sibling rows in Phase 6 |
| `deleted_at` | Soft delete, per [DATABASE.md](DATABASE.md) §8 |

RLS: standard four-policy, writes at `org_admin`.
Index: `(org_id, status)`, plus a generated `tsvector` over extracted spec text for the existing search.

### 2.2 `component_definitions`
Org-scoped reusable blocks (Rise-style "saved blocks" / Storyline-style shared objects).

| Column | Notes |
|---|---|
| standard tenant columns | |
| `name`, `description` | |
| `definition` `jsonb` | A block subtree conforming to the block schema |
| `spec_schema_version` | Same versioning discipline |
| `status`, `version` | Workflow applies — components are reviewable content |
| `category` | For library organisation |

**Referenced, not copied**: a `component` block in a spec holds a `component_definition_id`, so updating a component propagates on next publish — mirroring learning-object reuse.

### 2.3 `course_templates`
Starting points for new courses.

| Column | Notes |
|---|---|
| standard tenant columns | |
| `name`, `description`, `thumbnail_asset_id` | |
| `spec` `jsonb`, `spec_schema_version` | A whole-course skeleton |
| `status`, `version` | |

### 2.4 `authoring_jobs`
Long-running AI generation as a durable job, not a request.

| Column | Notes |
|---|---|
| standard tenant columns | |
| `kind` | `generate_course` \| `generate_items` \| `translate` (reserved) \| `publish_package` |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` \| `cancelled` |
| `input` `jsonb` | Source refs, prompt, options, requested model/profile |
| `output` `jsonb` | Resulting spec id, or package id |
| `steps` `jsonb` | Per-step status — generation is multi-step and partially recoverable |
| `error` `text` | |
| `started_at`, `finished_at` | |

RLS: select for org members, insert/update at `org_admin`; the worker writes via service role.

### 2.5 `published_packages`
An exported, immutable distributable.

| Column | Notes |
|---|---|
| standard tenant columns | |
| `course_specification_id` | FK |
| `spec_version` `int` | Which version was packaged — immutable provenance |
| `format` | `scorm12` \| `scorm2004` \| `xapi` \| `cmi5` |
| `storage_path` | In the new `published-packages` bucket |
| `manifest` `jsonb` | Format-specific metadata |
| `checksum`, `file_size` | |
| `built_by_job_id` | FK → `authoring_jobs` |

Never updated after creation — a rebuild produces a new row.

### 2.6 `course_runtime_state`
Resumable interaction state. **Deliberately separate from `progress`**, which stays the completion ledger it is today (see [PHASE3_TECHNICAL_ARCHITECTURE.md](PHASE3_TECHNICAL_ARCHITECTURE.md) §4.3a).

| Column | Notes |
|---|---|
| `id`, `org_id`, `user_id`, `created_at`, `updated_at` | |
| `course_specification_id`, `spec_version` | State is version-scoped — a learner resuming after a republish is not fed state from a different structure |
| `enrollment_id` | Nullable FK |
| `current_page_id` | Resume position |
| `variables` `jsonb` | Runtime variable values |
| `block_states` `jsonb` | Visited/completed/state-name per block |
| `completed_at` | |

Unique: `(org_id, user_id, course_specification_id, spec_version)`.
RLS: learner reads/writes own row (`user_id = auth.uid()`); managers read org rows — the same shape already used by `progress` and `scorm_progress`.

### 2.7 `xapi_statements`
Emitted learning-experience statements. Append-only.

| Column | Notes |
|---|---|
| `id` `uuid` (statement id), `org_id`, `created_at` | |
| `actor` `jsonb`, `verb` `jsonb`, `object` `jsonb`, `result` `jsonb`, `context` `jsonb` | xAPI shape |
| `stored_at`, `timestamp` | |
| `source` | `native_player` \| `published_package` \| `external` |
| `registration` `uuid` | Groups statements for one attempt |

RLS: select for org members with `manager`+ (it is behavioural data), insert via authenticated learner or service role. **No update, no delete policy** — statements are immutable, like `activity_log`.
Index: `(org_id, timestamp desc)`, `(org_id, registration)`.

### 2.8 `skill_tags`
Minimal Phase 3 vocabulary so authored content is skill-annotated from day one, with **no proficiency logic** (that is Phase 6).

| Column | Notes |
|---|---|
| standard tenant columns | |
| `name`, `description`, `external_ref` | `external_ref` reserved for future taxonomy import |

Unique `(org_id, name)`. Specs reference tags by id in `spec.skills[]`.

> Deliberately named `skill_tags`, not `skills`, so the Phase 6 Skills engine can define `skills` with proficiency semantics without colliding with or inheriting Phase 3's simpler concept.

### 2.9 `spec_validation_reports`
Why a spec was rejected or flagged — needed because AI output is validated, and authors must see *what* failed.

| Column | Notes |
|---|---|
| standard tenant columns | |
| `course_specification_id`, `spec_version` | |
| `kind` | `schema` \| `semantic` \| `accessibility` \| `publish_readiness` — widened from this doc's original 3-value list during step 4 implementation to match `lib/spec/findings.ts`'s already-shipped `FindingKind` type verbatim; `validate.ts` runs structural and semantic passes in one call and this column has to be able to store both |
| `severity` | `error` \| `warning` \| `info` |
| `findings` `jsonb` | Path-addressed messages, so the editor can deep-link to the offending block |

## 3. Altered existing tables

### 3.1 `learning_objects` — add a source discriminator

```
ALTER: add column source text NOT NULL DEFAULT 'assets'
       CHECK (source IN ('assets', 'authored', 'scorm'))
ALTER: add column course_specification_id uuid NULL REFERENCES course_specifications(id)
```

**Why this and not a new parallel entity:** the learning object is the reuse unit for the whole content model. Making authored content a *kind of learning object* means it is immediately reusable across lessons and courses via the existing `lesson_learning_objects` join, with zero change to that table, to `modules`, to `lessons`, or to `courses`.

Existing rows default to `'assets'` and behave exactly as today — this is why the default matters.

### 3.2 `content_versions` — accept new entity types

```
ALTER: check constraint on entity_type gains
       'course_specification', 'component_definition'
```

Purely an added enum value. The polymorphic design from Phase 2 step 3 was built for precisely this.

## 4. Storage

| Bucket | Purpose | Access |
|---|---|---|
| `content-assets` (exists) | Source files, SCORM ingest, extracted SCORM | Private; server-mediated signed URLs |
| **`published-packages`** (new) | Built SCORM/xAPI/cmi5 packages | Private; `org_id/...` prefix; signed download only |

Same discipline as Phase 2: private bucket, no `storage.objects` policy, every read and write mediated server-side.

## 5. What is deliberately NOT added in Phase 3

| Not added | Why | When |
|---|---|---|
| `question_bank`, `assessments`, `assessment_attempts`, `attempt_answers` | Phase 3 carries inline items in the spec; the standalone engine is its own domain | Phase 4 |
| `ai_knowledge_chunks` (pgvector) | RAG belongs with the AI Tutor | Phase 4 |
| `skills`, `role_skill_requirements`, `user_skill_proficiency` | Proficiency needs assessment data to be meaningful | Phase 6 |
| Any People Intelligence entity | Ordering constraint holds | Phases 6–7 |
| Translation/locale tables | Spec carries locale slots; workflow is separate | Phase 6 |

## 6. Migration ordering

Each migration creates its tables **and** their RLS policies together — the rule that has held since Phase 1 and is not relaxed here.

1. `skill_tags` (no dependencies)
2. `course_specifications` (+ tsvector, + search index)
3. `component_definitions`, `course_templates`
4. `learning_objects` alteration (after `course_specifications` exists for the FK)
5. `authoring_jobs`
6. `spec_validation_reports`
7. `course_runtime_state`
8. `published_packages` + `published-packages` bucket
9. `xapi_statements`
10. `content_versions` constraint extension

## 7. Tenant-isolation test additions

Every new table gets its row in both suites in the same step it ships, per the Phase 2 discipline — including the two that are easy to overlook:

- **`xapi_statements`** — behavioural data is among the most sensitive in the platform; cross-org read must be proven denied.
- **`published_packages`** — a signed download URL must never be issuable for another org's package.
