import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

export default withMDX({
  trailingSlash: false,
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', '@icons-pack/react-simple-icons'],
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
    ]
  },
})
