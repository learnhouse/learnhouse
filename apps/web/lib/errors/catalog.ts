import type { ErrorCategory } from './types'

// The meaningful-error catalog. Ordered MOST-SPECIFIC first — classifyError()
// walks this list and the first category whose matchers hit wins, so narrow
// signatures (version mismatch, auth, plan limits, a specific 503 detail) sit
// above broad ones (generic 5xx, unknown). Strings in `messageIncludes` are
// compared lowercase.
//
// Grounded in a sweep of 221 real failure scenarios across the service layer,
// the FastAPI backend, the UI surfaces, and the browser runtime. This catalog
// is the single source of truth for what users read when something breaks —
// keep titles human and non-alarming, descriptions short and honest, and
// resolutions limited to actions that actually help for that failure.

export const ERROR_CATALOG: ErrorCategory[] = [
  {
    kind: 'version_mismatch',
    title: 'The app just updated',
    description:
      'A new version of LearnHouse was released while this page was open, so it briefly fell out of sync. Reloading will pick up the latest version.',
    matchers: {
      statuses: [],
      messageIncludes: [
        'failed to find server action',
        'older or newer deployment',
        'router state header was sent but could not be parsed',
      ],
      names: [],
    },
    resolutions: ['reload'],
  },
  {
    kind: 'chunk_load',
    title: "Part of the page didn't load",
    description:
      "Your browser was holding onto an older copy of the app and couldn't load a piece of it. A quick reload usually clears it right up.",
    matchers: {
      statuses: [],
      messageIncludes: [
        'loading chunk',
        'chunkloaderror',
        'failed to load resource',
        'dynamically imported module',
        'importing a module script failed',
      ],
      names: ['ChunkLoadError'],
    },
    resolutions: ['reload', 'retry'],
  },
  {
    kind: 'auth_session',
    title: 'Your session expired',
    description:
      "You've been signed out or your sign-in needs refreshing. Logging back in will restore your access.",
    matchers: {
      statuses: [401],
      messageIncludes: [
        'authentication required',
        'authentication failed',
        'invalid credentials',
        'could not validate credentials',
        'refresh token expired',
        'no refresh token',
        'session expired',
        'could not obtain a valid session token',
        'email not verified',
        'verify your email',
        'wrong_email_password',
        'account_locked',
        'unauthorized',
        'not authenticated',
        'please try logging in again',
      ],
      names: [],
    },
    resolutions: ['login', 'signout', 'report'],
  },
  {
    kind: 'plan_limit',
    title: 'This needs a plan upgrade',
    description:
      "The feature you tried to use isn't included on your current plan, or it's turned off for your organization. Upgrading or enabling it unlocks access.",
    matchers: {
      statuses: [402],
      messageIncludes: [
        'pro plan or higher',
        'requires a pro plan',
        'free plan',
        'enterprise_only',
        'enterprise only',
        'watermark_free_plan',
        'disabled for this organization',
        'is disabled',
        'development mode is disabled',
        'upgrade',
      ],
      names: [],
    },
    resolutions: ['home', 'contact_support', 'report'],
  },
  {
    kind: 'permission',
    title: "You don't have access to this",
    description:
      "Your account doesn't have permission for this page or action. If you think it should, an admin for your organization can grant access.",
    matchers: {
      statuses: [403],
      messageIncludes: [
        'access denied',
        'does not have permission',
        'not public or not published',
        'admin access required',
        'api token is not scoped',
        'forbidden',
        'admin_only',
        'auth_required',
      ],
      names: [],
    },
    resolutions: ['home', 'signout', 'report'],
  },
  {
    kind: 'rate_limit',
    title: "Let's slow down for a moment",
    description:
      "You've made a lot of requests in a short time, so we've paused things briefly to keep your account safe. It'll free up shortly.",
    matchers: {
      statuses: [429],
      messageIncludes: ['too many', 'rate limit', 'rate_limited', 'slow down', 'try again in', 'retry-after'],
      names: [],
    },
    resolutions: ['wait', 'retry'],
  },
  {
    kind: 'not_found',
    title: "We couldn't find that",
    description:
      "The item you're looking for may have been moved, deleted, or isn't available to your organization. It's not something you did wrong.",
    matchers: {
      statuses: [404],
      messageIncludes: [
        'not found',
        'could not be found',
        "doesn't belong to",
        'unknown query',
        'unknown course query',
        'unknown detail query',
        'no longer active',
      ],
      names: [],
    },
    resolutions: ['home', 'retry', 'report'],
  },
  {
    kind: 'conflict',
    title: 'That already exists',
    description:
      "This conflicts with something that's already there — for example an account or item with the same name or email already exists.",
    matchers: {
      statuses: [409],
      messageIncludes: ['already exists', 'already taken', 'already registered', 'already a member', 'duplicate', 'conflict'],
      names: [],
    },
    resolutions: ['login', 'home', 'report'],
  },
  {
    kind: 'validation',
    title: 'Something needs a quick fix',
    description:
      'A field is missing, out of range, or in the wrong format. Adjust the highlighted input and try again.',
    matchers: {
      statuses: [400, 422],
      messageIncludes: [
        'is required',
        'must be a',
        'invalid format',
        'cannot be more than',
        'at least one',
        'no test cases defined',
        'no_answers_error',
        'select at least one',
        'invalid image url',
        'please fill in',
        'must be a comma-separated list',
        'must be a json object',
        'must pass',
        'grade must be a positive',
        'validation',
      ],
      names: ['ValidationError'],
    },
    resolutions: ['retry', 'report'],
  },
  {
    kind: 'org_config',
    title: 'This workspace needs setup',
    description:
      "This organization isn't fully configured yet. An administrator may need to finish setting it up before it can be used.",
    matchers: {
      statuses: [],
      messageIncludes: ['organization has no config', 'has no config', 'config not found'],
      names: [],
    },
    resolutions: ['home', 'retry', 'report'],
  },
  {
    kind: 'payment',
    title: "We couldn't complete that billing step",
    description:
      'Something interrupted checkout, the billing portal, or a subscription change. No charge is lost; you can safely try again.',
    matchers: {
      statuses: [],
      messageIncludes: [
        'checkout',
        'billing portal',
        'billing account',
        'subscription',
        'stripe',
        'could not start checkout',
        'failed to start checkout',
        'cancel subscription',
        'could not load purchases',
        'no billing account found',
      ],
      names: [],
    },
    resolutions: ['retry', 'contact_support', 'report'],
  },
  {
    kind: 'upload',
    title: "That upload didn't go through",
    description:
      'Your file may be too large or in an unsupported format, or the connection dropped mid-upload. Check the file and give it another try.',
    matchers: {
      statuses: [413],
      messageIncludes: [
        'payload too large',
        'file too large',
        'png or jpg',
        'did not return a valid image',
        'process unsplash image',
        'thumbnail',
        'upload_error',
        'upload failed',
      ],
      names: [],
    },
    resolutions: ['retry', 'report'],
  },
  {
    kind: 'ai',
    title: 'The AI assistant ran into trouble',
    description:
      'An AI or generation request was interrupted or returned an incomplete response. These can be temporary, so trying again often works.',
    matchers: {
      statuses: [],
      messageIncludes: [
        'failed to get response reader',
        'no response body',
        'during grading',
        'error grading task',
        'code execution failed',
        'ai_failed',
        'magic block',
      ],
      names: [],
    },
    resolutions: ['retry', 'report'],
  },
  {
    kind: 'offline',
    title: 'You appear to be offline',
    description:
      "We couldn't reach our servers, which usually means a network hiccup on the way. Check your connection and try again.",
    matchers: {
      statuses: [],
      messageIncludes: [
        'failed to fetch',
        'networkerror',
        'network error',
        'network request failed',
        'could not reach the backend',
        'could not reach the main platform',
        'connection issue',
        "isn't saving — check your connection",
        'load failed',
        'err_internet_disconnected',
        'err_network',
        'err_connection',
      ],
      names: ['NetworkError'],
    },
    resolutions: ['retry', 'reload'],
  },
  {
    kind: 'service_unavailable',
    title: 'A service is temporarily down',
    description:
      "A feature we rely on isn't responding or hasn't been set up for your deployment yet. It's on our side and usually clears on its own.",
    matchers: {
      statuses: [503],
      messageIncludes: [
        'service unavailable',
        'temporarily unavailable',
        'not configured',
        'storage not configured',
        'analytics not configured',
        'email service',
        'set learnhouse_judge0_api_url',
      ],
      names: [],
    },
    resolutions: ['wait', 'retry', 'report'],
  },
  {
    kind: 'timeout',
    title: 'That took too long',
    description:
      'The request timed out before it finished. The server may be busy — trying again usually works.',
    matchers: {
      statuses: [408, 504],
      messageIncludes: ['timeout', 'timed out', 'deadline exceeded', 'gateway timeout'],
      names: ['TimeoutError', 'AbortError'],
    },
    resolutions: ['retry', 'report'],
  },
  {
    kind: 'server',
    title: 'We hit a snag on our end',
    description:
      "Our servers returned an unexpected error while handling your request. This is on us, not you; trying again in a moment usually helps.",
    matchers: {
      statuses: [500, 502],
      messageIncludes: [
        'internal server error',
        'bad gateway',
        'storage service error',
        'analytics query failed',
        'unknown storage backend',
        'unexpected response',
        'the platform returned an unexpected response',
        'server error',
      ],
      names: [],
    },
    resolutions: ['retry', 'report', 'home'],
  },
]

// Catch-all. Has NO matchers (never matched by the loop) — classifyError()
// returns it explicitly when nothing else fits. Still meaningfully better than
// a bare "Something went wrong": it owns the problem and offers real next steps.
export const UNKNOWN_CATEGORY: ErrorCategory = {
  kind: 'unknown',
  title: "Something didn't go as planned",
  description:
    "We ran into an unexpected problem completing your request. It's been logged automatically and is likely temporary — trying again often clears it. If it keeps happening, tell us exactly what you were doing below.",
  matchers: { statuses: [], messageIncludes: [], names: [] },
  resolutions: ['retry', 'report', 'home', 'signout'],
}
