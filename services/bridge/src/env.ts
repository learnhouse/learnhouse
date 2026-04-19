import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),

  LH_BASE_URL: z.string().url(),
  LH_ORG_SLUG: z.string().min(1),
  LH_ADMIN_TOKEN: z.string().min(1).optional(),

  GROW_WEBHOOK_SECRET: z.string().min(1).optional(),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().email().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireForWebhook(env: Env): asserts env is Env & {
  LH_ADMIN_TOKEN: string;
  GROW_WEBHOOK_SECRET: string;
} {
  if (!env.LH_ADMIN_TOKEN) {
    throw new Error("LH_ADMIN_TOKEN is required to handle webhooks");
  }
  if (!env.GROW_WEBHOOK_SECRET) {
    throw new Error("GROW_WEBHOOK_SECRET is required to verify webhooks");
  }
}
