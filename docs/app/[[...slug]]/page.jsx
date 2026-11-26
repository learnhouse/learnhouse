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

const HOME_TITLE = 'LearnHouse Docs: Open-Source LMS, API, SDK & React Components'

const searchTitleOf = (page) => (page.route === '/' ? HOME_TITLE : page.seoTitle || page.title)

const REPO = 'https://github.com/learnhouse/learnhouse'
const PACKAGE_INFO = {
  '@learnhouse/react': { dir: 'packages/react', runtime: 'React 18, React 19' },
  '@learnhouse/vue': { dir: 'packages/vue', runtime: 'Vue 3, Nuxt' },
  '@learnhouse/sdk': { dir: 'packages/sdk', runtime: 'Browsers, Node.js, Bun, Deno, edge runtimes, React Native' },
}

export async function generateMetadata(props) {
  const { slug = [] } = await props.params
  const page = getPage(slug)
  if (!page) return {}
  const url = `${SITE_URL}${page.route === '/' ? '' : page.route}`
  const md = `${SITE_URL}${page.route === '/' ? '/index' : page.route}.md`
  const image = { url: `${SITE_URL}/og${page.route === '/' ? '' : page.route}`, width: 1200, height: 630, alt: page.title }
  const description = clampDescription(page.description) || undefined
  const searchTitle = searchTitleOf(page)
  return {
    // seoTitle is written for search results and used as-is; other pages get the site suffix.
    title: page.route === '/' || page.seoTitle ? { absolute: searchTitle } : page.title,
    description,
    alternates: { canonical: url, types: { 'text/markdown': md } },
    openGraph: {
      type: 'article',
      url,
      title: searchTitle,
      description,
      siteName: 'LearnHouse Docs',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: searchTitle, description, images: [image.url] },
  }
}

const ORGANIZATION = {
  '@type': 'Organization',
  '@id': 'https://learnhouse.app/#organization',
  name: 'LearnHouse',
  url: 'https://learnhouse.app',
  logo: `${SITE_URL}/img/logos/black_logo.png`,
  sameAs: [
    'https://github.com/learnhouse/learnhouse',
    'https://www.npmjs.com/org/learnhouse',
    'https://x.com/getlearnhouse',
    'https://discord.gg/CMyZjjYZ6x',
  ],
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
          {
            '@type': 'SoftwareApplication',
            '@id': 'https://learnhouse.app/#software',
            name: 'LearnHouse',
            description:
              'Open-source learning management system (LMS) with a block editor, AI tutoring, assignments and payments. Runs on LearnHouse Cloud or self-hosted, with a REST API, a TypeScript SDK (@learnhouse/sdk) and React and Vue components (@learnhouse/react, @learnhouse/vue).',
            applicationCategory: 'EducationalApplication',
            operatingSystem: 'Linux, macOS, Windows (Docker), Web',
            license: 'https://www.gnu.org/licenses/agpl-3.0.html',
            url: 'https://learnhouse.app',
            downloadUrl: REPO,
            softwareHelp: SITE_URL,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            publisher: { '@id': 'https://learnhouse.app/#organization' },
          },
        ]
      : [
          {
            '@type': 'TechArticle',
            headline: searchTitleOf(page),
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
  if (page.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: page.faq.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    })
  }
  const pkg = page.package && PACKAGE_INFO[page.package]
  if (pkg) {
    graph.push({
      '@type': 'SoftwareSourceCode',
      '@id': `${url}#package`,
      name: page.package,
      description: page.description || undefined,
      codeRepository: `${REPO}/tree/dev/${pkg.dir}`,
      programmingLanguage: ['TypeScript', 'JavaScript'],
      runtimePlatform: pkg.runtime,
      license: 'https://opensource.org/licenses/MIT',
      url: `https://www.npmjs.com/package/${page.package}`,
      author: { '@id': 'https://learnhouse.app/#organization' },
    })
  }
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
