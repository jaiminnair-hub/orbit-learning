"use client";

import { useEffect, useState, type FormEvent } from "react";
import { strFromU8, unzipSync } from "fflate";
import type { AssessmentItem, RichText } from "@/lib/spec";

type Assessment = { id: string; title: string; description: string | null; status: string; pass_percent: number; max_attempts: number; time_limit_minutes: number | null; question_pool_size: number | null; randomize_questions: boolean; created_at: string };
type Person = { id: string; email: string; full_name: string | null };
type Question = { id: string; sequence: number; points: number; question_bank_items: { id: string; item: AssessmentItem } };
type ImportedQuestion = { row: number; values: Record<string, string>; errors: string[] };
type NotificationResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_RECIPIENT" | "NOT_CONFIGURED" | "PROVIDER_REJECTED" | "NETWORK_ERROR" };

// Friendly, never the provider's own error text — see
// lib/notifications/email.ts's EmailDeliveryResult for what's deliberately
// not surfaced here.
function notificationNotice(action: string, notification: NotificationResult | undefined): string {
  if (!notification || notification.ok) return `${action} and the email was sent.`;
  const reason =
    notification.reason === "NOT_CONFIGURED"
      ? "email delivery is not configured"
      : notification.reason === "INVALID_RECIPIENT"
      ? "the email address could not be delivered to"
      : "the email could not be sent";
  return `${action}, but ${reason}.`;
}

const IMPORT_HEADERS = ["external_id", "question_text", "question_type", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "correct_answer", "points", "explanation", "learning_objective", "skill_code", "difficulty", "tags"];

const QUESTION_KINDS = [
  { value: "multipleChoice", label: "Multiple choice (one correct answer)" },
  { value: "multipleResponse", label: "Multiple response (one or more correct)" },
  { value: "trueFalse", label: "True / False" },
  { value: "fillBlank", label: "Fill in the blank" },
  { value: "sequencing", label: "Put in order" },
] as const;
type QuestionKind = (typeof QUESTION_KINDS)[number]["value"];

// Compact plain-text extraction for the question-list summary — the admin
// authoring form only ever writes single-paragraph RichText (see
// lib/assessments/rich-text.ts), so this is a display convenience, not a
// general RichText-to-string tool.
function plainTextOf(rt: RichText): string {
  return rt.blocks.map((b) => b.spans.map((s) => s.text).join("")).join(" ");
}

function summarizeItem(item: AssessmentItem): string {
  switch (item.kind) {
    case "multipleChoice":
    case "multipleResponse":
      return item.choices.map((c) => `${c.correct ? "✓ " : ""}${plainTextOf(c.text)}`).join(" · ");
    case "trueFalse":
      return `Answer: ${item.answer ? "True" : "False"}`;
    case "fillBlank":
      return `Accepts: ${item.acceptedAnswers.join(", ")}`;
    case "sequencing":
      return item.steps.map((s) => plainTextOf(s.text)).join(" → ");
  }
}

function readXlsxCell(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "inlineStr") return cell.textContent ?? "";
  return value;
}

