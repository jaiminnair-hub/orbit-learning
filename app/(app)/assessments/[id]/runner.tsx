"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssessmentItem, RichText } from "@/lib/spec";

type Question = { id: string; item: AssessmentItem; points: number };
type Assessment = { id: string; title: string; description: string | null; pass_percent: number; max_attempts: number; time_limit_minutes: number | null };
type Answer = string | string[] | boolean;

function plainTextOf(rt: RichText): string {
  return rt.blocks.map((b) => b.spans.map((s) => s.text).join("")).join(" ");
}

function QuestionFields({ item, answer, onChange }: { item: AssessmentItem; answer: Answer | undefined; onChange: (a: Answer) => void }) {
  switch (item.kind) {
    case "multipleChoice":
      return <>{item.choices.map((choice) => (
        <label key={choice.id}>
          <input type="radio" name={item.id} checked={answer === choice.id} onChange={() => onChange(choice.id)} required />
          {plainTextOf(choice.text)}
        </label>
      ))}</>;

    case "multipleResponse": {
      const selected = Array.isArray(answer) ? answer : [];
      return <>{item.choices.map((choice) => (
        <label key={choice.id}>
          <input
            type="checkbox"
            checked={selected.includes(choice.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, choice.id] : selected.filter((id) => id !== choice.id))}
          />
          {plainTextOf(choice.text)}
        </label>
      ))}</>;
    }

    case "trueFalse":
      return <>
        <label><input type="radio" name={item.id} checked={answer === true} onChange={() => onChange(true)} required /> True</label>
        <label><input type="radio" name={item.id} checked={answer === false} onChange={() => onChange(false)} required /> False</label>
      </>;

    case "fillBlank":
      return <input type="text" value={typeof answer === "string" ? answer : ""} onChange={(e) => onChange(e.target.value)} required placeholder="Your answer" />;

    case "sequencing": {
      const order = Array.isArray(answer) ? (answer as string[]) : item.steps.map((s) => s.id);
      const stepText = new Map(item.steps.map((s) => [s.id, plainTextOf(s.text)]));
      function move(index: number, dir: -1 | 1) {
        const next = [...order];
        const target = index + dir;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
      }
      return <ol className="assessment-sequencing">
        {order.map((id, index) => (
          <li key={id}>
            <span>{stepText.get(id)}</span>
            <span className="assessment-sequencing__controls">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label="Move down">↓</button>
            </span>
          </li>
        ))}
      </ol>;
    }
  }
}

