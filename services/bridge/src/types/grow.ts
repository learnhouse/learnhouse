// Best-effort Grow by Meshulam webhook payload shape.
// TODO(operator): replace with the real schema after first test webhook lands.
// Grow's docs are HE-only and behind login; we'll only know the exact shape
// (field names, casing, signature header name + format) after the operator
// configures their account and triggers a 1₪ test transaction.

import { z } from "zod";

// Provisional schema. Tighten once we have a real payload.
export const GrowWebhookSchema = z
  .object({
    transaction_id: z.string().min(1),
    email: z.string().email(),
    full_name: z.string().optional(),
    custom_fields: z
      .object({
        course_uuid: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type GrowWebhookPayload = z.infer<typeof GrowWebhookSchema>;

// Header that Grow sends with the HMAC signature. Name TBD; Stripe uses
// `Stripe-Signature`, GitHub uses `X-Hub-Signature-256`. Update when known.
export const GROW_SIGNATURE_HEADER = "x-grow-signature";
