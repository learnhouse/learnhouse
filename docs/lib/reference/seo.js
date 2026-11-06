import { clampDescription } from '../seo'
import { SITE_URL } from './config'

/** BreadcrumbList: Docs → API Reference → …crumbs ({ name, path }). */
export function breadcrumbLd(crumbs) {
  const items = [
    { name: 'LearnHouse Docs', path: '/' },
    { name: 'API Reference', path: '/reference' },
    ...crumbs,
  ]
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  }
}

/** TechArticle for a reference page. */
export function techArticleLd({ title, description, path, about = [] }) {
  return {
    '@type': 'TechArticle',
    headline: title,
    description,
    url: `${SITE_URL}${path}`,
    mainEntityOfPage: `${SITE_URL}${path}`,
    inLanguage: 'en',
    proficiencyLevel: 'Expert',
    about: [{ '@type': 'Thing', name: 'LearnHouse REST API' }, ...about.map((name) => ({ '@type': 'Thing', name }))],
    isPartOf: { '@type': 'WebSite', name: 'LearnHouse Docs', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'LearnHouse', url: 'https://www.learnhouse.app' },
  }
}

export function jsonLdGraph(...nodes) {
  return { '@context': 'https://schema.org', '@graph': nodes }
}

/** Page metadata with canonical + Open Graph URL in one place. */
export function referenceMetadata({ title, description: full, path }) {
  const description = clampDescription(full)
  const image = { url: `${SITE_URL}/og/reference`, width: 1200, height: 630, alt: title }
  return {
    title,
    description,
    alternates: {
      canonical: path,
      types: { 'text/markdown': '/reference/llms.txt' },
    },
    openGraph: { title, description, url: `${SITE_URL}${path}`, type: 'article', siteName: 'LearnHouse Docs', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  }
}
