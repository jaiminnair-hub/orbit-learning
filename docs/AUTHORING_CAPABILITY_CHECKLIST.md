# Articulate-Equivalent Capability Checklist

**Deliverable G.** What "Rise + Storyline class" means concretely, and precisely how much of it Phase 3 targets. Honest about what is **in Phase 3** and what is **later** — an unqualified "we'll match Storyline" would be a promise the architecture cannot cash on the Phase 3 timeline.

> **Scope change, 2026-08-16.** The stated goal is now a world-class LMS **and** a world-class authoring tool in one product, so full authoring parity is the target and **nothing here is permanently excluded**. What changed in practice: the rows formerly marked ❌ move to **3B**, and Phase 3's schema must accommodate them from v1 (see [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md) reconciliation note 4). Phase 3's own deliverable is unchanged.

**Legend:** ✅ Phase 3 · 🟡 Phase 3 partial · 📅 Later phase · **3B** Authoring-parity phase · ❌ Not scheduled

---

## 1. Rise-class — responsive block authoring

| Capability | Phase 3 | Notes |
|---|---|---|
| Block-based page composition | ✅ | Core of the spec's `blocks[]` |
| Responsive by construction (no per-breakpoint layout) | ✅ | Blocks are fluid; no absolute positioning in Rise-class content |
| Text blocks (headings, paragraphs, lists, quotes) | ✅ | |
| Image blocks (single, gallery, captioned) | ✅ | |
| Video / audio blocks | ✅ | From content library or embed |
| Embed blocks (iframe allowlist) | 🟡 | Allowlisted providers only in Phase 3, for security |
| Statement / callout / note blocks | ✅ | |
| Accordion, tabs, labelled graphic | ✅ | Standard interactive blocks |
| Flashcards | ✅ | |
| Sorting / matching activity | 🟡 | Sorting in Phase 3; matching may slip to Phase 4 with the item engine |
| Process / timeline block | ✅ | Sequential reveal |
| Knowledge-check block (inline, ungraded) | ✅ | Inline items in the spec |
| Quiz block (graded) | 🟡 | Phase 3 supports graded blocks with inline items; question-bank-backed quizzes are Phase 4 |
| Continue / gating blocks | ✅ | Requires completion before proceeding |
| Divider / spacer / layout blocks | ✅ | |
| Storyline-block embedding (mixed content) | 📅 | Equivalent is "interaction block" — Phase 3 has it natively, so no embedding needed |
| Themes (colour, type, spacing tokens) | ✅ | `spec.theme` |
| Custom fonts | 📅 | Needs font hosting + licensing model |

## 2. Storyline-class — interaction model

| Capability | Phase 3 | Notes |
|---|---|---|
| **States** (normal, hover, visited, disabled, custom) | ✅ | `blocks[].states[]` |
| **Variables** (number, text, boolean) | ✅ | `spec.variables[]`, page- or course-scoped |
| **Triggers** (when/target/condition/action) | ✅ | Closed declarative set |
| **Conditions** (variable comparisons, visited, completed) | ✅ | |
| **Layers** (overlay content with own blocks) | ✅ | `blocks[].layers[]` |
| **Timelines** (cue-point reveal, timed show/hide) | 🟡 | Cue-point sequencing in Phase 3; frame-accurate animation editing is 📅 |
| **Branching scenarios** | ✅ | Triggers + navigation actions |
| **Scenario/dialogue interactions** | ✅ | `scenario` block type |
| Drag-and-drop interactions | 📅 | Phase 4 — needs the item engine for scoring |
| Hotspot interactions | ✅ | |
| Sliders / dials as input | 📅 | Phase 4 |
| Motion paths / animation authoring | **3B** | Timeline editor is its own product surface. **Spec carries the timeline model from v1** |
| Free-form absolute positioning canvas | **3B** | **Spec carries the layout model from v1**; the editor surface is 3B |
| Character/pose libraries | **3B** | Licensing + content operations, not an engine capability |
| Screen recording / software simulation | ❌ | A separate product category; not scheduled |

**On the two capabilities that moved:** free-form absolute positioning and motion-path animation are what make Storyline a desktop tool, and they are also what make its output fragile on mobile and for screen readers. They were originally excluded as a product stance; the stated goal is now parity, so they are scheduled rather than refused.

The architectural consequence is the part that matters: **Phase 3's course specification must be able to express them from v1**, even though no Phase 3 editor surface produces them. A block therefore carries an optional layout model (flow by default, absolute when asked) and an optional timeline model. Retrofitting either after the interpreter and editor exist would mean a spec migration plus two rewrites.

**The stance that survives:** responsive, accessible output stays the *default*. Absolute positioning is an opt-in that the accessibility validation gate still applies to — parity should not mean inheriting Storyline's accessibility problems along with its canvas.

## 2b. Media production

Absent from every earlier version of this document, and not optional for authoring parity.

| Capability | Phase 3 | Notes |
|---|---|---|
| Video upload + playback from library | ✅ | Exists via `content_assets` |
| Video transcoding / adaptive delivery | **3B** | Needs a provider decision (Cloudflare Stream vs. alternatives) |
| Caption editor (author + time-align) | **3B** | Phase 3 attaches caption tracks; it does not author them |
| Transcript authoring | **3B** | |
| Automated caption generation | 📅 | AI feature, needs the media pipeline first |
| Text-to-speech narration | **3B** | Via the AI gateway, as a workload profile |
| Audio trimming / basic editing | **3B** | |
| Screen/webcam recording | ❌ | Separate product category |

