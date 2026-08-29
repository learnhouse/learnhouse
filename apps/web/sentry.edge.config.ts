import * as Sentry from "@sentry/nextjs";

// Derived from the installed SDK rather than naming an exported type, so a
// Sentry major that reshuffles its type exports can't break this file.
type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BeforeSend = NonNullable<SentryOptions["beforeSend"]>;

// Edge runtime can't use fs — use process.env with non-NEXT_PUBLIC fallback (available at runtime)
const SENTRY_DSN = process.env.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN || process.env.LEARNHOUSE_SENTRY_DSN;
const LEARNHOUSE_ENV = process.env.NEXT_PUBLIC_LEARNHOUSE_ENV || process.env.LEARNHOUSE_ENV || "dev";

/** Exported for tests/sentry-filters.test.mjs — see sentry.server.config.ts. */
export const beforeSendEdge: BeforeSend = (event, hint) => {
  const msg =
    (hint?.originalException as Error)?.message ??
    event?.exception?.values?.[0]?.value ??
    "";

  if (msg.includes("Failed to find Server Action")) return null;
  if (msg.includes("Organization not found")) return null;
  if (msg.includes("Organization has no config")) return null;
  // Mirrors sentry.server.config.ts: a client that disconnects mid-stream is
  // not an application error. Kept here too so the rule survives any route
  // moving to the edge runtime.
  if (msg.includes("The destination stream closed early")) return null;

  return event;
};

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: LEARNHOUSE_ENV,
    sendDefaultPii: true,
    enableLogs: true,
    tracesSampleRate: LEARNHOUSE_ENV === "dev" ? 1.0 : 0.1,
    beforeSend: beforeSendEdge,
  });
}
