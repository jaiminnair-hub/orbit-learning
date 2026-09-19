const MAX_QUESTIONS = 6;
const PURPOSES = new Set(["development", "performance", "peer_check_in", "custom"]);
const QUESTION_TYPES = new Set(["rating", "open_text"]);

function json(response, status, payload) {
  return response.status(status).json(payload);
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function requiredEnvironment() {
  return {
    supabaseUrl: process.env.ORBIT_SUPABASE_URL,
    publishableKey: process.env.ORBIT_SUPABASE_PUBLISHABLE_KEY,
    aiKey: process.env.AICREDITS_API_KEY
  };
}

async function authenticatedUser(config, request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Sign in before requesting question suggestions.");
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, Authorization: authorization }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your Orbit session has expired. Please sign in again.");
  return user;
}

/**
 * Deliberately the ONLY AI call in the 360 quick-create flow, and deliberately
 * the lowest-risk place for one: it drafts survey questions, never decides who
 * receives confidential access to what. It is never given a person's name —
 * only a purpose category and a generic role/department string the caller
 * supplies (e.g. "Product department, Engineering Manager") — so a
 * mismatched or low-quality suggestion can only ever be a mediocre question,
 * never a privacy or wrong-recipient failure. The admin reviews and can edit
 * or regenerate every question before anything is saved.
 */
async function suggestFromAiCredits(aiKey, purpose, roleContext, customInstructions) {
  const purposeCopy = {
    development: "ongoing professional development, not a formal performance rating",
    performance: "a formal performance review cycle",
    peer_check_in: "a lightweight peer check-in between colleagues",
    custom: customInstructions || "a general 360-degree feedback cycle"
  }[purpose];

  const schema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 3,
        maxItems: MAX_QUESTIONS,
        items: {
          type: "object",
          properties: {
            competency_label: { type: "string" },
            question_type: { type: "string", enum: ["rating", "open_text"] },
            prompt: { type: "string" }
          },
          required: ["competency_label", "question_type", "prompt"]
        }
      }
    },
    required: ["questions"]
  };

  const systemPrompt = [
    "You write short, specific 360-degree feedback survey questions for a workplace feedback tool.",
    `This cycle's purpose: ${purposeCopy}.`,
    roleContext ? `The person being reviewed works in this general area (no names, do not invent one): ${roleContext}.` : "No role context was given — write generally applicable questions.",
    "Write between 3 and 6 questions. Make most of them 1-5 rating questions with a clear, specific competency label (e.g. 'Communication', 'Delegation', 'Strategic thinking') and exactly one open-text question inviting a concrete example or suggestion.",
    "Never reference a specific person's name. Never ask for anything identifying about the reviewer.",
    "Respond with a single JSON object that satisfies exactly this JSON Schema. Output only the JSON — no prose, no markdown code fences.",
    JSON.stringify(schema)
  ].join("\n");

  const response = await fetch("https://api.aicredits.in/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5",
      max_tokens: 1024,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Generate the questions now." }]
    })
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`AICredits request failed (${response.status}): ${raw.slice(0, 300)}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Provider returned no content.");

  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error("Provider response was not valid JSON."); }
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const clean = questions
    .filter((question) =>
      question && typeof question.prompt === "string" && question.prompt.trim().length >= 8 &&
      typeof question.competency_label === "string" && question.competency_label.trim().length > 0 &&
      QUESTION_TYPES.has(question.question_type))
    .slice(0, MAX_QUESTIONS)
    .map((question) => ({
      competency_label: question.competency_label.trim().slice(0, 80),
      question_type: question.question_type,
      prompt: question.prompt.trim().slice(0, 400)
    }));

  if (!clean.length) throw new Error("The suggested questions did not pass validation. Please try again.");
  return clean;
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).setHeader("Allow", "POST").json({ message: "Method not allowed." });

  const config = requiredEnvironment();
  if (!config.aiKey) {
    return json(response, 503, { message: "AI question suggestions are not configured for this workspace yet. Add questions manually below." });
  }
  if (!config.supabaseUrl || !config.publishableKey) {
    return json(response, 503, { message: "Orbit 360 is not fully configured yet." });
  }

  try {
    const body = parseBody(request);
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    const purpose = PURPOSES.has(body.purpose) ? body.purpose : "development";
    const roleContext = typeof body.roleContext === "string" ? body.roleContext.trim().slice(0, 200) : "";
    const customInstructions = purpose === "custom" && typeof body.customInstructions === "string" ? body.customInstructions.trim().slice(0, 400) : "";
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json(response, 400, { message: "A valid organization is required." });

    const user = await authenticatedUser(config, request);
    const adminCheck = await fetch(
      `${config.supabaseUrl}/rest/v1/product_role_assignments?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(user.id)}&product_key=eq.feedback&role_key=eq.feedback_admin&select=user_id`,
      { headers: { apikey: config.publishableKey, Authorization: request.headers.authorization } }
    );
    const adminRoles = await adminCheck.json().catch(() => []);
    if (!adminCheck.ok || !Array.isArray(adminRoles) || !adminRoles.length) {
      return json(response, 403, { message: "Only an authorised feedback administrator can request question suggestions." });
    }

    const questions = await suggestFromAiCredits(config.aiKey, purpose, roleContext, customInstructions);
    return json(response, 200, { questions });
  } catch (error) {
    console.error("Question suggestion failed", error);
    return json(response, 500, { message: error.message && error.message.length < 200 ? error.message : "Orbit could not generate question suggestions. Please try again or add questions manually." });
  }
};
