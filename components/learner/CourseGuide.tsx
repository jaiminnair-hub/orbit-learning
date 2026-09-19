"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "./CourseGuide.module.css";

interface Citation {
  sourceId: string;
  courseId: string;
  courseTitle: string;
  moduleTitle: string | null;
  lessonTitle: string | null;
  pageTitle: string | null;
}

interface CourseGuideProps {
  courseId: string;
  courseTitle: string;
  learningObjectId: string;
  learningObjectTitle: string;
  moduleTitle?: string | null;
  lessonTitle?: string | null;
  pageTitle?: string | null;
}

const quickPrompts = [
  ["Explain this page", "Explain the main idea on this page in simple language."],
  ["Summarize lesson", "Summarize the key points from this lesson."],
  ["Give an example", "Give me a practical example based only on this course."],
  ["Quiz me", "Quiz me with one question about this lesson, then explain what a strong answer should include."],
] as const;

export function CourseGuide(props: CourseGuideProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; citations: Citation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(clean: string) {
    if (clean.trim().length < 3 || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await fetch("/api/v1/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: clean.trim(),
          context: {
            courseId: props.courseId,
            learningObjectId: props.learningObjectId,
            pageTitle: props.pageTitle ?? null,
          },
        }),
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <details className={styles.panel}>
      <summary><span>O · Orbit Guide</span><small>Ask about this course</small></summary>
      <div className={styles.body}>
        <p className={styles.context}>
          Grounded in {props.courseTitle} · {[props.moduleTitle, props.lessonTitle, props.learningObjectTitle, props.pageTitle].filter(Boolean).join(" · ")}
        </p>
        <div className={styles.prompts} aria-label="Suggested questions">
          {quickPrompts.map(([label, prompt]) => (
            <button key={label} type="button" disabled={loading} onClick={() => void ask(prompt)}>{label}</button>
          ))}
        </div>
        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="course-guide-question">Ask a question about this course</label>
          <input id="course-guide-question" value={question} onChange={(event) => setQuestion(event.target.value)} minLength={3} maxLength={1000} placeholder="Ask about this lesson…" disabled={loading} />
          <button className={styles.submit} type="submit" disabled={loading || question.trim().length < 3}>{loading ? "Searching…" : "Ask →"}</button>
        </form>
        <div aria-live="polite" aria-busy={loading}>
          {error && <p className={styles.error}>{error}</p>}
          {answer && <article className={styles.answer}>
            <p>{answer.answer}</p>
            {answer.citations.length > 0 && <div className={styles.sources} aria-label="Course sources">
              {answer.citations.map((citation) => <Link key={citation.sourceId} href={`/courses/${citation.courseId}`}>
                {citation.sourceId} · {[citation.courseTitle, citation.moduleTitle, citation.lessonTitle, citation.pageTitle].filter(Boolean).join(" · ")}
              </Link>)}
            </div>}
          </article>}
        </div>
      </div>
    </details>
  );
}
