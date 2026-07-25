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
    tracesSampleRate: LEARNHOUSE_ENV === "dev" ? 1.0 : 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 0.1,
    integrations: [
      Sentry.replayIntegration(),
    ],
    // Errors thrown by code we don't ship. Wallet/password-manager extensions
    // inject scripts into every page, and when their own message ports die the
    // rejection is attributed to whatever page they were injected into — ours.
    // Nothing here is actionable from this repo.
    ignoreErrors: [
      /Cannot read properties of undefined \(reading '(addListener|emit)'\)/,
      "Attempting to use a disconnected port object",
      "Extension context invalidated",
      "ResizeObserver loop completed with undelivered notifications",
      "ResizeObserver loop limit exceeded",
      // Playback rejections we already handle: the autoplay policy refuses a
      // play() with no user gesture, and a source swap aborts one in flight.
      "The play() request was interrupted",
      "play() failed because the user didn't interact with the document first",
    ],
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-(web-)?extension:\/\//i,
      // Injected by browser extensions, not part of any bundle we build.
      /\/inpage\.js/i,
    ],
    beforeSend(event, hint) {
      const msg =
        (hint?.originalException as Error)?.message ??
        event?.exception?.values?.[0]?.value ??
        "";

      if (msg.includes("Failed to find Server Action")) return null;
      if (msg.includes("Organization not found")) return null;
      if (msg.includes("Organization has no config")) return null;

      // Only frame is an injected extension script — nothing of ours ran.
      const frames = event?.exception?.values?.[0]?.stacktrace?.frames ?? [];
      if (
        frames.length > 0 &&
        frames.every((frame) => /(^|\/)(inpage|contentscript|content_script)\.js/i.test(frame.filename ?? ""))
      ) {
        return null;
      }

      return event;
    },
  });
}
