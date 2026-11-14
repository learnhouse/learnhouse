import type { OrgSeoConfig } from './meta'

/** Paths that are never worth crawling (app chrome, per-user pages, APIs). */
export const ROBOTS_DISALLOW = ['/dash/', '/api/', '/auth/', '/editor/', '/admin/', '/account', '/messages', '/trail', '/search', '/embed/']

const ALLOWED_DIRECTIVE = /^(user-agent|allow|disallow|crawl-delay|sitemap|host|clean-param):\s*\S.*$/i

/**
 * Admin-provided extra robots.txt lines: only known directives survive, one
 * per line, so a typo can't produce a file crawlers misread.
 */
export function sanitizeRobotsRules(rules?: string | null): string[] {
  if (!rules) return []
  return rules
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#') && ALLOWED_DIRECTIVE.test(l))
    .slice(0, 100)
}

export function buildRobotsTxt(opts: { sitemapUrl: string; seo?: OrgSeoConfig }): string {
  if (opts.seo?.indexing_disabled) {
    // The whole org asked not to be indexed: block everything, no sitemap.
    return 'User-agent: *\nDisallow: /\n'
  }
  const lines = ['User-agent: *', 'Allow: /', ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`)]
  const extra = sanitizeRobotsRules(opts.seo?.robots_extra_rules)
  if (extra.length) lines.push('', '# Custom rules', ...extra)
  lines.push('', `Sitemap: ${opts.sitemapUrl}`)
  return `${lines.join('\n')}\n`
}