async function parseWorkbook(file: File): Promise<Record<string, string>[]> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const workbookXml = strFromU8(files["xl/workbook.xml"] ?? new Uint8Array());
  const relationsXml = strFromU8(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const sharedXml = strFromU8(files["xl/sharedStrings.xml"] ?? new Uint8Array());
  if (!workbookXml || !relationsXml) throw new Error("This is not a readable .xlsx workbook.");
  const xml = new DOMParser();
  const workbook = xml.parseFromString(workbookXml, "application/xml");
  const sheet = Array.from(workbook.getElementsByTagName("sheet")).find((item) => item.getAttribute("name") === "Questions");
  const relationId = sheet?.getAttribute("r:id");
  const relations = xml.parseFromString(relationsXml, "application/xml");
  const target = Array.from(relations.getElementsByTagName("Relationship")).find((item) => item.getAttribute("Id") === relationId)?.getAttribute("Target");
  if (!target) throw new Error("The workbook needs a sheet named Questions.");
  const sheetXml = strFromU8(files[`xl/${target.replace(/^\//, "")}`] ?? new Uint8Array());
  if (!sheetXml) throw new Error("The Questions sheet could not be read.");
  const shared = sharedXml ? Array.from(xml.parseFromString(sharedXml, "application/xml").getElementsByTagName("si")).map((item) => item.textContent ?? "") : [];
  const rows = Array.from(xml.parseFromString(sheetXml, "application/xml").getElementsByTagName("row")).map((row) => {
    const result: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      const address = cell.getAttribute("r") ?? "A1";
      const letters = address.replace(/\d/g, "");
      let index = 0;
      for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
      result[index - 1] = readXlsxCell(cell, shared);
    });
    return result;
  });
  const headerIndex = rows.findIndex((row) => row.map((value) => value.trim().toLowerCase()).includes("question_text"));
  if (headerIndex < 0) throw new Error("The Questions sheet needs the question_text column from the Orbit template.");
  const headers = rows[headerIndex].map((value) => value.trim().toLowerCase());
  return rows.slice(headerIndex + 1).filter((row) => row.some((value) => value?.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
}

function validateImportedRow(values: Record<string, string>, index: number): ImportedQuestion {
  const errors: string[] = [];
  if (!values.question_text) errors.push("Question text is required");
  if (values.question_type !== "single_choice") errors.push("Only single_choice is supported today");
  const options = ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"].map((key) => values[key]).filter(Boolean);
  if (options.length < 2) errors.push("At least option A and B are required");
  const answer = values.correct_answer?.toUpperCase();
  if (!answer || !"ABCDEF".includes(answer) || !values[`option_${answer.toLowerCase()}`]) errors.push("Correct answer must point to a completed option");
  const points = Number(values.points);
  if (!Number.isInteger(points) || points < 1 || points > 100) errors.push("Points must be a whole number from 1 to 100");
  if (values.difficulty && !["foundation", "working", "advanced"].includes(values.difficulty)) errors.push("Difficulty must be foundation, working, or advanced");
  return { row: index + 5, values, errors };
}

async function api(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message ?? "Something went wrong.");
  return json.data;
}

