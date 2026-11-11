const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// lastmod from the page's last commit, so search engines can tell which pages
// actually changed. Pages that aren't MDX files (reference, demos, releases)
// fall back to the build time.
function lastCommitDate(route) {
  const base = path.join(__dirname, 'content', route === '/' ? 'index' : route)
  const file = [`${base}.mdx`, path.join(base, 'index.mdx')].find((f) => fs.existsSync(f))
  if (!file) return null
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://docs.learnhouse.app',
  generateRobotsTxt: true,
  sitemapSize: 5000,
  exclude: ['/404', '/500', '/md', '/md/*', '/og', '/og/*', '/reference/llms.txt', '/reference/operations.json', '/reference/openapi.json', '/reference/llms/*'],
  robotsTxtOptions: {
    policies: [{ userAgent: '*', allow: '/', disallow: ['/md/'] }],
  },
  transform: async (config, route) => {
    const lastmod = lastCommitDate(route) ?? new Date().toISOString()
    if (route === '/') return { loc: route, changefreq: 'weekly', priority: 1.0, lastmod }
    if (/^\/(getting-started|platform|self-hosting|developers|demos|reference|releases|cli|enterprise|guides)\/?$/.test(route)) {
      return { loc: route, changefreq: 'weekly', priority: 0.8, lastmod }
    }
    return { loc: route, changefreq: 'monthly', priority: 0.6, lastmod }
  },
}
