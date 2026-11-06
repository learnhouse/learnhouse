import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/mdx-components'
import Wrapper from '@/components/Wrapper/Wrapper'
import { getBreadcrumbs, getNeighbours, getPage, getPages, getTree, SITE_URL } from '@/lib/source'
import { clampDescription } from '@/lib/seo'

export const dynamicParams = false

export function generateStaticParams() {
  return getPages().map((page) => ({ slug: page.slug }))
}

const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

const HOME_TITLE = 'LearnHouse Docs: Open-Source LMS Documentation'

export async function generateMetadata(props) {
  const { slug = [] } = await props.params
  const page = getPage(slug)
  if (!page) return {}
  const url = `${SITE_URL}${page.route === '/' ? '' : page.route}`
  const md = `${SITE_URL}${page.route === '/' ? '/index' : page.route}.md`
  const image = { url: `${SITE_URL}/og${page.route === '/' ? '' : page.route}`, width: 1200, height: 630, alt: page.title }
  const description = clampDescription(page.description) || undefined
  return {
    title: page.route === '/' ? { absolute: HOME_TITLE } : page.title,
    description,
    alternates: { canonical: url, types: { 'text/markdown': md } },
    openGraph: {
      type: 'article',
      url,
      title: page.route === '/' ? HOME_TITLE : page.title,
      description,
      siteName: 'LearnHouse Docs',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: page.route === '/' ? HOME_TITLE : page.title, description, images: [image.url] },
  }
}

const ORGANIZATION = {
  '@type': 'Organization',
  '@id': 'https://learnhouse.app/#organization',
  name: 'LearnHouse',
  url: 'https://learnhouse.app',
  logo: `${SITE_URL}/img/logos/black_logo.png`,
  sameAs: ['https://github.com/learnhouse/learnhouse', 'https://discord.gg/CMyZjjYZ6x'],
}

function JsonLd({ page, crumbs }) {
  const url = `${SITE_URL}${page.route === '/' ? '' : page.route}`
  const graph =
    page.route === '/'
      ? [
          {
            '@type': 'WebSite',
            '@id': `${SITE_URL}/#website`,
            name: 'LearnHouse Docs',
            url: SITE_URL,
            inLanguage: 'en',
            publisher: { '@id': 'https://learnhouse.app/#organization' },
          },
          ORGANIZATION,
        ]
      : [
          {
            '@type': 'TechArticle',
            headline: page.title,
            description: page.description || undefined,
            url,
            dateModified: page.lastModified ? new Date(page.lastModified).toISOString() : undefined,
            inLanguage: 'en',
            isPartOf: { '@type': 'WebSite', name: 'LearnHouse Docs', url: SITE_URL },
            image: `${SITE_URL}/og${page.route}`,
            publisher: ORGANIZATION,
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [{ route: '/', title: 'Docs' }, ...crumbs].map((crumb, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: crumb.title,
              item: `${SITE_URL}${crumb.route === '/' ? '' : crumb.route}`,
            })),
          },
        ]
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}

export default async function Page(props) {
  const { slug = [] } = await props.params
  const page = getPage(slug)
  if (!page) notFound()

  const MDX = page.body
  const crumbs = getBreadcrumbs(page.route)
  const { prev, next } = getNeighbours(page.route)
  const toc = page.toc.map((item) => ({ id: item.url.replace(/^#/, ''), value: textOf(item.title), depth: item.depth }))

  return (
    <>
      <JsonLd page={page} crumbs={crumbs} />
      <Wrapper
        route={page.route}
        tree={getTree()}
        crumbs={crumbs}
        prev={prev}
        next={next}
        toc={toc}
        file={page.file}
        lastModified={page.lastModified}
      >
        <MDX components={getMDXComponents()} />
      </Wrapper>
    </>
  )
}
