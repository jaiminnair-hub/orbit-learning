import crypto from "node:crypto";

// This endpoint is called directly by Resend, not by a signed-in Orbit user
// -- there is no bearer token to check. Its security comes entirely from
// verifying the Svix-format webhook signature Resend sends, using a secret
// only Orbit and Resend know (RESEND_WEBHOOK_SECRET, from the Resend
// dashboard when a webhook endpoint is created there). A request with a
// missing or invalid signature is rejected before any data is read.

// Resend signs the raw request body; Vercel's default JSON body parser
// would re-serialize it, which is not guaranteed to produce byte-identical
// output and would silently break signature verification. Read the exact
// bytes instead.
export const config = { api: { bodyParser: false } };

async function rawBodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, payload) {
  return response.status(status).json(payload);
}

function settingsFromEnv() {
  return {
    url: process.env.ORBIT_SUPABASE_URL,
    serviceKey: process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET
  };
}

async function db(settings, path, options = {}) {
  const response = await fetch(`${settings.url}${path}`, {
    ...options,
    headers: {
      apikey: settings.serviceKey,
      Authorization: `Bearer ${settings.serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || "Orbit could not record this delivery event.");
  return payload;
}

// Svix (the webhook signing standard Resend uses) signs
// "{svix-id}.{svix-timestamp}.{raw body}" with HMAC-SHA256, using the
// portion of the secret after its "whsec_" prefix, base64-decoded. The
// signature header can carry more than one space-separated "v1,<sig>"
// entry (for secret rotation); matching any one of them is a valid pass.
function verifySignature(secret, id, timestamp, rawBody, signatureHeader) {
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const secretBytes = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuffer = Buffer.from(expected, "base64");
  const candidates = String(signatureHeader).split(" ").map((entry) => entry.split(",")[1]).filter(Boolean);
  return candidates.some((candidate) => {
    try {
      const candidateBuffer = Buffer.from(candidate, "base64");
      return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
    } catch {
      return false;
    }
  });
}

// Only a bounce or a spam complaint means the reviewer will never see this
// link through this channel -- everything else Resend reports (delivered,
// opened, delayed) either duplicates what Orbit already infers itself, or
// isn't actionable by an administrator.
const FAILURE_REASON_BY_EVENT = {
  "email.bounced": "Email bounced",
  "email.complained": "Recipient marked as spam"
};

export default async (request, response) => {
  if (request.method !== "POST") return response.status(405).setHeader("Allow", "POST").json({ message: "Method not allowed." });

  const settings = settingsFromEnv();
  if (!settings.url || !settings.serviceKey || !settings.webhookSecret) {
    return json(response, 503, { message: "Delivery event webhook is not configured yet." });
  }

  try {
    const rawBody = await rawBodyOf(request);
    const ok = verifySignature(
      settings.webhookSecret,
      request.headers["svix-id"],
      request.headers["svix-timestamp"],
      rawBody,
      request.headers["svix-signature"]
    );
    if (!ok) return json(response, 401, { message: "Invalid webhook signature." });

    const event = JSON.parse(rawBody);
    const failureReason = FAILURE_REASON_BY_EVENT[event?.type];
    const messageId = event?.data?.email_id;
    if (!failureReason || !messageId) return json(response, 200, { ignored: true });

    const deliveries = await db(settings, `/rest/v1/feedback_invitation_deliveries?provider_message_id=eq.${encodeURIComponent(messageId)}&select=id,status`);
    const delivery = deliveries[0];
    // A completed response is never altered, even indirectly by a delivery
    // status change arriving late -- the confidentiality-hardening trigger
    // would reject touching the response itself, but the delivery row is a
    // separate table, so this check is a deliberate extra safeguard, not
    // one this endpoint can rely on the database to enforce for it.
    if (!delivery || delivery.status === "completed") return json(response, 200, { ignored: true });

    await db(settings, `/rest/v1/feedback_invitation_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", failure_reason: failureReason })
    });

    return json(response, 200, { recorded: true });
  } catch (error) {
    console.error("Feedback invitation webhook failed", error);
    return json(response, 500, { message: "Orbit could not process this delivery event." });
  }
};
