const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('common.next').NextConfig} */
const nextConfig = {
  // Required by PostHog's reverse-proxy rewrites below so the trailing-slash
  // handling on /ingest/* doesn't 308-redirect ingestion requests.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      // PostHog reverse proxy (EU cloud) — served same-origin so adblockers
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
      // Global security headers on every route — clickjacking (X-Frame-Options /
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
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '**',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
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
  const fs = require('fs')
  const path = require('path')
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

// Always wrap with Sentry — DSN is resolved at runtime, not build time
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  disableLogger: true,
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
