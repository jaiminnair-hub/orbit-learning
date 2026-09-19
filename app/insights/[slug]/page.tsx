import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { createClient } from "@/lib/supabase/server";
import { INSIGHT_TOPICS } from "@/lib/ai/insights";

function topicLabel(category: string): string {
  return INSIGHT_TOPICS.find((t) => t.key === category)?.label ?? category;
}

async function getArticle(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("insights_articles")
    .select("id, slug, title, summary, body, category, published_at")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return { title: "Insights" };
  return { title: article.title, description: article.summary };
}

export default async function InsightArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();

  const paragraphs = article.body.split(/\n{2,}/).map((p: string) => p.trim()).filter(Boolean);

  return (
    <main className="insights-page">
      <SiteHeader />
      <article className="insights-article">
        <Link href="/insights" className="insights-article__back">
          ← All insights
        </Link>
        <span className="insights-card__category">{topicLabel(article.category)}</span>
        <h1 className="insights-article__title">{article.title}</h1>
        <time className="insights-card__date" dateTime={article.published_at}>
          {new Date(article.published_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <div className="insights-article__body">
          {paragraphs.map((p: string, i: number) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </article>
    </main>
  );
}
