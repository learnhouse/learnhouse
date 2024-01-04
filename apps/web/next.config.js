/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: false,
}

const { withSentryConfig } = require("@sentry/nextjs");

const SentryWebpackPluginOptions = {
  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Transpiles SDK to be compatible with IE11 (increases bundle size)
  transpileClientSDK: true,

  // Routes browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers (increases server load)
  tunnelRoute: "/monitoring",

  // Hides source maps from generated client bundles
  hideSourceMaps: true,
}

module.exports = withSentryConfig(nextConfig, SentryWebpackPluginOptions);