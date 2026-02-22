// Client-side instrumentation — runs before the app on every page load
// This is the Turbopack-compatible way to initialize Sentry on the client
import * as Sentry from '@sentry/nextjs';
import './sentry.client.config';

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
