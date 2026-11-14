// Loaded on demand by sentry.client.config.ts. Keeping the only reference to
// replayIntegration here keeps Session Replay (~35 KB) out of every page's
// first download; it is added to the running client once the page is idle.
export { replayIntegration } from '@sentry/nextjs'
