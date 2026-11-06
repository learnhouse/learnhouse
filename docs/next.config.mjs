import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

export default withMDX({
  trailingSlash: false,
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', '@icons-pack/react-simple-icons'],
  },
  // Pages that moved or were merged into another one. Permanent, so search
  // engines move their ranking to the new URL.
  async redirects() {
    return [
      { source: '/platform/courses/collections', destination: '/platform/courses/library', permanent: true },
      { source: '/developers/demos', destination: '/demos', permanent: true },
      { source: '/self-hosting/installation/cli-reference', destination: '/cli/commands', permanent: true },
      { source: '/guides/custom-features/webhooks', destination: '/platform/automations/webhooks', permanent: true },
      { source: '/developers/api/endpoints', destination: '/reference', permanent: true },
    ]
  },
  async rewrites() {
    return [
      // Every docs page as Markdown, for AI agents: /developers/react.md
      { source: '/:path*.md', destination: '/md/:path*' },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // Images and icons rarely change; cache them for 30 days.
        source: '/:dir(img|favicons)/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000, stale-while-revalidate=86400' }],
      },
    ]
  },
})
