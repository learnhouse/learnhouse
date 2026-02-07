import * as Sentry from "@sentry/nextjs";

// Edge runtime can't use fs — use process.env with non-NEXT_PUBLIC fallback (available at runtime)
const SENTRY_DSN = process.env.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN || process.env.LEARNHOUSE_SENTRY_DSN;
const LEARNHOUSE_ENV = process.env.NEXT_PUBLIC_LEARNHOUSE_ENV || process.env.LEARNHOUSE_ENV || "dev";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: LEARNHOUSE_ENV,
    sendDefaultPii: true,
    enableLogs: true,
    tracesSampleRate: LEARNHOUSE_ENV === "dev" ? 1.0 : 0.5,
  });
}
