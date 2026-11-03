// Client-side instrumentation; runs before the app on every page load
// This is the Turbopack-compatible way to initialize Sentry on the client
import * as Sentry from '@sentry/nextjs';
import { installDomMutationGuard } from './lib/errors/domMutationGuard';
import { installStorageGuard } from './lib/errors/storageGuard';
import './sentry.client.config';

// Before React mounts, so a translated page or a blocked-storage iframe can't
// crash it.
installDomMutationGuard();
installStorageGuard();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
