const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('common.next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Get backend URL from env for API proxy
    const backendUrl = process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL || 'http://localhost:1338'

    return [
      // Proxy API requests through Next.js for same-origin cookie handling
      // This is essential for custom domains where cross-origin cookies don't work
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
      {
        source: '/umami/script.js',
        destination: `https://eu.umami.is/script.js`,
      },
      {
        source: '/umami/api/send',
        destination: `https://eu.umami.is/api/send`,
      },
    ]
  },
  async headers() {
    return [
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
    ]
  },
  reactStrictMode: false,
  output: 'standalone',
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

// Only wrap with Sentry if DSN is configured
const SENTRY_DSN = process.env.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN;

if (SENTRY_DSN) {
  module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    widenClientFileUpload: true,
    disableLogger: true,
    automaticVercelMonitors: true,
  });
} else {
  module.exports = nextConfig;
}
