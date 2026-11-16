// The LearnHouse version this web build was made from, for the dashboard
// sidebar. Both values are inlined at build time by next.config.js.

export type LearnHouseVersion = {
  // Release version from package.json, e.g. "1.4.3".
  version: string
  // Short commit the image was built from, or null for local builds.
  build: string | null
  // Full commit, for a tooltip.
  buildFull: string | null
  // "v1.4.3 · 1ae8fbf", or "v1.4.3" without a build.
  label: string
  // Release notes for this version.
  releaseUrl: string
}

const RELEASES = 'https://github.com/learnhouse/learnhouse/releases'

export function describeVersion(rawVersion?: string | null, rawBuild?: string | null): LearnHouseVersion {
  const version = (rawVersion || '').trim().replace(/^v/, '') || '0.0.0'
  const full = (rawBuild || '').trim() || null
  // CI passes the commit SHA; anything else (a custom id) is shown as is.
  const build = full ? (/^[0-9a-f]{12,40}$/i.test(full) ? full.slice(0, 7) : full) : null
  return {
    version,
    build,
    buildFull: full,
    label: build ? `v${version} · ${build}` : `v${version}`,
    releaseUrl: version === '0.0.0' ? RELEASES : `${RELEASES}/tag/${version}`,
  }
}

export function getLearnHouseVersion(): LearnHouseVersion {
  return describeVersion(process.env.NEXT_PUBLIC_LEARNHOUSE_VERSION, process.env.NEXT_PUBLIC_LEARNHOUSE_BUILD)
}
