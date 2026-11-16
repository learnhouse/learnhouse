import type { OrgSeoConfig } from './meta'

/** Paths that are never worth crawling (app chrome, per-user pages, APIs). */
export const ROBOTS_DISALLOW = ['/dash/', '/api/', '/auth/', '/editor/', '/admin/', '/account', '/messages', '/trail', '/search', '/embed/']

/**
 * AI crawlers that collect pages to train models. Blocking them keeps the
 * org's content out of training sets without affecting web search (Google
 * search uses Googlebot; `Google-Extended` only governs Gemini training).
 */
export const AI_TRAINING_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Meta-ExternalAgent',
  'Bytespider',
  'cohere-training-data-crawler',
  'cohere-ai',
  'Amazonbot',
  'Diffbot',
  'AI2Bot',
  'PanguBot',
  'Timpibot',
  'omgili',
] as const

/**
 * AI answer engines: they fetch a page when someone asks about it and cite it
 * (ChatGPT search, Claude, Perplexity...). Like search engines, they send
 * visitors, so the "block training" policy keeps them.
 */
export const AI_ANSWER_BOTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'DuckAssistBot',
  'MistralAI-User',
  'Meta-ExternalFetcher',
] as const

export type AiCrawlerPolicy = 'allow' | 'block_training' | 'block_all'

/** User agents the org's AI policy (plus its custom list) blocks. */
export function blockedAiBots(seo?: OrgSeoConfig): string[] {
  const policy: AiCrawlerPolicy = (seo?.ai_crawler_policy as AiCrawlerPolicy) || 'allow'
  const base: string[] =
    policy === 'block_all' ? [...AI_TRAINING_BOTS, ...AI_ANSWER_BOTS] : policy === 'block_training' ? [...AI_TRAINING_BOTS] : []
  const extra = (seo?.ai_crawlers_blocked || []).filter((n) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n))
  return Array.from(new Set([...base, ...extra]))
}

/**
 * The Content Signals statement (contentsignals.org) of the same policy:
 * search, AI answers (ai-input), model training. Written as a comment:
 * `Content-Signal:` is not an RFC 9309 directive, and validators (Lighthouse's
 * robots.txt audit, Search Console) flag unknown directives as errors.
 */
export function contentSignal(seo?: OrgSeoConfig): string {
  const policy = seo?.ai_crawler_policy || 'allow'
  const aiInput = policy === 'block_all' ? 'no' : 'yes'
  const aiTrain = policy === 'allow' ? 'yes' : 'no'
  return `# Content-Signal: search=yes, ai-input=${aiInput}, ai-train=${aiTrain}`
}

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

export function buildRobotsTxt(opts: { sitemapUrl: string; seo?: OrgSeoConfig; llmsUrl?: string }): string {
  if (opts.seo?.indexing_disabled) {
    // The whole org asked not to be indexed: block everything, no sitemap.
    return 'User-agent: *\nDisallow: /\n'
  }
  const lines = [contentSignal(opts.seo), 'User-agent: *', 'Allow: /', ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`)]
  const blocked = blockedAiBots(opts.seo)
  if (blocked.length) {
    lines.push('', '# AI crawlers blocked by this organization')
    for (const bot of blocked) lines.push(`User-agent: ${bot}`)
    lines.push('Disallow: /')
  }
  const extra = sanitizeRobotsRules(opts.seo?.robots_extra_rules)
  if (extra.length) lines.push('', '# Custom rules', ...extra)
  lines.push('', `Sitemap: ${opts.sitemapUrl}`)
  if (opts.llmsUrl) lines.push(`# LLM-readable summary: ${opts.llmsUrl}`)
  return `${lines.join('\n')}\n`
}
