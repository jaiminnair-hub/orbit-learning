# Course specification (`lib/spec/`)

Phase 3, step 2 of [`DEVELOPMENT_SEQUENCE_PHASE3.md`](../../docs/DEVELOPMENT_SEQUENCE_PHASE3.md). The contract between the AI, the visual editor, the runtime interpreter, and every publish target — per [`PHASE3_TECHNICAL_ARCHITECTURE.md`](../../docs/PHASE3_TECHNICAL_ARCHITECTURE.md) §2.

No UI, no AI, no database migration in this step. Just the shape of the document and its validator, built and proven before anything is built on top of it.

## Files

| File | Contents |
|---|---|
| `primitives.ts` | Shared leaves: ids, rich text (structured, never HTML), links, accessibility fields, provenance |
| `layout.ts` | Page layout (flow default, canvas opt-in) and `Position` — the **3B accommodation** |
| `timeline.ts` | Cue points and animation (`entrance`/`exit`/`emphasis`/`motion`) — the other **3B accommodation** |
| `interactions.ts` | States, variables, triggers, conditions, actions — a closed declarative set |
| `items.ts` | Inline assessment items (MCQ, multi-response, true/false, fill-blank, sequencing) |
| `blocks.ts` | The 24-type closed block set, depth-bounded by construction |
| `course-spec.ts` | The top-level document: meta, theme, sections, pages |
| `version.ts` | `SPEC_SCHEMA_VERSION` and the supported-version contract |
| `validate.ts` | Two-layer validation: structural (Zod) then semantic (referential integrity) |
| `json-schema.ts` | Emits JSON Schema from the Zod schemas — whole-document and narrow per-generation-step |
| `findings.ts` | The `Finding`/`ValidationReport` shape, pre-sized for `spec_validation_reports` |
| `index.ts` | The intended import surface |

## Why Zod, not hand-written JSON Schema + ajv

Two consumers need the same shape: TypeScript (the editor, the interpreter, every route) and JSON Schema (AI structured output, `courseSpecJsonSchema()` for tooling). Maintaining both by hand guarantees they drift, silently.

**ajv was the natural first choice and was rejected.** It compiles a schema to JavaScript via `new Function` at runtime; Cloudflare Workers block dynamic code evaluation. ajv's standalone-precompile mode exists for exactly this case, but it adds a build step to the single most load-bearing artifact in the phase. Zod validates without codegen and needs nothing Workers-specific.

**Every object is `z.strictObject`, not the Zod default.** Zod strips unknown keys by default; the JSON Schema this package emits says `additionalProperties: false`. Those two behaviours disagreeing would mean a validator that silently drops a hallucinated field instead of rejecting it — the schema and the runtime enforcing different documents. `tests/spec/course-spec.test.ts` asserts unknown keys are rejected, not stripped.

## Why the block tree cannot recurse

Containers (accordion items, tabs, flashcards) hold rich text and an optional image reference — not arbitrary nested blocks. Layers hold `LeafBlock`s, which cannot themselves carry layers. This mirrors what Rise and Storyline actually let an author nest, and it keeps the JSON Schema non-recursive, which several providers' structured-output modes handle unreliably. `Block` is built by extending each of the 24 leaf variants with an optional `layers` field rather than intersecting the union with `{ layers }` — an intersection would emit `allOf` in the JSON Schema, and since every branch closes `additionalProperties`, no document carrying `layers` could validate against the schema this package publishes.

## Why the interaction model has no expression language

Triggers are `{ when, onId, condition, actions }`, where every field is a closed enum or a reference to something else in the document. There is no formula field, no script hook, no regex in `fillBlank` accepted answers. This is what makes "an injected instruction cannot produce a valid spec that does something else" ([`PHASE3_AI_ARCHITECTURE.md`](../../docs/PHASE3_AI_ARCHITECTURE.md) §7) true by construction rather than by sanitisation — verified directly by a test that greps the emitted schema for `script`, `html`, `onClick`, `eval`, and similar, and asserts none of them appear anywhere.

## The 3B accommodation, and what "accommodation" actually means

The scope decision of 2026-08-16 committed to full authoring parity, landing in Phase 3B. The consequence for this step: `layout.ts`'s `CanvasLayout`/`Position` and `timeline.ts`'s `Animation`/`MotionPath` exist from v1, even though **no Phase 3 editor produces them**. Adding them after the runtime interpreter (step 5) and the visual editor (step 6) exist would mean a spec migration plus a rewrite of both — the exact failure "schema first" ordering exists to prevent.

`tests/spec/fixtures/valid-canvas-timeline.json` exercises the whole path — canvas layout, absolute positioning, a cue point, and a motion-path animation — precisely so that if this path is ever broken by a later change, a test fails immediately rather than the gap surfacing mid-3B.

**The stance that survives the widening:** flow layout is still the default and the recommendation. Canvas is opt-in, and the validator enforces the pairing in both directions — `POSITION_ON_FLOW_PAGE` and `MOTION_PATH_ON_FLOW_PAGE` reject coordinates on a page that has no frame to interpret them against, rather than silently ignoring authoring intent that cannot mean anything.

## Semantic validation

JSON Schema proves shape. It cannot prove a trigger's `blockId` names a block that exists in *this* document — that is referential integrity, checked in a second pass (`validate.ts`) after the structural parse succeeds. The checks: duplicate ids (one namespace across sections, pages, blocks, layers, cue points, and interactive sub-elements like hotspot markers and accordion items — because `trigger.onId` is untyped and may name any of them), trigger sources and action targets, condition operands, canvas/flow layout consistency, timeline track and animation bounds, sorting-category and scenario-branch integrity, MCQ answer-key sanity, and a same-origin allowlist on rich-text link schemes (`http`, `https`, `mailto`, plus in-course `/` and `#` links — rejecting `javascript:` and `data:`).

Findings are path-addressed (`pointer()` builds RFC 6901 JSON Pointers) with denormalised `sectionId`/`pageId`/`blockId`, so the editor can deep-link to the offending block rather than reporting "something is wrong somewhere." The shape matches `spec_validation_reports` (`PHASE3_DATA_MODEL.md` §2.9) exactly, ahead of that table existing, so step 4's migration has a known target rather than an invented one.

## Generation schemas are narrow, deliberately

`generationSchemas` exposes one small schema per pipeline step (outline, objectives, one page's blocks, items) rather than the whole `CourseSpec`. This mirrors [`PHASE3_AI_ARCHITECTURE.md`](../../docs/PHASE3_AI_ARCHITECTURE.md) §5: a model asked for one page's blocks produces more reliable output than one asked for an entire course in one call, a validation failure costs one step rather than the whole run, and an author can regenerate a single step without touching the rest. A test asserts the outline schema is meaningfully smaller than the whole-document schema, as a structural guard against that discipline eroding.

## What this step deliberately does not do

Named so it isn't mistaken for done:

| Not done | Why | When |
|---|---|---|
| A database migration for `course_specifications` / `spec_validation_reports` | Data model + tenancy is step 4 | Step 4 |
| A real AI call against the generation schemas | This step proves the contract, not the model | Step 7 (AI gateway) |
| The runtime interpreter reading a spec | Step 5, deliberately after the schema is settled | Step 5 |
| The visual editor writing a spec | Step 6, reuses step 5's interpreter as its preview | Step 6 |
| Accessibility as a hard publish gate | Alt-text/caption findings exist now as warnings; gating publish on them is step 10 | Step 10 |