/** mm:ss, or "Time's up" once the deadline has passed — never negative. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return "Time's up";
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AssessmentRunner({
  assessment, attemptsUsed, hasAttemptInProgress,
}: { assessment: Assessment; attemptsUsed: number; hasAttemptInProgress: boolean }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null); // epoch ms, or null when untimed
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<{ scorePercent: number; passed: boolean; passPercent: number; attemptsRemaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(hasAttemptInProgress);
  const remaining = result?.attemptsRemaining ?? assessment.max_attempts - attemptsUsed;
  const autoSubmitted = useRef(false);

  async function applyStartResponse(response: Response) {
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "Could not start the assessment.");
    setQuestions(json.data.questions);
    setDeadline(json.data.timeLimitMinutes ? new Date(json.data.startedAt).getTime() + json.data.timeLimitMinutes * 60_000 : null);
  }

  async function start() {
    setStarting(true); setError(null);
    try {
      await applyStartResponse(await fetch(`/api/v1/assessments/${assessment.id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the assessment.");
      setStarting(false);
    }
  }

  // A refreshed page mid-attempt resumes straight into the timed form — the
  // server already knows an attempt is in progress (hasAttemptInProgress).
  // Inlined rather than calling start() directly: an effect body that
  // references a named setState-calling function trips
  // react-hooks/set-state-in-effect, which can't see the awaits inside it
  // (same fix as app/(app)/admin/reports/enrollment-rules-panel.tsx).
  useEffect(() => {
    if (!hasAttemptInProgress) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/v1/assessments/${assessment.id}/start`, { method: "POST" });
        if (cancelled) return;
        await applyStartResponse(response);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not resume the assessment.");
        setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A ref, not state: the countdown effect below needs to call the LATEST
  // submit (closing over current `answers`/`questions`/`busy`) without
  // re-running its interval on every keystroke — but refs may only be
  // written outside render (event handlers, effects), never during render
  // itself, so the assignment lives in its own effect rather than inline.
  const submit = useRef<(auto: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    submit.current = async function submitImpl(auto: boolean) {
      if (!questions || busy) return;
      setBusy(true); setError(null);
      try {
        const response = await fetch(`/api/v1/assessments/${assessment.id}/submit`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error?.message ?? "Could not submit assessment.");
        setResult(json.data);
      } catch (err) {
        setError((auto ? "Time ran out and your submission failed — " : "") + (err instanceof Error ? err.message : "Could not submit assessment."));
      } finally {
        setBusy(false);
      }
    };
  });

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    await submit.current(false);
  }

  // Countdown tick, and the one place the deadline is actually enforced on
  // the client — auto-submitting whatever's answered so far the instant it
  // hits zero. The server independently re-checks the real elapsed time on
  // submit (see submit/route.ts) — this is a courtesy to the learner, not
  // the enforcement.
  useEffect(() => {
    if (deadline == null || result) return;
    const tick = () => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        void submit.current(true);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline, result]);

  return <main className="assessment-runner"><Link href="/dashboard">← Learning home</Link><section><p>Orbit assessment · evidence of understanding</p><h1>{assessment.title}</h1><span>{assessment.description || "Answer each question carefully."}</span><div className="assessment-runner__meta">{questions && <b>{questions.length} question{questions.length === 1 ? "" : "s"}</b>}<b>{assessment.pass_percent}% to pass</b><b>{remaining} attempt{remaining === 1 ? "" : "s"} remaining</b>{assessment.time_limit_minutes && <b>{assessment.time_limit_minutes} minute{assessment.time_limit_minutes === 1 ? "" : "s"} time limit</b>}{deadline != null && remainingMs != null && !result && <b className={remainingMs < 60_000 ? "assessment-runner__timer assessment-runner__timer--low" : "assessment-runner__timer"}>{formatRemaining(remainingMs)} remaining</b>}</div></section>
    {error && <p className="assessment-message assessment-message--error">{error}</p>}
    {result
      ? <section className={`assessment-result ${result.passed ? "assessment-result--pass" : "assessment-result--retry"}`}><p>{result.passed ? "Assessment passed" : "Not passed yet"}</p><h2>{result.scorePercent}%</h2><span>{result.passed ? "This is a learning signal. Any competency indication will also require the evidence and review rules set for that skill." : result.attemptsRemaining ? `You need ${result.passPercent}% to pass. Review the learning and try again.` : "No attempts remain. Ask your learning administrator for support."}</span>{!result.passed && result.attemptsRemaining > 0 && <button onClick={() => { setResult(null); setQuestions(null); setDeadline(null); setRemainingMs(null); setAnswers({}); setStarting(false); }}>Try again</button>}</section>
      : questions
        ? <form onSubmit={submitForm} className="assessment-runner__form">{questions.map((question, index) => <fieldset key={question.id}><legend><span>{String(index + 1).padStart(2, "0")}</span>{plainTextOf(question.item.prompt)}</legend><QuestionFields item={question.item} answer={answers[question.id]} onChange={(a) => setAnswers((old) => ({ ...old, [question.id]: a }))} /></fieldset>)}<button disabled={busy || Object.keys(answers).length !== questions.length}>{busy ? "Scoring…" : "Submit assessment →"}</button></form>
        : <section className="assessment-runner__start">{remaining > 0
            ? <><p>{assessment.time_limit_minutes ? `Once you start, you'll have ${assessment.time_limit_minutes} minute${assessment.time_limit_minutes === 1 ? "" : "s"} to finish — the clock does not pause.` : "Take your time — there is no clock on this assessment."}</p><button onClick={start} disabled={starting}>{starting ? "Starting…" : "Start assessment →"}</button></>
            : <p>No attempts remain. Ask your learning administrator for support.</p>}</section>}
  </main>;
}
