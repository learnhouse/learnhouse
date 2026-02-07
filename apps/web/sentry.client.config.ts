import * as Sentry from "@sentry/nextjs";

const rc = typeof window !== 'undefined' ? (window as any).__RUNTIME_CONFIG__ || {} : {};
const SENTRY_DSN = rc.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN || process.env.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN;
const LEARNHOUSE_ENV = rc.NEXT_PUBLIC_LEARNHOUSE_ENV || process.env.NEXT_PUBLIC_LEARNHOUSE_ENV || "dev";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tunnel: '/monitoring',
    environment: LEARNHOUSE_ENV,
    sendDefaultPii: true,
    enableLogs: true,
    tracesSampleRate: LEARNHOUSE_ENV === "dev" ? 1.0 : 0.5,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration(),
    ],
  });
}
