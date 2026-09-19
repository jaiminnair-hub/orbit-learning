# Assessment question bank roadmap

## Live foundation

- Reusable question-bank records, imported or authored one at a time
- `single_choice` questions only
- 2–6 choices, one server-held correct answer, weighted points
- Excel preview and row-by-row validation before draft import
- Draft-only import, explicit assessment publication, private assignment
- Server-side scoring, attempt limits, pass criteria and audit-friendly attempts

## Explicit future expansion

The workbook reserves metadata now so later formats do not require a breaking
template change. These are **not implemented** until their own assessment,
accessibility and scoring rules are designed and tested.

1. `multiple_choice` — more than one correct answer; explicit partial-credit policy.
2. `true_false` — a constrained single-choice variant.
3. `short_answer` — rubric-led human marking, never unreliable auto-scoring.
4. `scenario` — branching choices and contextual scoring.
5. `matching` and `sequencing` — accessible keyboard interactions and deterministic scoring.
6. Question attachments, media and translated variants.
7. Question versioning, SME ownership, review dates and retirement rules.
8. Skill/evidence mapping, assessor review and capability indications.

## Safety rules that do not change

- A spreadsheet can create drafts only; it cannot publish, assign, certify or
  decide capability.
- Correct answers remain server-side. Learner assessment payloads do not expose
  answer keys.
- Import validation reports row-level errors and valid rows can be imported
  without silently discarding invalid data.
- A capability indication needs learning, assessment, evidence and—where the
  policy requires it—human review. A course completion or quiz score alone is
  never treated as competence certification.
