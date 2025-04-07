/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbo: {}, // to disable this warning: "⚠ Webpack is configured while Turbopack is not, which may cause problems."
  },
  async rewrites() {
    return [
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
  reactStrictMode: false,
  output: 'standalone',
}

module.exports = nextConfig