## 3. Reuse, templates, structure

| Capability | Phase 3 | Notes |
|---|---|---|
| Reusable components (saved blocks) | ✅ | `component_definitions`, referenced not copied |
| Course templates | ✅ | `course_templates` |
| Cross-course content reuse | ✅ | Inherited free: authored content is a learning object |
| Global theme per org | ✅ | |
| Component library governance (who may publish) | ✅ | Existing workflow + RBAC |
| Content branching by audience/role | 📅 | Phase 5, with paths/programs |

## 4. Assessment inside content

| Capability | Phase 3 | Notes |
|---|---|---|
| Inline knowledge checks (ungraded) | ✅ | |
| Graded quiz blocks | ✅ | Inline items |
| Item types: MCQ, multi-response, true/false | ✅ | |
| Item types: fill-in-blank, matching, sequencing | 🟡 | Subset in Phase 3; completed in Phase 4 |
| Question banks / pooling / randomisation | 📅 | Phase 4 |
| Attempts, time limits, retake rules | 📅 | Phase 4 |
| Feedback per answer choice | ✅ | |
| Results/score reporting to LMS | ✅ | Via SCORM/xAPI adapters |

## 5. Accessibility

| Capability | Phase 3 | Notes |
|---|---|---|
| WCAG 2.2 AA target for authored output | ✅ | |
| Alt text authoring (required for images) | ✅ | Spec field; publish-readiness validation |
| Caption/transcript attachment for media | ✅ | Authoring supported; generation is 📅 |
| Keyboard navigation throughout runtime | ✅ | |
| Screen-reader semantics + reading order | ✅ | Spec carries reading-order hints |
| Focus management across layers/branches | ✅ | Interpreter responsibility |
| Colour-contrast validation in the editor | ✅ | Theme-level check |
| Accessibility validation gate before publish | ✅ | `spec_validation_reports` kind = `accessibility` |
| Automated caption generation | 📅 | AI feature, Phase 4+ |

## 6. Localization

| Capability | Phase 3 | Notes |
|---|---|---|
| Locale-addressable strings in the spec | ✅ | Structure exists from day one — the point is avoiding a retrofit |
| Per-course primary locale | ✅ | |
| Translation export/import (XLIFF-class) | 📅 | Phase 6 |
| Side-by-side translation UI | 📅 | Phase 6 |
| AI-assisted translation | 📅 | Phase 6, via the `rewrite_localize` profile |
| RTL layout support | 🟡 | Runtime honours direction; full RTL QA is Phase 6 |

## 7. Review, versioning, governance

| Capability | Phase 3 | Notes |
|---|---|---|
| Draft → Review → Approval → Published → Archived | ✅ | Inherited from Phase 2, unchanged |
| Immutable version snapshots | ✅ | Inherited |
| In-progress learners unaffected by republish | ✅ | Inherited (version pinning) |
| Version history + snapshot inspection | ✅ | Inherited, extended to specs |
| Reviewer comments on content | 🟡 | `content_reviews` carries comments; block-level threaded commenting is **3B** |
| Side-by-side version diff | **3B** | Valuable but not blocking |
| Real-time multi-author editing | 📅 | Phase 6 — needs CRDT/presence infrastructure |
| Single-author edit locking | ✅ | Optimistic concurrency in Phase 3 |

## 8. Publishing

| Capability | Phase 3 | Notes |
|---|---|---|
| Native in-app playback | ✅ | |
| SCORM 1.2 export | ✅ | |
| SCORM 2004 export | ✅ | |
| xAPI (TinCan) export | ✅ | |
| cmi5 export | ✅ | |
| AICC export | ❌ | Removed from the build and roadmap entirely, 2026-09-03 — predates SCORM, most AICC content has moved to SCORM 1.2 in practice, not worth building ahead of a specific customer need |
| Web/standalone HTML export | 📅 | |
| PDF/print export | 📅 | |
| LTI | 📅 | Phase 8 |
| Third-party LMS conformance verification | ✅ | Part of the Phase 3 definition of done |

## 9. Honest summary

| Bucket | Count |
|---|---|
| ✅ Phase 3 | ~46 |
| 🟡 Phase 3 partial | ~8 |
| **3B** Authoring parity + media | ~14 |
| 📅 Later phase | ~15 |
| ❌ Not scheduled | ~2 |

**What Phase 3 genuinely delivers:** Rise-class responsive block authoring in full, plus the core of Storyline's *interaction logic* (states, variables, triggers, layers, branching) — which is the part that actually differentiates interactive e-learning from a document. And a specification able to express the 3B capabilities before any of them are built.

**What it does not:** the canvas and timeline editing surfaces, the media production pipeline, and the full assessment engine. The first two are 3B; the third is Phase 4.

**What is genuinely not scheduled:** screen recording / software simulation. It is a different product, not a missing feature of this one — and unlike the canvas, nothing about the course specification needs to anticipate it.
