'use client'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * English strings of the SEO UI, under the `seo.` namespace. They are also
 * exported to the locale files; until a locale has them, `useSeoT` falls back
 * to these so the UI never shows raw keys.
 */
export const SEO_STRINGS = {
  tab: 'SEO',
  tabs: { search: 'Search', social: 'Social', advanced: 'Advanced', rich: 'Rich results', health: 'Health', general: 'Defaults', indexing: 'Indexing', verification: 'Verification' },
  slug: {
    title: 'Page URL',
    subtitle: 'A short, readable address with your main keywords. Old addresses keep working: they redirect here permanently.',
    label: 'URL slug',
    regenerate: 'Generate from title',
    save: 'Save URL',
    saved: 'URL updated. The previous address now redirects here.',
    checking: 'Checking…',
    available: 'Available',
    copy: 'Copy URL',
    copied: 'URL copied',
    errors: {
      empty: 'Enter a slug',
      too_long: 'Keep it under 80 characters',
      invalid_characters: 'Use lowercase letters, numbers and dashes',
      looks_like_id: 'A slug can’t look like an id',
      reserved: 'This word is reserved',
      taken: 'Already used by another item',
    },
    suggestion: 'Try “{{slug}}”',
  },
  search: {
    title: 'Search result',
    subtitle: 'What people see on Google, Bing and other search engines.',
    meta_title: 'Search title',
    meta_title_hint: 'Leave empty to use the name. 30–60 characters show in full.',
    meta_description: 'Meta description',
    meta_description_hint: 'Leave empty to use the description. 70–160 characters work best.',
    keywords: 'Focus keywords',
    keywords_hint: 'Comma-separated. The first one is checked against the title and description.',
    preview: 'Google preview',
    ai: 'Write with AI',
    ai_working: 'Writing…',
    ai_done: 'Suggestion applied. Review it and save.',
    ai_failed: 'The AI suggestion failed. Try again.',
  },
  social: {
    title: 'Social sharing',
    subtitle: 'How links look on LinkedIn, X, Facebook, Slack, WhatsApp…',
    og_title: 'Share title',
    og_description: 'Share description',
    image: 'Share image',
    image_hint: '1200 × 630 works everywhere. Without one, the thumbnail or a generated card is used.',
    upload: 'Upload image',
    replace: 'Replace',
    remove: 'Remove',
    uploading: 'Uploading…',
    generated: 'Generated card (used when there is no image)',
    card: 'X card',
    card_large: 'Large image',
    card_small: 'Small image',
    preview: 'Link preview',
  },
  advanced: {
    title: 'Indexing',
    subtitle: 'Control how search engines treat this page.',
    noindex: 'Hide from search engines',
    noindex_hint: 'Adds noindex and removes the page from the sitemap.',
    nofollow: 'Don’t follow links',
    nofollow_hint: 'Asks search engines not to follow links on this page.',
    jsonld: 'Structured data',
    jsonld_hint: 'Emit schema.org data for rich results (course info, breadcrumbs, FAQ).',
    canonical: 'Canonical URL',
    canonical_hint: 'Only if this content lives at another address. Leave empty in most cases.',
    og_type: 'Content type',
    image_alt: 'Thumbnail alt text',
    image_alt_hint: 'Describes the image for screen readers and image search.',
  },
  rich: {
    title: 'Rich results',
    subtitle: 'Extra details shown in Google’s course listings and FAQ snippets.',
    level: 'Level',
    level_none: 'Not set',
    level_beginner: 'Beginner',
    level_intermediate: 'Intermediate',
    level_advanced: 'Advanced',
    language: 'Language',
    language_hint: 'Language code of the content, e.g. en, fr, pt-BR. Defaults to the organization language.',
    workload: 'Time to complete (minutes)',
    prerequisites: 'Prerequisites',
    audience: 'Who it’s for',
    faq: 'Frequently asked questions',
    faq_hint: 'Real questions learners ask. Shown on Google as an FAQ snippet when eligible.',
    faq_question: 'Question',
    faq_answer: 'Answer',
    faq_add: 'Add question',
    faq_remove: 'Remove question',
  },
  score: {
    title: 'SEO score',
    good: 'Great',
    ok: 'Needs work',
    poor: 'Poor',
    checks: 'Checklist',
  },
  checks: {
    title_missing: 'Add a title.',
    title_long: 'Title is {{count}} characters; Google cuts it after about {{max}}.',
    title_short: 'Title is only {{count}} characters; aim for {{min}}–60.',
    title_ok: 'Title length is good ({{count}} characters).',
    description_missing: 'Add a meta description or a description.',
    description_long: 'Description is {{count}} characters; keep it under {{max}}.',
    description_short: 'Description is short ({{count}}); aim for {{min}}–160 characters.',
    description_ok: 'Description length is good.',
    slug_missing: 'Give the page a readable URL.',
    slug_long: 'The URL is long ({{count}} characters); shorter is better.',
    slug_numbered: 'The URL ends with a number; a distinct slug reads better.',
    slug_ok: 'The URL is short and readable.',
    image_ok: 'Has an image for search and sharing.',
    image_missing: 'Add a thumbnail or a share image.',
    alt_ok: 'The thumbnail has alt text.',
    alt_missing: 'Describe the thumbnail (alt text).',
    keyword_ok: '“{{keyword}}” is in the title and description.',
    keyword_not_in_title: 'Put “{{keyword}}” in the title.',
    keyword_not_in_description: 'Mention “{{keyword}}” in the description.',
    content_ok: 'Rich landing page ({{count}} words).',
    content_thin: 'Only {{count}} words on the page; write at least {{min}} in About.',
    learnings_ok: '{{count}} learning outcomes listed.',
    learnings_short: 'List at least 3 things learners will learn.',
    syllabus_ok: 'Syllabus with {{count}} chapters.',
    syllabus_empty: 'Add chapters: they become the syllabus in search.',
    faq_ok: 'Has FAQ questions.',
    faq_missing: 'Optional: add FAQ questions.',
    noindex: 'Hidden from search engines (noindex).',
    not_public: 'Not public yet: search engines can’t see it.',
    canonical_elsewhere: 'Canonical points to another URL.',
  },
  org: {
    title_template: 'Title template',
    title_template_hint: 'Use %s for the page name, e.g. “%s · Acme Academy”. Overrides the suffix.',
    org_type: 'Organization type',
    org_type_hint: 'How search engines describe your organization.',
    indexing_title: 'Search engine indexing',
    indexing_subtitle: 'Turn indexing off while you build, or for private academies.',
    indexing_disabled: 'Hide the whole site from search engines',
    indexing_disabled_hint: 'Every page gets noindex, robots.txt blocks crawling and the sitemap is emptied.',
    robots_extra: 'Extra robots.txt rules',
    robots_extra_hint: 'One directive per line (User-agent, Allow, Disallow, Crawl-delay). Other lines are ignored.',
    verification_title: 'Site verification',
    verification_subtitle: 'Prove you own the site in each search console. Paste only the code, not the whole tag.',
    google: 'Google Search Console',
    bing: 'Bing Webmaster Tools',
    yandex: 'Yandex Webmaster',
    pinterest: 'Pinterest',
    health_title: 'SEO health',
    health_subtitle: 'Every public page, scored. Fix the ones at the top first.',
    health_empty: 'No content yet.',
    health_issue_count: '{{count}} issues',
    health_duplicate: 'Same title as another page',
    health_fix: 'Fix',
    health_filter_all: 'All',
    health_filter_issues: 'With issues',
    health_average: 'Average score',
    health_pages: 'Pages',
    health_noindexed: 'Hidden from search',
    health_missing_description: 'No description',
    health_missing_image: 'No image',
    types: { course: 'Course', path: 'Path', podcast: 'Podcast', community: 'Community', folder: 'Folder' },
  },
  save_failed: 'Couldn’t save the SEO settings.',
  saved: 'SEO settings saved.',
} as const

function lookup(path: string): string | undefined {
  let node: any = SEO_STRINGS
  for (const part of path.split('.')) {
    node = node?.[part]
    if (node === undefined) return undefined
  }
  return typeof node === 'string' ? node : undefined
}

/** `t` for `seo.*` keys with the English fallback built in. */
export function useSeoT() {
  const { t, i18n } = useTranslation()
  const st = useCallback(
    (key: string, vars?: Record<string, unknown>) => t(`seo.${key}`, { defaultValue: lookup(key) ?? key, ...(vars || {}) }) as string,
    // i18n.language: re-render on language change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  )
  return st
}
