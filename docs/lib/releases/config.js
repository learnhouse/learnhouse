/**
 * Releases hub configuration: where release data comes from and how long it
 * is cached. Shared by the /releases pages, getLatestVersions() and the
 * snapshot script (scripts/releases-snapshot.mjs).
 */

export const GITHUB_REPO = 'learnhouse/learnhouse'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`

/** Max pages of 100 releases to walk. Guards against a runaway Link chain. */
export const MAX_RELEASE_PAGES = 10

export const NPM_REGISTRY = 'https://registry.npmjs.org'
export const NPM_PACKAGES = ['@learnhouse/sdk', '@learnhouse/react', '@learnhouse/vue']

export const APP_IMAGE = 'ghcr.io/learnhouse/app'

/** ISR window for every /releases page and for the underlying fetches. */
export const RELEASES_REVALIDATE_SECONDS = 3600
export const RELEASES_CACHE_TAG = 'releases'

/** CLI releases are tagged `cli-x.y.z`; everything else is an app release. */
export const CLI_TAG_PREFIX = 'cli-'

/** Change items shown before a release's notes collapse behind "Show all". */
export const COLLAPSE_VISIBLE_ITEMS = 6
/** Only collapse when it hides at least this many more items. */
export const COLLAPSE_MIN_HIDDEN = 3
