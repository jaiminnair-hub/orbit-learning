import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsightArticle, topicForDate, type InsightTopicKey } from "@/lib/ai/insights";

export interface InsightArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: InsightTopicKey;
  publishedAt: string;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Generates today's article and writes it straight to the public table —
 * there is no draft state (see lib/ai/insights.ts's header comment on why
 * the generation instruction is written the way it is). Runs only from
 * app/api/cron/insights/route.ts, service-role, never client-reachable.
 */
export async function generateAndPublishTodaysInsight(): Promise<InsightArticle> {
  const topic = topicForDate(new Date());
  const { article } = await generateInsightArticle(topic.key);

  const admin = createAdminClient();
  const baseSlug = slugify(article.title);
  const slug = await uniqueSlug(baseSlug);

  const { data, error } = await admin
    .from("insights_articles")
    .insert({
      slug,
      title: article.title,
      summary: article.summary,
      body: article.body,
      category: topic.key,
    })
    .select("id, slug, title, summary, body, category, published_at")
    .single();

  if (error) throw new Error(`Failed to publish insight article: ${error.message}`);

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    summary: data.summary,
    body: data.body,
    category: data.category,
    publishedAt: data.published_at,
  };
}

/** Appends today's date, then a short counter, until the slug is free. */
async function uniqueSlug(base: string): Promise<string> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const candidate = `${base}-${today}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    const probe = attempt === 0 ? candidate : `${candidate}-${attempt}`;
    const { data } = await admin.from("insights_articles").select("id").eq("slug", probe).maybeSingle();
    if (!data) return probe;
  }
  throw new Error(`Could not find a free slug for base "${base}"`);
}

export interface InsightArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: InsightTopicKey;
  published_at: string;
}
