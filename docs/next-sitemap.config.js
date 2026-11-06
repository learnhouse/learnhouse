/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://docs.learnhouse.app',
  generateRobotsTxt: true,
  sitemapSize: 5000,
  exclude: ['/404', '/500', '/md', '/md/*', '/og', '/og/*', '/reference/llms.txt', '/reference/operations.json', '/reference/llms/*'],
  robotsTxtOptions: {
    policies: [{ userAgent: '*', allow: '/' }],
  },
  transform: async (config, path) => {
    if (path === '/') {
      return { loc: path, changefreq: 'weekly', priority: 1.0, lastmod: new Date().toISOString() }
    }
    if (/^\/(getting-started|platform|self-hosting|developers|demos|reference|releases|cli|enterprise)\/?$/.test(path)) {
      return { loc: path, changefreq: 'weekly', priority: 0.8, lastmod: new Date().toISOString() }
    }
    return { loc: path, changefreq: 'monthly', priority: 0.6, lastmod: new Date().toISOString() }
  },
}
