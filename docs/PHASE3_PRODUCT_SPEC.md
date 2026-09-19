# Phase 3 — Product Specification: AI-Native Authoring Engine

**Deliverable B.** What Phase 3 is, for whom, and where its boundaries are. No implementation.

## 1. The target experience

```
Prompt / PDF / DOCX / PPT / URL
        ↓
AI instructional-design engine
        ↓
Structured course specification  ← validated, human-reviewable, the contract
        ↓
Visual authoring engine          ← author edits, never edits raw JSON
        ↓
Interactive course
        ↓
Assessment → Skills mapping → Publish (SCORM / xAPI / cmi5 / native)
```

The defining claim: **an author starts from intent or source material, not from a blank canvas, and never loses the ability to take full manual control.** AI produces a first draft of a *specification*; a human shapes it in a visual editor; the platform renders and publishes it.

## 2. Why the specification sits in the middle

The single most important product decision in Phase 3, and the one the rest of the architecture depends on:

**The AI generates a validated structured course specification — never application code, never raw HTML, never a rendered artifact.**

Consequences, all deliberate:

- **Reviewable.** A spec can be diffed, validated, versioned, and approved. Generated code cannot be meaningfully reviewed by an instructional designer.
- **Safe.** A schema-constrained document cannot introduce script execution, exfiltrate data, or break tenant isolation. Generated code could.
- **Portable.** One spec renders to the in-app player, a SCORM package, a cmi5 package, or a future native app. Generated HTML would bind us to one target.
- **Model-agnostic.** Any provider that can produce schema-valid JSON can drive the engine. Nothing about the spec assumes a specific model or vendor.
- **Editable.** The visual editor reads and writes the same spec the AI produced, so AI-generated and hand-authored content are the same kind of thing — not two parallel systems that drift.

This is also why AI failure is survivable: if generation is poor, the author still has a full manual authoring tool. The AI is an accelerator on a product that works without it.

## 3. Personas and jobs

| Persona | Job in Phase 3 |
|---|---|
| **Instructional designer / author** | Turn source material or intent into a structured, interactive course without writing code |
| **SME reviewer** | Review and approve generated/authored content before it reaches learners |
| **Org admin** | Govern templates, components, publishing targets, and who may publish |
| **Learner** | Experience the result as an interactive course (Phase 3 delivers the runtime; enrolment/progress already exist) |

## 4. Scope — in

1. **AI course generation** from prompt, PDF, DOCX, PPT, or URL, producing a validated course specification.
2. **Course specification** — a versioned, schema-validated intermediate representation covering structure, blocks, interactions, assessment items, accessibility metadata, localization slots, and skill tags.
3. **Visual authoring engine** — block-based (Rise-class) editing plus an interaction/state/variable/trigger/layer/timeline model (Storyline-class), operating directly on the specification.
4. **Component library and templates** — org-scoped reusable blocks and course starting points.
5. **Interactive runtime player** — renders the specification in-app, emits xAPI statements, records progress.
6. **Publishing pipeline** — native (in-app), SCORM 1.2/2004, xAPI, cmi5.
7. **Accessibility** — authoring affordances and runtime output targeting WCAG 2.2 AA.
8. **Localization scaffolding** — the spec carries locale-addressable strings from day one (translation workflow itself is later).
9. **Skill tagging** — the spec carries skill annotations (the proficiency engine is Phase 6).
10. **Model-agnostic AI gateway** — provider/model routing per workload, schema validation, cost and usage logging.

## 5. Scope — explicitly out (and why)

| Out of Phase 3 | Why | Where it goes |
|---|---|---|
| Standalone question bank, attempts, scoring engine | Phase 3 needs *in-content* quiz blocks only; the full engine is a distinct domain | Phase 4 |
| AI Tutor / RAG assistant | Depends on published content existing at volume | Phase 4 |
| Full LRS (query API, federation, retention) | Emission is enough to be standards-correct now | Phase 6 |
| Skills proficiency computation | Needs assessment + progress data to be meaningful | Phase 6 |
| Real-time multi-author collaboration | Requires new infrastructure (CRDT/OT, presence); single-author locking is sufficient now | Phase 6 |
| Translation workflow / TMS integration | Spec carries locale slots; the workflow is a separate product surface | Phase 6 |
| Mobile app / offline authoring or playback | Runtime is responsive web in Phase 3 | Phase 8 |
| Content marketplace | Needs authoring maturity and billing | Phase 9 |
| Free-form canvas *editor* and animation *timeline editor* | Two substantial editor surfaces on top of two already-XL steps. **The spec models both from v1** so they land additively | **3B** |
| Media production — transcoding, caption editor, TTS, audio editing | Distinct engineering (and a provider decision), separable from the authoring engine | **3B** |
| Stock asset / illustrated character library | A licensing and content-operations decision, not engineering | **3B** |

## 6. Product principles

1. **AI drafts, humans approve.** Nothing AI-generated reaches a learner without passing the existing Draft→Review→Approval→Published workflow. This is already enforced in Phase 2 and is inherited unchanged.
2. **The author is never trapped.** Any AI-generated course is fully editable by hand. There is no "AI-only" content type.
3. **The spec is the product's contract.** Editor, renderer, publisher, and AI all read and write the same validated document.
4. **Accessibility is authored, not retrofitted.** Alt text, reading order, captions, and keyboard semantics are fields in the spec, surfaced in the editor, and validated before publish.
5. **Standards are an export concern, not a data-model concern.** The internal model is ours; SCORM/xAPI/cmi5 are output adapters. We never let an export format dictate the authoring model.
6. **Tenancy discipline is unchanged.** Every new entity carries `org_id` and the four-policy RLS shape in the same migration that creates it — the rule that has held since Phase 1.

## 7. Success criteria for Phase 3

Phase 3 is done when all of the following are true, each demonstrable rather than asserted:

1. A PDF, DOCX, PPT, URL, or prompt produces a **schema-valid** course specification, with validation failures surfaced to the author rather than silently repaired.
2. An author can build, from scratch and without AI, a course containing: multiple block types, a reusable component, a branching scenario, a variable-driven trigger, a state change, a layer, and a quiz block.
3. The same course renders correctly in the in-app player, keyboard-navigable and screen-reader-usable, meeting WCAG 2.2 AA on the authored output.
4. The same course exports as a **SCORM 2004 package that runs in a third-party LMS**, and as a **cmi5/xAPI package that emits valid statements**.
5. Publishing writes an immutable version snapshot, and an in-progress learner continues on the version they started (the Phase 2 guarantee, extended to authored content).
6. AI generation runs through the gateway against **at least two different providers**, selected by configuration rather than code change, with every call logged to `ai_usage_log`.
7. Tenant isolation holds across every new entity, proven at both the data layer and through real routes — the same bar Phase 2 met.

## 8. Non-goals worth stating explicitly

- Phase 3 does not attempt feature parity with Articulate's desktop tooling (Storyline's full timeline animation editor, complex motion paths, the media production suite). **As of 2026-08-16 that parity is a committed goal — it is simply 3B rather than Phase 3**, and Phase 3's schema is widened so it arrives additively. The capability checklist ([AUTHORING_CAPABILITY_CHECKLIST.md](AUTHORING_CAPABILITY_CHECKLIST.md)) states precisely what is targeted in each phase.
- Phase 3 does not replace the Phase 2 forms-based authoring UI on day one; both coexist until the visual engine covers every case, at which point the older UI is retired deliberately rather than left to rot.
