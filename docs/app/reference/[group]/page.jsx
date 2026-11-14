import Link from 'next/link'
import { notFound } from 'next/navigation'
import { API_GROUPS, ACCESS_LABEL, RIGHTS_LABEL, groupBySlug } from '../../../lib/reference/config'
import { getSpec } from '../../../lib/reference/fetch-spec'
import { buildGroupModel } from '../../../lib/reference/build-model'
import { breadcrumbLd, jsonLdGraph, referenceMetadata, techArticleLd } from '../../../lib/reference/seo'
import OperationArticle from '../../../components/reference/OperationArticle'
import PageHeader from '../../../components/reference/PageHeader'
import JsonLd from '../../../components/reference/JsonLd'

export const revalidate = 3600
export const dynamicParams = false

export function generateStaticParams() {
  return API_GROUPS.map((g) => ({ group: g.slug }))
}

function pageTitle(config) {
  return `${config.title} API Reference`
}

export async function generateMetadata({ params }) {
  const { group } = await params
  const config = groupBySlug(group)
  if (!config) return {}
  return referenceMetadata({
    title: pageTitle(config),
    description: `${config.description} LearnHouse REST API endpoints with parameters, schemas and code examples.`,
    path: `/reference/${config.slug}`,
  })
}

const ACCESS_DETAIL = {
  token: 'Works with an lh_ API token or a user session.',
  'token-required': 'Server-to-server: an lh_ API token is required, user sessions are refused.',
  session: 'API tokens are refused. Call these with a signed-in user session.',
  public: 'Sign-in and credential endpoints, called with user credentials.',
}

export default async function GroupPage({ params }) {
  const { group } = await params
  const spec = await getSpec()
  const model = await buildGroupModel(spec, group)
  if (!model || model.operations.length === 0) notFound()

  const path = `/reference/${model.slug}`
  const jsonLd = jsonLdGraph(
    techArticleLd({
      title: pageTitle(model),
      description: model.description,
      path,
      about: [model.title],
    }),
    breadcrumbLd([{ name: model.title, path }])
  )

  return (
    <div className="lhr-page">
      <JsonLd data={jsonLd} />
      <PageHeader crumbs={[{ name: model.title }]} title={model.title} lede={model.description}>
        <div className="lhr-head-meta">
          <span className="lhr-tag">
            {model.operations.length} endpoint{model.operations.length === 1 ? '' : 's'}
          </span>
          <span className={`lhr-tag ${model.access === 'session' ? 'lhr-tag-muted' : ''}`}>
            {ACCESS_LABEL[model.access]}
          </span>
          {model.rightsBucket && (
            <span className="lhr-tag">
              Token right: {RIGHTS_LABEL[model.rightsBucket] || model.rightsBucket}
            </span>
          )}
          <span className="lhr-head-note">
            {ACCESS_DETAIL[model.access]}{' '}
            <Link href="/reference/guides/authentication">How auth works</Link>
          </span>
        </div>
      </PageHeader>

      <div className="lhr-ops">
        {model.operations.map((op) => (
          <OperationArticle key={op.id} op={op} />
        ))}
      </div>
    </div>
  )
}