export function AssessmentsConsole({ initialAssessments, people }: { initialAssessments: Assessment[]; people: Person[] }) {
  const [assessments, setAssessments] = useState(initialAssessments);
  const [selected, setSelected] = useState<Assessment | null>(initialAssessments[0] ?? null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importRows, setImportRows] = useState<ImportedQuestion[]>([]);

  // Controlled state for the "Add a scored question" form — the old
  // uncontrolled 4-option-only form can't express 5 differently-shaped
  // question kinds with dynamic add/remove lists.
  const [kind, setKind] = useState<QuestionKind>("multipleChoice");
  const [prompt, setPrompt] = useState("");
  const [points, setPoints] = useState(1);
  const [choices, setChoices] = useState<{ text: string; correct: boolean }[]>([{ text: "", correct: true }, { text: "", correct: false }]);
  const [tfAnswer, setTfAnswer] = useState(true);
  const [fbAnswers, setFbAnswers] = useState<string[]>([""]);
  const [fbCaseSensitive, setFbCaseSensitive] = useState(false);
  const [fbTrimWhitespace, setFbTrimWhitespace] = useState(true);
  const [seqSteps, setSeqSteps] = useState<string[]>(["", ""]);

  // AI Question Generator state — separate from the manual-add form above,
  // since it produces several questions from source text in one action
  // rather than one question from typed fields.
  const [aiSourceText, setAiSourceText] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiBusy, setAiBusy] = useState(false);

  function resetQuestionForm() {
    setKind("multipleChoice"); setPrompt(""); setPoints(1);
    setChoices([{ text: "", correct: true }, { text: "", correct: false }]);
    setTfAnswer(true); setFbAnswers([""]); setFbCaseSensitive(false); setFbTrimWhitespace(true);
    setSeqSteps(["", ""]);
  }

  useEffect(() => {
    // No synchronous reset needed here: the question list only ever renders
    // inside the `{selected && ...}` block below, so a stale `questions`
    // value while nothing is selected is never shown.
    if (!selected) return;
    fetch(`/api/v1/assessments/${selected.id}/questions`).then(async (r) => r.ok ? r.json() : null).then((json) => setQuestions(json?.data?.questions ?? []));
  }, [selected]);

  async function createAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const { assessment } = await api("/api/v1/assessments", {
        title: form.get("title"), description: form.get("description"), passPercent: Number(form.get("passPercent")), maxAttempts: Number(form.get("maxAttempts")),
        timeLimitMinutes: form.get("timeLimitMinutes") || null, questionPoolSize: form.get("questionPoolSize") || null, randomizeQuestions: form.get("randomizeQuestions") === "on",
      });
      setAssessments((old) => [assessment, ...old]); setSelected(assessment); formElement.reset(); setNotice("Draft assessment created. Add questions before publishing.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create assessment."); } finally { setBusy(false); }
  }
  async function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setError(null); setNotice(null);
    const body: Record<string, unknown> = { kind, prompt, points };
    if (kind === "multipleChoice" || kind === "multipleResponse") body.choices = choices;
    if (kind === "trueFalse") body.answer = tfAnswer;
    if (kind === "fillBlank") { body.acceptedAnswers = fbAnswers; body.caseSensitive = fbCaseSensitive; body.trimWhitespace = fbTrimWhitespace; }
    if (kind === "sequencing") body.steps = seqSteps;
    try {
      await api(`/api/v1/assessments/${selected.id}/questions`, body);
      resetQuestionForm(); const refreshed = await fetch(`/api/v1/assessments/${selected.id}/questions`).then((r) => r.json()); setQuestions(refreshed.data.questions); setNotice("Question added to the shared question bank and this assessment.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add question."); } finally { setBusy(false); }
  }
  async function publish() {
    if (!selected) return; setBusy(true); setError(null);
    try { const { assessment } = await api(`/api/v1/assessments/${selected.id}/publish`, {}); setSelected(assessment); setAssessments((old) => old.map((a) => a.id === assessment.id ? { ...a, ...assessment } : a)); setNotice("Assessment published. You can now assign it."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not publish assessment."); } finally { setBusy(false); }
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget); setBusy(true); setError(null);
    try { const { notification } = await api(`/api/v1/assessments/${selected.id}/assign`, { userId: form.get("userId"), dueDate: form.get("dueDate") || null }); setNotice(notificationNotice("Assessment assigned", notification)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not assign assessment."); } finally { setBusy(false); }
  }
  async function generateWithAi() {
    if (!selected) return; setAiBusy(true); setError(null); setNotice(null);
    try {
      const { created, failedCount, requested, provider } = await api(`/api/v1/assessments/${selected.id}/questions/generate`, { sourceText: aiSourceText, count: aiCount });
      const refreshed = await fetch(`/api/v1/assessments/${selected.id}/questions`).then((r) => r.json()); setQuestions(refreshed.data.questions);
      setAiSourceText("");
      setNotice(`${created.length} of ${requested} question${requested === 1 ? "" : "s"} generated (${provider}) and added as drafts.${failedCount ? ` ${failedCount} could not be saved.` : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate questions."); } finally { setAiBusy(false); }
  }
  async function previewWorkbook(file: File | null) {
    setError(null); setNotice(null); setImportRows([]);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setError("Use the Orbit .xlsx question-bank template."); return; }
    try { setImportRows((await parseWorkbook(file)).map(validateImportedRow)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not read that workbook."); }
  }
  async function importValidRows() {
    if (!selected) return; const valid = importRows.filter((row) => row.errors.length === 0);
    if (!valid.length) { setError("There are no valid rows to import."); return; }
    setBusy(true); setError(null); let imported = 0; const failed: string[] = [];
    for (const row of valid) {
      const answer = row.values.correct_answer.toUpperCase();
      const options = ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"].map((key) => row.values[key]).filter(Boolean);
      const importedChoices = options.map((text, i) => ({ text, correct: "ABCDEF"[i] === answer }));
      try {
        await api(`/api/v1/assessments/${selected.id}/questions`, { kind: "multipleChoice", prompt: row.values.question_text, choices: importedChoices, points: Number(row.values.points), externalId: row.values.external_id, learningObjective: row.values.learning_objective, skillCode: row.values.skill_code, difficulty: row.values.difficulty, tags: row.values.tags ? row.values.tags.split(",").map((tag) => tag.trim()) : [] });
        imported++;
      } catch (e) { failed.push(`Row ${row.row}: ${e instanceof Error ? e.message : "not imported"}`); }
    }
    const refreshed = await fetch(`/api/v1/assessments/${selected.id}/questions`).then((r) => r.json()); setQuestions(refreshed.data.questions); setNotice(`${imported} question${imported === 1 ? "" : "s"} imported as drafts.${failed.length ? ` ${failed.length} row(s) need attention.` : ""}`); if (failed.length) setError(failed.join(" ")); setBusy(false);
  }

  return <div className="assessment-studio">
    <section className="assessment-studio__hero"><p>Orbit Studio · Assessment &amp; evidence</p><h1>Measure understanding. Keep the proof.</h1><span>Standalone assessments complement SCORM scores; they do not replace them.</span></section>
    {error && <p className="assessment-message assessment-message--error">{error}</p>}{notice && <p className="assessment-message">{notice}</p>}
    <div className="assessment-studio__grid"><section className="assessment-card"><h2>Create assessment</h2><form onSubmit={createAssessment}><input name="title" placeholder="e.g. POSH essentials checkpoint" required /><textarea name="description" placeholder="What does this assess?" /><div className="assessment-form-row"><label>Pass score <input name="passPercent" type="number" min="1" max="100" defaultValue="80" /></label><label>Attempts <input name="maxAttempts" type="number" min="1" max="10" defaultValue="2" /></label></div><div className="assessment-form-row"><label>Time limit, minutes <input name="timeLimitMinutes" type="number" min="1" placeholder="No limit" /></label><label>Question pool size <input name="questionPoolSize" type="number" min="1" placeholder="Use all" /></label></div><label className="assessment-checkbox-row"><input name="randomizeQuestions" type="checkbox" /> Randomize question order per attempt</label><button disabled={busy}>Create draft →</button></form></section>
      <section className="assessment-card"><h2>Your assessments</h2>{assessments.length === 0 ? <p>No assessments yet.</p> : <div className="assessment-list">{assessments.map((item) => <button type="button" className={selected?.id === item.id ? "is-selected" : ""} key={item.id} onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{item.status} · {item.pass_percent}% pass · {item.max_attempts} attempts{item.time_limit_minutes ? ` · ${item.time_limit_minutes} min limit` : ""}{item.question_pool_size ? ` · pool of ${item.question_pool_size}` : ""}{item.randomize_questions ? " · shuffled" : ""}</span></button>)}</div>}</section></div>
    {selected && <section className="assessment-workbench"><header><div><p>Selected assessment</p><h2>{selected.title}</h2><span>{questions.length} question{questions.length === 1 ? "" : "s"} · {selected.pass_percent}% required to pass</span></div>{selected.status === "draft" ? <button onClick={publish} disabled={busy}>Publish assessment →</button> : <b className="assessment-status">Published</b>}</header>

      {selected.status === "draft" && <form className="assessment-question-form" onSubmit={addQuestion}>
        <h3>Add a scored question</h3>
        <label className="assessment-kind-select">Question type
          <select value={kind} onChange={(e) => setKind(e.target.value as QuestionKind)}>
            {QUESTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} required placeholder="Write one clear, observable question" />

        {(kind === "multipleChoice" || kind === "multipleResponse") && <div className="assessment-options">
          {choices.map((choice, index) => <label key={index}>
            <input
              type={kind === "multipleChoice" ? "radio" : "checkbox"}
              name="correctChoice"
              checked={choice.correct}
              onChange={() => setChoices((old) => old.map((c, i) => kind === "multipleChoice"
                ? { ...c, correct: i === index }
                : i === index ? { ...c, correct: !c.correct } : c))}
            />
            <input value={choice.text} onChange={(e) => setChoices((old) => old.map((c, i) => i === index ? { ...c, text: e.target.value } : c))} required={index < 2} placeholder={`Choice ${index + 1}${index < 2 ? "" : " (optional)"}`} />
            {choices.length > 2 && <button type="button" onClick={() => setChoices((old) => old.filter((_, i) => i !== index))} aria-label="Remove choice">×</button>}
          </label>)}
          {choices.length < 8 && <button type="button" onClick={() => setChoices((old) => [...old, { text: "", correct: false }])}>+ Add choice</button>}
        </div>}

        {kind === "trueFalse" && <div className="assessment-options">
          <label><input type="radio" name="tfAnswer" checked={tfAnswer} onChange={() => setTfAnswer(true)} /> True is correct</label>
          <label><input type="radio" name="tfAnswer" checked={!tfAnswer} onChange={() => setTfAnswer(false)} /> False is correct</label>
        </div>}

        {kind === "fillBlank" && <div className="assessment-options">
          {fbAnswers.map((answer, index) => <label key={index}>
            <input value={answer} onChange={(e) => setFbAnswers((old) => old.map((a, i) => i === index ? e.target.value : a))} required={index === 0} placeholder={index === 0 ? "Accepted answer" : "Also accept (optional)"} />
            {fbAnswers.length > 1 && <button type="button" onClick={() => setFbAnswers((old) => old.filter((_, i) => i !== index))} aria-label="Remove answer">×</button>}
          </label>)}
          <button type="button" onClick={() => setFbAnswers((old) => [...old, ""])}>+ Add accepted answer</button>
          <label><input type="checkbox" checked={fbCaseSensitive} onChange={(e) => setFbCaseSensitive(e.target.checked)} /> Case-sensitive</label>
          <label><input type="checkbox" checked={fbTrimWhitespace} onChange={(e) => setFbTrimWhitespace(e.target.checked)} /> Ignore leading/trailing spaces</label>
        </div>}

        {kind === "sequencing" && <div className="assessment-options">
          {seqSteps.map((step, index) => <label key={index}>
            <span>{index + 1}.</span>
            <input value={step} onChange={(e) => setSeqSteps((old) => old.map((s, i) => i === index ? e.target.value : s))} required placeholder="Step, in the correct order" />
            {seqSteps.length > 2 && <button type="button" onClick={() => setSeqSteps((old) => old.filter((_, i) => i !== index))} aria-label="Remove step">×</button>}
          </label>)}
          <button type="button" onClick={() => setSeqSteps((old) => [...old, ""])}>+ Add step</button>
        </div>}

        <label className="assessment-points">Points <input value={points} onChange={(e) => setPoints(Number(e.target.value))} type="number" min="1" max="100" /></label>
        <button disabled={busy}>Add to question bank →</button>
      </form>}

      {selected.status === "draft" && <section className="assessment-ai-generate"><div><p>AI Question Generator</p><h3>Generate from source material</h3><span>Paste the material to test — a policy, a training doc, a course page. Questions are grounded strictly in what you paste and saved as drafts for you to review.</span></div><textarea value={aiSourceText} onChange={(e) => setAiSourceText(e.target.value)} placeholder="Paste source material (at least 40 characters)…" /><label>Questions to generate <input type="number" min="1" max="20" value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))} /></label><button type="button" onClick={generateWithAi} disabled={aiBusy || aiSourceText.trim().length < 40}>{aiBusy ? "Generating…" : "Generate questions →"}</button></section>}

      {selected.status === "draft" && <section className="assessment-import"><div><p>Question-bank upload</p><h3>Import from Excel</h3><span>Upload privately, preview every row, then import only valid questions as drafts. Excel import supports multiple choice only today — the other question types above are added one at a time.</span></div><a href="/templates/orbit-question-bank-template.xlsx" download>Download template ↓</a><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => previewWorkbook(event.target.files?.[0] ?? null)} />{importRows.length > 0 && <><p className="assessment-import__summary">{importRows.filter((row) => row.errors.length === 0).length} valid · {importRows.filter((row) => row.errors.length > 0).length} need attention</p><div className="assessment-import__rows">{importRows.slice(0, 12).map((row) => <p key={row.row}><b>Row {row.row}</b> {row.errors.length ? row.errors.join(" · ") : "Ready to import"}</p>)}{importRows.length > 12 && <p>Plus {importRows.length - 12} more rows.</p>}</div><button type="button" onClick={importValidRows} disabled={busy || importRows.every((row) => row.errors.length > 0)}>Import valid drafts →</button></>}</section>}

      <div className="assessment-question-list">{questions.map((row, index) => <article key={row.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{plainTextOf(row.question_bank_items.item.prompt)}</strong><p>{summarizeItem(row.question_bank_items.item)}</p></div><b>{row.points} pt</b></article>)}</div>
      {selected.status === "published" && <form className="assessment-assign" onSubmit={assign}><h3>Assign privately</h3><select name="userId" required defaultValue=""><option value="" disabled>Choose a person</option>{people.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email} · {person.email}</option>)}</select><input name="dueDate" type="datetime-local" /><button disabled={busy}>Assign assessment →</button></form>}
    </section>}
  </div>;
}
