import { z } from "zod";
import { generateStructured, isRealProviderConfigured } from "./gateway";

/**
 * Insights article generation — the only AI feature in this codebase with
 * no human review before what it writes reaches a public page (per explicit
 * product decision: daily articles publish automatically, no approval
 * queue). That constraint shapes the instruction below: it is written to
 * keep the model inside territory it can't get factually wrong — explaining
 * established concepts and practices — rather than territory an unreviewed
 * model could fabricate in, like citing a specific study, statistic, or
 * named organization it has no way to verify.
 */

export const INSIGHT_TOPICS = [
  {
    key: "lms_standards",
    label: "LMS Standards",
    prompt:
      "e-learning interoperability and content standards (SCORM, xAPI/Experience API, cmi5, or how learning " +
      "platforms exchange and track content and completion data)",
  },
  {
    key: "succession_planning",
    label: "Succession Planning",
    prompt:
      "succession planning practice (identifying critical roles, building readiness, avoiding common pitfalls, " +
      "or how it connects to learning and development)",
  },
  {
    key: "360_feedback",
    label: "360 Feedback",
    prompt:
      "360-degree feedback practice (multi-rater design, protecting anonymity, turning feedback into development " +
      "rather than judgement, or common design mistakes)",
  },
  {
    key: "competency_mapping",
    label: "Competency Mapping",
    prompt:
      "competency mapping and skills frameworks (defining competencies, mapping them to roles or content, or " +
      "using them to guide learning and development)",
  },
] as const;

export type InsightTopicKey = (typeof INSIGHT_TOPICS)[number]["key"];

/** One topic a day, in a fixed order that repeats — no state to track. */
export function topicForDate(date: Date): (typeof INSIGHT_TOPICS)[number] {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - startOfYear) / 86_400_000);
  return INSIGHT_TOPICS[dayOfYear % INSIGHT_TOPICS.length];
}

const GeneratedArticleSchema = z.object({
  title: z.string().min(10).max(140),
  summary: z.string().min(40).max(280),
  body: z.string().min(600),
});

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>;

export function isInsightsGeneratorConfigured(): boolean {
  return isRealProviderConfigured("content_expansion");
}

const INSTRUCTION =
  "You are writing one practical, educational article for a learning-and-development audience (L&D leaders, " +
  "HR, training managers). The <source_material> names the exact topic to write about. Write ~700-900 words: " +
  "an accessible explanation of the concept, why it matters in practice, and concrete, actionable guidance — " +
  "the kind of piece a practitioner would learn something real from.\n\n" +
  "Hard constraints, because this publishes with no human review:\n" +
  "- Never cite a specific study, survey, statistic, percentage, dollar figure, or named research organization " +
  "unless it is an extremely well-established, universally-known fact (naming SCORM or xAPI as real technical " +
  "specifications is fine; inventing 'a 2024 study found that 73% of...' is not).\n" +
  "- Never claim a specific fact about a named real company, product, or person.\n" +
  "- Never make claims about 'Orbit' or any specific vendor's product features — this is educational content " +
  "about the field, not product marketing.\n" +
  "- Write in your own authoritative voice about concepts and practices, not by attributing claims to unnamed " +
  "'experts' or 'studies' as a way around the rule above.\n\n" +
  "`title`: specific and concrete, not generic (avoid 'The Importance of X'). `summary`: one or two sentences, " +
  "the kind that would appear under the title in a list of articles. `body`: plain text, paragraphs separated " +
  "by a blank line, no markdown formatting, no headings.";

export async function generateInsightArticle(topicKey: InsightTopicKey): Promise<{
  article: GeneratedArticle;
  provider: string;
  model: string;
}> {
  const topic = INSIGHT_TOPICS.find((t) => t.key === topicKey);
  if (!topic) throw new Error(`Unknown insight topic: ${topicKey}`);

  const result = await generateStructured({
    profile: "content_expansion",
    schema: GeneratedArticleSchema,
    instruction: INSTRUCTION,
    source: JSON.stringify({ topic: topic.prompt }),
    orgId: null,
    feature: "insights.daily_article",
  });

  return { article: result.data, provider: result.meta.provider, model: result.meta.model };
}
