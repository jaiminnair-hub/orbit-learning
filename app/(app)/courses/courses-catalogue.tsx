"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type CatalogueCourse = {
  id: string;
  title: string;
  description: string | null;
  enrolled: boolean;
  percent: number;
  completed: boolean;
  dueDate: string | null;
};

type Filter = "all" | "in-progress" | "completed";

function dueLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `Due ${new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date)}`;
}

export function CoursesCatalogue({ courses }: { courses: CatalogueCourse[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visibleCourses = useMemo(() => {
    const search = query.trim().toLowerCase();
    return courses.filter((course) => {
      const matchesSearch = !search || `${course.title} ${course.description ?? ""}`.toLowerCase().includes(search);
      const matchesFilter = filter === "all"
        || (filter === "in-progress" && course.enrolled && !course.completed)
        || (filter === "completed" && course.completed);
      return matchesSearch && matchesFilter;
    });
  }, [courses, filter, query]);

  return (
    <section className="catalogue" aria-label="Course catalogue">
      <div className="catalogue__toolbar">
        <div>
          <p className="catalogue__eyebrow">Course catalogue</p>
          <h2>Find your next move.</h2>
        </div>
        <label className="catalogue__search">
          <span className="sr-only">Search courses</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses" type="search" />
          <span aria-hidden="true">⌕</span>
        </label>
      </div>

      <div className="catalogue__filters" aria-label="Filter courses">
        {(["all", "in-progress", "completed"] as Filter[]).map((value) => (
          <button type="button" key={value} onClick={() => setFilter(value)} className={filter === value ? "is-active" : ""} aria-pressed={filter === value}>
            {value === "all" ? "All courses" : value === "in-progress" ? "In progress" : "Completed"}
          </button>
        ))}
      </div>

      {!courses.length ? (
        <div className="catalogue__empty"><h3>No courses are published yet.</h3><p>When learning is ready for your organization, it will appear here.</p></div>
      ) : !visibleCourses.length ? (
        <div className="catalogue__empty"><h3>No courses match that view.</h3><p>Try a different search or select all courses.</p></div>
      ) : (
        <div className="catalogue__grid">
          {visibleCourses.map((course, index) => {
            const action = course.completed ? "Review course" : course.enrolled ? "Continue learning" : "Explore course";
            const status = course.completed ? "Completed" : course.enrolled ? `${course.percent}% complete` : "Ready to start";
            return (
              <article className={`catalogue-card catalogue-card--${(index % 4) + 1}`} key={course.id}>
                <div className="catalogue-card__art" aria-hidden="true"><span>{course.title.slice(0, 1).toUpperCase()}</span><i /><b /></div>
                <div className="catalogue-card__body">
                  <div className="catalogue-card__status"><span className={course.completed ? "is-completed" : course.enrolled ? "is-progress" : ""}>{status}</span>{dueLabel(course.dueDate) && <small>{dueLabel(course.dueDate)}</small>}</div>
                  <h3>{course.title}</h3>
                  <p>{course.description || "Open this course to see its learning path and begin when ready."}</p>
                  {course.enrolled && <div className="catalogue-card__progress" role="progressbar" aria-label={`${course.title} progress`} aria-valuenow={course.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${course.percent}%` }} /></div>}
                  <Link href={`/courses/${course.id}`} className="catalogue-card__action">{action} <span aria-hidden="true">→</span></Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
