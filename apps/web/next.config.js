const fs = require('fs')
const path = require('path')
const { withSentryConfig } = require("@sentry/nextjs/config");

// Enterprise Edition modules are imported as `@ee/*`. They resolve to
// apps/web/ee when it is present (a copied-in folder or local symlink) and to the
// tracked no-op stubs in apps/web/ee-stub otherwise, so open-source builds
// compile without EE. LEARNHOUSE_DISABLE_EE=1 or LEARNHOUSE_PUBLIC=true forces
// the stubs even when ee/ exists.
const eeForcedOff =
  process.env.LEARNHOUSE_DISABLE_EE === '1' || process.env.LEARNHOUSE_PUBLIC === 'true'
const eeDir = path.join(__dirname, 'ee')
// A broken ee symlink makes `next build` fail with a bare ENOENT; say why.
try {
  if (fs.lstatSync(eeDir).isSymbolicLink() && !fs.existsSync(eeDir)) {
    throw new Error(
      `apps/web/ee is a symlink to ${fs.readlinkSync(eeDir)}, which does not exist. ` +
        'Fix the link or remove it to build without Enterprise features.'
    )
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}
// Check a known entrypoint rather than the folder: a leftover ee/ holding only
// untracked files (e.g. after pulling the commit that untracked it) must not
// switch the build to EE.
const eeEnabled =
  !eeForcedOff && fs.existsSync(path.join(eeDir, 'services', 'tenancy', 'resolveMulti.server.ts'))
const eeTarget = eeEnabled ? 'ee' : 'ee-stub'

// A symlinked ee/ (local dev against a sibling checkout) lives outside the
// project root, which Turbopack refuses to resolve. Widen the root to the
// nearest directory containing both.
function commonAncestor(a, b) {
  const pa = a.split(path.sep)
  const pb = b.split(path.sep)
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  // No shared prefix (e.g. different drives on Windows): leave the root alone.
  if (i === 0) return undefined
  return pa.slice(0, i).join(path.sep) || path.sep
}
// Done even when EE is off: Tailwind's `@source '../ee'` in globals.css still
// follows the link.
const eeRealDir = fs.existsSync(eeDir) ? fs.realpathSync(eeDir) : null
const turbopackRoot =
  eeRealDir && !eeRealDir.startsWith(fs.realpathSync(__dirname) + path.sep)
    ? commonAncestor(fs.realpathSync(__dirname), eeRealDir)
    : undefined

/** @type {import('common.next').NextConfig} */
const nextConfig = {
  // Required by PostHog's reverse-proxy rewrites below so the trailing-slash
  // handling on /ingest/* doesn't 308-redirect ingestion requests.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      // PostHog reverse proxy (EU cloud), served same-origin so adblockers
      // don't strip ingestion. The client SDK points at api_host: '/ingest'.
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },
  async headers() {
    return [
      // Global security headers on every route: clickjacking (X-Frame-Options /
      // frame-ancestors), MIME sniffing, referrer leakage and HSTS. The embed
      // override below comes AFTER this block, so it wins for the same header
      // keys on embed paths only (later source overrides earlier in Next).
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Download-Options', value: 'noopen' },
        ],
      },
      {
        source: '/embed/:orgslug/course/:courseuuid/activity/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors *',
          },
        ],
      },
      {
        // SCORM packages are served same-origin through /api/scorm and rendered
        // inside an iframe by the player. The global frame-ancestors 'none' /
        // X-Frame-Options: DENY above blocks even same-origin framing, so the
        // player shows "refused to connect". Allow the content to be framed by
        // its own origin (the player also needs same-origin contentDocument
        // access to inject the SCORM API and styles).
        source: '/api/scorm/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        // Resource activities embed an existing Library resource (board, course,
        // podcast, community, playground) inside a same-origin iframe in the
        // activity player. The global frame-ancestors 'none' / X-Frame-Options:
        // DENY above blocks even same-origin framing, so allow these resource
        // routes to be framed by their own origin. Both the public path form
        // (subdomain tenancy: /course/...) and the internal /orgs/:slug/... form
        // are covered so the override applies regardless of how the tenancy
        // proxy rewrites the path before it reaches Next.
        source: '/:kind(board|course|podcast|community|playground)/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: '/orgs/:orgslug/:kind(board|course|podcast|community|playground)/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ]
  },
  reactStrictMode: false,
  turbopack: {
    ...(turbopackRoot ? { root: turbopackRoot } : {}),
    resolveAlias: {
      '@ee/*': `./${eeTarget}/*`,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@ee': path.join(__dirname, eeTarget),
    }
    return config
  },
  // `next dev` refuses cross-origin requests for its own chunks. A local
  // multi-tenant run (DEMO_STACK.md) serves orgs from <slug>.lvh.me, so allow
  // that family of hosts. Dev-only; ignored by `next build`/`next start`.
  allowedDevOrigins: ['lvh.me', '*.lvh.me'],
  output: 'standalone',
  // No remote patterns: every next/image source is a bundled asset. Allowing
  // any host turned /_next/image into an open fetch proxy from the server.
  images: {
    remotePatterns: [],
  },
  experimental: {
    optimizePackageImports: [
      '@phosphor-icons/react',
      'framer-motion',
      'lucide-react',
      '@emoji-mart/react',
      '@emoji-mart/data',
      'dayjs',
      'highlight.js',
      'recharts',
      '@radix-ui/react-icons',
      '@hello-pangea/dnd',
      'react-i18next',
      '@tiptap/core',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/extension-table',
      '@tiptap/extension-table-cell',
      '@tiptap/extension-table-header',
      '@tiptap/extension-table-row',
      '@tiptap/extension-youtube',
      '@tiptap/extension-link',
      '@tiptap/extension-placeholder',
      '@tiptap/extension-code-block-lowlight',
      '@tiptap/extension-heading',
      '@tiptap/extension-bullet-list',
      '@tiptap/extension-ordered-list',
      '@tiptap/extension-list-item',
      '@tiptap/extension-collaboration',
      '@tiptap/extension-collaboration-caret',
      '@uiw/react-codemirror',
      'lowlight',
      'katex',
      'react-katex',
    ],
  },
  // Ensure consistent build IDs across multiple pods in Kubernetes
  generateBuildId: async () => {
    return process.env.BUILD_ID || 'learnhouse-production'
  },
}

// Generate runtime config for development
if (process.env.NODE_ENV === 'development') {
  const runtimeConfig = {}

  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('NEXT_PUBLIC_')) {
      runtimeConfig[key] = process.env[key]
    }
  })

  const publicDir = path.join(__dirname, 'public')
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })

  fs.writeFileSync(
    path.join(publicDir, 'runtime-config.js'),
    `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    'utf8'
  )
}

// Always wrap with Sentry; DSN is resolved at runtime, not build time
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  tunnelRoute: "/monitoring",
  sourcemaps: {
    disable: !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT,
  },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
});
