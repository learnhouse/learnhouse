'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Eye, Key, PencilSimple, Prohibit, Robot, Terminal } from '@phosphor-icons/react'
import { Button, SectionCard, StatusPill } from '@/design'
import { getAPIUrl } from '@services/config/config'
import { getSystem } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'

// Setup help for the platform MCP (`/mcp/platform`). It authenticates with a
// superadmin token that carries the `mcp` scope; nothing here mints tokens.

export function mcpUrlFromApi(path = '/mcp/platform'): string {
  const api = getAPIUrl()
  const base = api.replace(/\/api\/v1\/?$/, '')
  if (/^https?:\/\//.test(base)) return `${base}${path}`
  // Relative API (custom domain proxy): the MCP lives on this origin.
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${base}${path}`
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="rounded-xl bg-[#1d1d21] ring-1 ring-inset ring-[rgb(255_255_255/0.06)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-[rgb(255_255_255/0.1)]">
        <span className="text-[11px] font-semibold text-[rgb(255_255_255/0.5)]">{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code)
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            } catch {
              // clipboard blocked
            }
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[rgb(255_255_255/0.6)] hover:text-[rgb(255_255_255/1)] hover:bg-[rgb(255_255_255/0.1)]"
        >
          {copied ? <Check size={12} weight="bold" className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? t('admin.developers.snippets.copied') : t('admin.developers.snippets.copy')}
        </button>
      </div>
      <pre dir="ltr" className="px-3 py-3 text-xs leading-relaxed text-[rgb(255_255_255/0.85)] font-mono whitespace-pre overflow-x-auto [font-variant-ligatures:none]">
        {code}
      </pre>
    </div>
  )
}

export default function McpTab({ onGoToTokens }: { onGoToTokens: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const system = useQuery({ queryKey: platformKeys.system(), queryFn: () => getSystem(token), enabled: !!token, retry: shouldRetry })
  const [fallbackUrl, setFallbackUrl] = React.useState('')
  const mcpPath = system.data?.mcp?.path || '/mcp/platform'
  React.useEffect(() => setFallbackUrl(mcpUrlFromApi(mcpPath)), [mcpPath])
  const url = system.data?.mcp?.url || fallbackUrl
  const enabled = system.data?.mcp?.enabled

  const claude = `claude mcp add --transport http learnhouse-platform \\\n  ${url} \\\n  --header "Authorization: Bearer lh_sa_…"`
  const json = JSON.stringify(
    {
      mcpServers: {
        'learnhouse-platform': {
          type: 'http',
          url,
          headers: { Authorization: 'Bearer lh_sa_…' },
        },
      },
    },
    null,
    2
  )

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        icon={<Robot size={18} />}
        title={t('admin.mcp.title')}
        description={t('admin.mcp.desc')}
        actions={
          enabled === undefined ? undefined : (
            <StatusPill status={enabled ? 'success' : 'neutral'} dot>
              {enabled ? t('admin.mcp.enabled') : t('admin.mcp.disabled')}
            </StatusPill>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
            {[
              { icon: <Key size={16} />, hue: 'bg-amber-50 text-amber-600', title: t('admin.mcp.step1_title'), body: t('admin.mcp.step1_body') },
              { icon: <Terminal size={16} />, hue: 'bg-sky-50 text-sky-600', title: t('admin.mcp.step2_title'), body: t('admin.mcp.step2_body') },
              { icon: <Robot size={16} />, hue: 'bg-emerald-50 text-emerald-600', title: t('admin.mcp.step3_title'), body: t('admin.mcp.step3_body') },
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${s.hue}`}>{s.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">
                    {i + 1}. {s.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <div>
            <p className="text-xs font-semibold text-neutral-500 mb-1.5">{t('admin.mcp.endpoint')}</p>
            <code dir="ltr" className="block rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3 py-2 font-mono text-xs text-neutral-900 break-all">
              {url || '…'}
            </code>
          </div>
          <CodeBlock label={t('admin.mcp.claude_code')} code={claude} />
          <CodeBlock label={t('admin.mcp.json_config')} code={json} />
          <div>
            <Button size="sm" icon={<Key size={13} />} onClick={onGoToTokens}>
              {t('admin.mcp.create_token')}
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={<Eye size={18} />} title={t('admin.mcp.safety_title')} description={t('admin.mcp.safety_desc')}>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <li>
            <p className="flex items-center gap-2 font-semibold text-neutral-900">
              <Eye size={15} className="text-emerald-600" />
              {t('admin.mcp.reads')}
            </p>
            <p className="mt-1 text-xs text-neutral-500">{t('admin.mcp.reads_desc')}</p>
          </li>
          <li>
            <p className="flex items-center gap-2 font-semibold text-neutral-900">
              <PencilSimple size={15} className="text-amber-600" />
              {t('admin.mcp.writes')}
            </p>
            <p className="mt-1 text-xs text-neutral-500">{t('admin.mcp.writes_desc')}</p>
          </li>
          <li>
            <p className="flex items-center gap-2 font-semibold text-neutral-900">
              <Prohibit size={15} className="text-rose-600" />
              {t('admin.mcp.never')}
            </p>
            <p className="mt-1 text-xs text-neutral-500">{t('admin.mcp.never_desc')}</p>
          </li>
        </ul>
      </SectionCard>
    </div>
  )
}
