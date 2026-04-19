import { Hono } from "hono";
import { loadEnv, requireForWebhook } from "../env.ts";
import { LearnhouseClient } from "../clients/learnhouse.ts";
import { GROW_SIGNATURE_HEADER, GrowWebhookSchema } from "../types/grow.ts";

export const growWebhook = new Hono();

growWebhook.post("/grow", async (c) => {
  const env = loadEnv();
  requireForWebhook(env);

  const sig = c.req.header(GROW_SIGNATURE_HEADER);
  if (!sig) return c.json({ error: "missing signature" }, 401);

  const raw = await c.req.text();
  if (!verifyHmac(raw, sig, env.GROW_WEBHOOK_SECRET)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = GrowWebhookSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "invalid payload", issues: parsed.error.issues }, 400);
  }
  const payload = parsed.data;

  // TODO(idempotency): dedupe on payload.transaction_id. PLAN.md leaves the
  // store choice (Redis vs. SQLite) open. For now, replays will re-trigger
  // the LH calls — provisionUser is upserty (400 on duplicate, we treat as
  // pre-existing), enrollUser is idempotent (400 on already-enrolled, we
  // treat as success). Magic-link will be re-issued. Acceptable for now.

  const lh = new LearnhouseClient({
    baseUrl: env.LH_BASE_URL,
    orgSlug: env.LH_ORG_SLUG,
    adminToken: env.LH_ADMIN_TOKEN,
  });

  let user = await lh.getUserByEmail(payload.email);
  if (!user) {
    user = await lh.provisionUser({
      email: payload.email,
      username: usernameFromEmail(payload.email),
      first_name: payload.full_name?.split(" ")[0] ?? "",
      last_name: payload.full_name?.split(" ").slice(1).join(" ") ?? "",
    });
  }

  const enrollment = await lh.enrollUser({
    userId: user.id,
    courseUuid: payload.custom_fields.course_uuid,
  });

  const link = await lh.issueMagicLink({
    user_id: user.id,
    redirect_to: `/courses/${payload.custom_fields.course_uuid}`,
  });

  // TODO(email): Resend send blocked on operator getting a verified domain.
  // Until then, log the URL so it can be hand-tested or relayed manually.
  console.log(
    JSON.stringify({
      event: "magic_link_ready",
      transaction_id: payload.transaction_id,
      user_id: user.id,
      already_enrolled: enrollment.alreadyEnrolled,
      url: link.url,
      expires_at: link.expires_at,
    }),
  );

  return c.json({
    ok: true,
    user_id: user.id,
    already_enrolled: enrollment.alreadyEnrolled,
    magic_link_url: link.url,
    magic_link_expires_at: link.expires_at,
  });
});

function usernameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "user";
}

function verifyHmac(body: string, headerValue: string, secret: string): boolean {
  // TODO(grow): confirm signature format from a real test webhook.
  // Most providers send hex-encoded HMAC-SHA256 of the raw body. Some
  // prefix the algorithm (e.g. "sha256=..."). This handles both.
  const presented = headerValue.includes("=") ? headerValue.split("=").pop()! : headerValue;
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(body);
  const expected = hasher.digest("hex");
  return timingSafeEqHex(presented, expected);
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
