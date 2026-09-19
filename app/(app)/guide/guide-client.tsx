"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

interface Citation {
  sourceId: string;
  courseId: string;
  courseTitle: string;
  moduleTitle: string | null;
  lessonTitle: string | null;
  pageTitle: string | null;
}
interface Answer {
  grounded: boolean;
  answer: string;
  citations: Citation[];
}

export function GuideClient() {
  const [question, setQuestion] = useState("");
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = question.trim();
    if (clean.length < 3 || loading) return;

    setLoading(true);
    setError(null);
    setAnswer(null);
    setAskedQuestion(clean);
    try {
      const response = await fetch("/api/v1/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "Orbit Guide could not answer right now.");
      setAnswer(json.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Orbit Guide could not answer right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="tutor-workspace" aria-label="Ask Orbit Guide">
      <div className="tutor-compose">
        <div>
          <p className="tutor-label">One question at a time</p>
          <h2>What would you like to understand?</h2>
          <span>No conversation history is stored. Each question starts fresh.</span>
        </div>
        <form onSubmit={ask}>
          <label htmlFor="tutor-question">Your question</label>
          <textarea
            id="tutor-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            minLength={3}
            maxLength={1000}
            rows={5}
            placeholder="For example: What are the steps for giving useful feedback?"
            disabled={loading}
            required
          />
          <div>
            <small>{question.length}/1,000</small>
            <button type="submit" disabled={loading || question.trim().length < 3}>
              {loading ? "Searching published courses…" : "Ask Orbit Guide →"}
            </button>
          </div>
        </form>
      </div>

      <div className="tutor-answer" aria-live="polite" aria-busy={loading}>
        {!askedQuestion && !loading && (
          <div className="tutor-answer__empty">
            <span aria-hidden="true">O</span>
            <h2>Grounded, not guessed.</h2>
            <p>Guide searches the published learning available in your organisation and names the courses behind its answer.</p>
          </div>
        )}
        {loading && (
          <div className="tutor-answer__loading">
            <span aria-hidden="true" />
            <div><strong>Reading your course library</strong><small>New or changed published passages are indexed automatically.</small></div>
          </div>
        )}
        {error && <div className="tutor-answer__error"><strong>Guide could not complete this request.</strong><p>{error}</p></div>}
        {answer && (
          <article>
            <p className="tutor-label">Your question</p>
            <h2>{askedQuestion}</h2>
            <div className="tutor-answer__copy">{answer.answer}</div>
            {answer.citations.length > 0 && (
              <section className="tutor-sources" aria-label="Course sources">
                <h3>Course sources</h3>
                {answer.citations.map((citation) => (
                  <Link href={`/courses/${citation.courseId}`} key={citation.sourceId}>
                    <b>{citation.sourceId}</b>
                    <span>
                      <strong>{citation.courseTitle}</strong>
                      <small>{[citation.moduleTitle, citation.lessonTitle, citation.pageTitle].filter(Boolean).join(" · ")}</small>
                    </span>
                    <i aria-hidden="true">→</i>
                  </Link>
                ))}
              </section>
            )}
            {!answer.grounded && <small className="tutor-answer__boundary">No outside knowledge was used.</small>}
          </article>
        )}
      </div>
    </section>
  );
}
