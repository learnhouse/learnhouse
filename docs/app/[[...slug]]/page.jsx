import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/mdx-components'
import Wrapper from '@/components/Wrapper/Wrapper'
import { getBreadcrumbs, getNeighbours, getPage, getPages, getTree, SITE_URL } from '@/lib/source'

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

export async function generateMetadata(props) {
  const { slug = [] } = await props.params
  const page = getPage(slug)
  if (!page) return {}
  const url = `${SITE_URL}${page.route === '/' ? '' : page.route}`
  const md = `${SITE_URL}${page.route === '/' ? '/index' : page.route}.md`
  const image = { url: `${SITE_URL}/og${page.route === '/' ? '' : page.route}`, width: 1200, height: 630, alt: page.title }
  return {
    title: page.route === '/' ? { absolute: 'LearnHouse Docs' } : page.title,
    description: page.description || undefined,
    alternates: { canonical: url, types: { 'text/markdown': md } },
    openGraph: {
      type: 'article',
      url,
      title: page.title,
      description: page.description || undefined,
      siteName: 'LearnHouse Docs',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description || undefined, images: [image.url] },
  }
}

function JsonLd({ page, crumbs }) {
  const url = `${SITE_URL}${page.route === '/' ? '' : page.route}`
  const graph =
    page.route === '/'
      ? [
          {
            '@type': 'WebSite',
            name: 'LearnHouse Docs',
            url: SITE_URL,
            publisher: { '@type': 'Organization', name: 'LearnHouse', url: 'https://learnhouse.app' },
          },
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
            publisher: { '@type': 'Organization', name: 'LearnHouse', url: 'https://learnhouse.app' },
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
