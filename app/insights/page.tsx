import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { createClient } from "@/lib/supabase/server";
import { INSIGHT_TOPICS } from "@/lib/ai/insights";
import type { InsightArticleRow } from "@/lib/lms/insights";

export const metadata: Metadata = {
  title: "Insights",
  description: "Practical reading on LMS standards, succession planning, 360 feedback and competency mapping.",
};

function topicLabel(category: string): string {
  return INSIGHT_TOPICS.find((t) => t.key === category)?.label ?? category;
}

export default async function InsightsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("insights_articles")
    .select("id, slug, title, summary, category, published_at")
    .order("published_at", { ascending: false });

  const articles = (data ?? []) as InsightArticleRow[];

  return (
    <main className="insights-page">
      <SiteHeader />
      <div className="insights-page__body">
        <header className="insights-page__intro">
          <span className="insights-page__eyebrow">Insights</span>
          <h1>Practical reading on the field, not the product.</h1>
          <p>
            A new piece most days on LMS standards, succession planning, 360 feedback and competency mapping —
            written for people who build and run learning programs.
          </p>
        </header>

        {articles.length === 0 ? (
          <p className="insights-page__empty">Nothing published yet — check back soon.</p>
        ) : (
          <ul className="insights-list">
            {articles.map((article) => (
              <li key={article.id} className="insights-list__item">
                <Link href={`/insights/${article.slug}`} className="insights-card">
                  <span className="insights-card__category">{topicLabel(article.category)}</span>
                  <h2 className="insights-card__title">{article.title}</h2>
                  <p className="insights-card__summary">{article.summary}</p>
                  <time className="insights-card__date" dateTime={article.published_at}>
                    {new Date(article.published_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
