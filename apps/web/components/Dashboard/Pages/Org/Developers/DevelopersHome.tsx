'use client'
import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BracketsCurly,
  Check,
  Code,
  Globe,
  Key,
  Lifebuoy,
  FlowArrow,
  ListChecks,
  Plug,
  ShieldCheck,
  Terminal,
  GraduationCap,
  Books,
} from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { usePlan } from '@components/Hooks/usePlan'
import { useResolvedFeature } from '@components/Hooks/useResolvedFeature'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { Chip, SectionCard, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { isFeatureAvailable, type PlanLevel } from '@services/plans/plans'
import { listAPITokens, type APIToken } from '@services/api_tokens/api_tokens'
import { listCustomDomains, type CustomDomain } from '@services/custom_domains/custom_domains'
import { getMCPSettings, listMCPConnections, type MCPConnection } from '@services/mcp/mcp'
import { getSSOConfig } from '@services/auth/sso'
import type { WebhookEndpoint } from '@services/webhooks/webhooks'
import { buildSnippets } from '@components/Admin/Developers/snippets'
import { CodeBlock, DOCS, MonoField, StatusCode, absoluteApiBase } from './devKit'

type StepState = 'done' | 'pending' | 'todo' | 'locked' | 'loading'

interface Step {
  key: string
  icon: React.ReactNode
  title: string
  description: string
  href?: string
  onClick?: () => void
  state: StepState
  requiredPlan?: PlanLevel
  // Extra status next to the title, e.g. "Verifying" for a pending domain.
  note?: string
}

export default function DevelopersHome() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const plan = usePlan()
  const orgId: number | undefined = org?.id
  const base = getUriWithOrg(org?.slug ?? '', '') + '/dash/developers'
  const ready = !!(orgId && accessToken)

  // Each step reads the same queries its tab uses, so the cache is shared and
  // opening a tab after the hub costs nothing. Gated features are not queried:
  // the API would refuse and the step shows the plan instead.
  const api = useResolvedFeature('api_access')
  const webhooks = useResolvedFeature('webhooks')
  const domains = useResolvedFeature('custom_domains')
  const sso = useResolvedFeature('sso')
  const ssoAvailable = isFeatureAvailable('sso')

  const tokensQ = useQuery<APIToken[]>({
    queryKey: orgId ? ['org', orgId, 'api-tokens'] : ['api-tokens-disabled'],
    queryFn: () => listAPITokens(orgId as number, accessToken as string),
    enabled: ready && !api.reason && !api.loading,
    staleTime: 60_000,
    retry: false,
  })
  const webhooksQ = useQuery<WebhookEndpoint[]>({
    queryKey: orgId ? queryKeys.org.automations(orgId) : ['automations-disabled'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/webhooks`, accessToken),
    enabled: ready && !webhooks.reason && !webhooks.loading,
    staleTime: 60_000,
    retry: false,
  })
  const domainsQ = useQuery<CustomDomain[]>({
    queryKey: orgId ? ['org', orgId, 'domains'] : ['domains-disabled'],
    queryFn: () => listCustomDomains(orgId as number, accessToken as string),
    enabled: ready && !domains.reason && !domains.loading,
    staleTime: 60_000,
    retry: false,
  })
  const mcpSettingsQ = useQuery({
    queryKey: ['org', orgId, 'mcp', 'settings'],
    queryFn: () => getMCPSettings(orgId as number, accessToken as string),
    enabled: ready,
    retry: false,
  })
  const mcpConnectionsQ = useQuery<MCPConnection[]>({
    queryKey: ['org', orgId, 'mcp', 'connections', 'org'],
    queryFn: () => listMCPConnections(orgId as number, 'org', accessToken as string),
    enabled: ready,
    retry: false,
  })
  const ssoQ = useQuery({
    queryKey: ['org', orgId, 'sso', 'config'],
    queryFn: () => getSSOConfig(orgId as number, accessToken as string),
    enabled: ready && ssoAvailable && !sso.reason && !sso.loading,
    staleTime: 60_000,
    retry: false,
  })

  const tokens = Array.isArray(tokensQ.data) ? tokensQ.data : []
  const hooks = Array.isArray(webhooksQ.data) ? webhooksQ.data : []
  const domainList = Array.isArray(domainsQ.data) ? domainsQ.data : []
  const connections = Array.isArray(mcpConnectionsQ.data) ? mcpConnectionsQ.data : []

  const stateFor = (
    gate: { reason?: string; loading: boolean },
    q: { isLoading: boolean; isError: boolean },
    done: boolean
  ): StepState => {
    if (gate.reason) return 'locked'
    if (gate.loading || q.isLoading) return 'loading'
    if (q.isError) return 'todo'
    return done ? 'done' : 'todo'
  }

  const pendingDomain = domainList.some((d) => d.status === 'pending')
  const verifiedDomain = domainList.some((d) => d.status === 'verified')

  const steps: Step[] = [
    {
      key: 'token',
      icon: <Key size={16} />,
      title: t('dashboard.developers.home.steps.token.title'),
      description: t('dashboard.developers.home.steps.token.description'),
      href: `${base}/api`,
      state: stateFor(api, tokensQ, tokens.some((tk) => tk.is_active)),
      requiredPlan: api.reason === 'plan' ? 'pro' : undefined,
    },
    {
      key: 'request',
      icon: <Terminal size={16} />,
      title: t('dashboard.developers.home.steps.request.title'),
      description: t('dashboard.developers.home.steps.request.description'),
      onClick: () => document.getElementById('first-request')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      state: stateFor(api, tokensQ, tokens.some((tk) => !!tk.last_used_at)),
      requiredPlan: api.reason === 'plan' ? 'pro' : undefined,
    },
    {
      key: 'mcp',
      icon: <Plug size={16} />,
      title: t('dashboard.developers.home.steps.mcp.title'),
      description: t('dashboard.developers.home.steps.mcp.description'),
      href: `${base}/mcp`,
      state: stateFor({ loading: false }, mcpConnectionsQ, connections.length > 0),
    },
    {
      key: 'webhook',
      icon: <FlowArrow size={16} />,
      title: t('dashboard.developers.home.steps.webhook.title'),
      description: t('dashboard.developers.home.steps.webhook.description'),
      href: `${base}/automations`,
      state: stateFor(webhooks, webhooksQ, hooks.length > 0),
      requiredPlan: webhooks.reason === 'plan' ? 'pro' : undefined,
    },
    {
      key: 'domain',
      icon: <Globe size={16} />,
      title: t('dashboard.developers.home.steps.domain.title'),
      description: t('dashboard.developers.home.steps.domain.description'),
      href: `${base}/domains`,
      state: verifiedDomain
        ? 'done'
        : pendingDomain && !domains.reason
          ? 'pending'
          : stateFor(domains, domainsQ, false),
      requiredPlan: domains.reason === 'plan' ? 'pro' : undefined,
      note: !verifiedDomain && pendingDomain ? t('dashboard.developers.home.steps.domain.pending') : undefined,
    },
    ...(ssoAvailable
      ? [
          {
            key: 'sso',
            icon: <ShieldCheck size={16} />,
            title: t('dashboard.developers.home.steps.sso.title'),
            description: t('dashboard.developers.home.steps.sso.description'),
            href: `${base}/sso`,
            state: stateFor(sso, ssoQ, !!ssoQ.data?.enabled),
            requiredPlan: sso.reason === 'plan' ? ('enterprise' as PlanLevel) : undefined,
          },
        ]
      : []),
  ]

  const doneCount = steps.filter((s) => s.state === 'done').length
  const progress = Math.round((doneCount / steps.length) * 100)

  const apiBase = absoluteApiBase(getAPIUrl())
  const snippets = buildSnippets({
    method: 'GET',
    url: `${apiBase}courses/org_slug/${org?.slug ?? '{org_slug}'}/page/1/limit/10`,
  })

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <section className="relative overflow-hidden bg-white rounded-2xl nice-shadow">
        <div
          aria-hidden
          className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(0,0,0,0.07)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:linear-gradient(to_left,black,transparent_70%)] rtl:[mask-image:linear-gradient(to_right,black,transparent_70%)]"
        />
        <BracketsCurly
          aria-hidden
          size={180}
          weight="thin"
          className="hidden md:block absolute -bottom-8 end-6 text-neutral-900/[0.04]"
        />
        <div className="relative px-5 py-6 sm:px-7 sm:py-7 flex flex-col gap-5">
          <div className="flex flex-col gap-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <Chip icon={<Code size={12} weight="bold" />}>{t('dashboard.developers.home.eyebrow')}</Chip>
              <code dir="ltr" className="font-mono text-[11px] text-neutral-400">REST · MCP · Webhooks</code>
            </div>
            <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight text-neutral-900">
              {t('dashboard.developers.home.hero_title')}
            </h2>
            <p className="text-sm text-neutral-500">{t('dashboard.developers.home.hero_subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${base}/api`} className={buttonClass('primary', 'md')}>
              <Key size={14} />
              {t('dashboard.developers.home.create_token')}
            </Link>
            <a href={DOCS.apiOverview} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>
              <BookOpen size={14} />
              {t('dashboard.developers.home.read_docs')}
              <ArrowUpRight size={12} className="text-neutral-400 rtl:-scale-x-100" />
            </a>
            <a href={DOCS.apiReference} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md')}>
              <Books size={14} />
              {t('dashboard.developers.home.api_reference')}
              <ArrowUpRight size={12} className="text-neutral-400 rtl:-scale-x-100" />
            </a>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          {/* Quick start */}
          <SectionCard
            icon={<ListChecks size={18} />}
            title={t('dashboard.developers.home.quickstart_title')}
            description={t('dashboard.developers.home.quickstart_description')}
            actions={
              <span className="text-xs font-semibold text-neutral-500 tabular-nums">
                {t('dashboard.developers.home.progress', { done: doneCount, total: steps.length })}
              </span>
            }
            bodyClassName="pt-4 pb-2"
          >
            <div className="px-5 pb-3">
              <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <ol className="divide-y divide-neutral-100">
              {steps.map((step, i) => (
                <QuickStep key={step.key} step={step} index={i + 1} plan={plan} />
              ))}
            </ol>
          </SectionCard>

          {/* First request */}
          <div id="first-request" className="scroll-mt-6">
            <SectionCard
              icon={<Terminal size={18} />}
              title={t('dashboard.developers.home.first_request_title')}
              description={t('dashboard.developers.home.first_request_description')}
              actions={
                <a
                  href={DOCS.apiAuth}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass('ghost', 'sm')}
                >
                  {t('dashboard.developers.home.auth_docs')}
                  <ArrowUpRight size={12} className="rtl:-scale-x-100" />
                </a>
              }
            >
              <CodeBlock
                tabs={[
                  { key: 'curl', label: 'cURL', code: snippets.curl, lang: 'bash' },
                  { key: 'js', label: 'JavaScript', code: snippets.js, lang: 'js' },
                  { key: 'python', label: 'Python', code: snippets.python, lang: 'python' },
                ]}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-neutral-500">
                <span className="flex items-center gap-2">
                  <StatusCode code={200}>OK</StatusCode>
                  {t('dashboard.developers.home.first_request_returns')}
                </span>
                <span>
                  {t('dashboard.developers.home.replace_token_prefix')}{' '}
                  <code className="font-mono text-[11.5px] text-neutral-700 bg-neutral-100 rounded px-1 py-0.5">{'<YOUR_TOKEN>'}</code>{' '}
                  {t('dashboard.developers.home.replace_token_suffix')}{' '}
                  <Link href={`${base}/api`} className="font-semibold text-neutral-800 hover:underline">
                    {t('dashboard.developers.home.replace_token_link')}
                  </Link>
                </span>
              </div>
            </SectionCard>
          </div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          {/* Essentials */}
          <SectionCard
            icon={<BracketsCurly size={18} />}
            title={t('dashboard.developers.home.essentials_title')}
            description={t('dashboard.developers.home.essentials_description')}
          >
            <div className="flex flex-col gap-3.5">
              <MonoField label={t('dashboard.developers.home.api_base_url')} value={apiBase} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3.5">
                <MonoField label={t('dashboard.developers.home.org_id')} value={orgId ? String(orgId) : ''} />
                <MonoField label={t('dashboard.developers.home.org_slug')} value={org?.slug ?? ''} />
              </div>
              <MonoField
                label={t('dashboard.developers.home.mcp_endpoint')}
                value={mcpSettingsQ.data?.mcp_url ?? ''}
                placeholder={mcpSettingsQ.isLoading ? '…' : '—'}
              />
              <MonoField
                label={t('dashboard.developers.home.auth_header')}
                value="Authorization: Bearer <YOUR_TOKEN>"
                hint={t('dashboard.developers.home.auth_header_hint')}
              />
            </div>
          </SectionCard>

          {/* Docs & resources */}
          <SectionCard
            icon={<BookOpen size={18} />}
            title={t('dashboard.developers.home.resources_title')}
            description={t('dashboard.developers.home.resources_description')}
            bodyClassName="pt-3 pb-2"
          >
            <ul className="divide-y divide-neutral-100">
              <ResourceLink href={DOCS.apiOverview} icon={<BookOpen size={15} />} label={t('dashboard.developers.home.res.api_overview')} />
              <ResourceLink href={DOCS.apiAuth} icon={<Key size={15} />} label={t('dashboard.developers.home.res.api_auth')} />
              <ResourceLink href={DOCS.apiReference} icon={<Books size={15} />} label={t('dashboard.developers.home.res.api_reference')} />
              <ResourceLink href={DOCS.mcp} icon={<Plug size={15} />} label={t('dashboard.developers.home.res.mcp')} />
              <ResourceLink href={DOCS.webhooks} icon={<FlowArrow size={15} />} label={t('dashboard.developers.home.res.webhooks')} />
              <ResourceLink href={DOCS.domains} icon={<Globe size={15} />} label={t('dashboard.developers.home.res.domains')} />
              {ssoAvailable && (
                <ResourceLink href={DOCS.sso} icon={<ShieldCheck size={15} />} label={t('dashboard.developers.home.res.sso')} />
              )}
              {isFeatureAvailable('lti') && (
                <ResourceLink href={DOCS.lti} icon={<GraduationCap size={15} />} label={t('dashboard.developers.home.res.lti')} />
              )}
              <ResourceLink
                href="mailto:hello@learnhouse.app"
                icon={<Lifebuoy size={15} />}
                label={t('dashboard.organization.api_access.something_not_working')}
              />
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function QuickStep({ step, index, plan }: { step: Step; index: number; plan: PlanLevel }) {
  const { t } = useTranslation()
  const done = step.state === 'done'
  const inner = (
    <>
      <span
        className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold tabular-nums transition-colors ${
          done
            ? 'bg-emerald-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
            : step.state === 'pending'
              ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/30'
              : 'bg-white text-neutral-400 ring-1 ring-inset ring-neutral-200'
        }`}
        aria-hidden
      >
        {done ? <Check size={12} weight="bold" /> : index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-semibold ${done ? 'text-neutral-500 line-through decoration-neutral-300' : 'text-neutral-900'}`}>
            {step.title}
          </span>
          {step.requiredPlan && <PlanBadge currentPlan={plan} requiredPlan={step.requiredPlan} noMargin />}
          {step.note && <Chip tone="amber">{step.note}</Chip>}
          {step.state === 'loading' && <span className="h-3 w-10 rounded bg-neutral-100 animate-pulse" />}
        </span>
        <span className="block mt-0.5 text-xs text-neutral-500">{step.description}</span>
      </span>
      <span className="self-center flex items-center gap-1.5 text-xs font-semibold text-neutral-400 group-hover:text-neutral-700 transition-colors shrink-0">
        <span className="hidden sm:inline">{done ? t('dashboard.developers.home.step_open') : t('dashboard.developers.home.step_start')}</span>
        <ArrowRight size={13} className="rtl:rotate-180 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
      </span>
    </>
  )
  const cls = 'group w-full flex items-start gap-3 px-5 py-3.5 text-start hover:bg-neutral-50/70 transition-colors'
  return (
    <li>
      {step.href ? (
        <Link href={step.href} className={cls}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={step.onClick} className={cls}>
          {inner}
        </button>
      )}
    </li>
  )
}

function ResourceLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  const external = href.startsWith('http')
  return (
    <li>
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="group flex items-center gap-3 px-5 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50/70 hover:text-neutral-900 transition-colors"
      >
        <span className="text-neutral-400 group-hover:text-neutral-600 transition-colors">{icon}</span>
        <span className="flex-1 min-w-0 truncate font-medium">{label}</span>
        <ArrowUpRight size={13} className="text-neutral-300 group-hover:text-neutral-500 transition-colors rtl:-scale-x-100" />
      </a>
    </li>
  )
}
