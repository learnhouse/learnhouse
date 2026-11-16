'use client'
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { Eye, PencilSimple, Plug, PlugsConnected, TerminalWindow, UserGear, Warning } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Switch } from '@components/ui/switch'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  SectionCard,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { CodeBlock, CopyButton, MonoField, type CodeLang } from '@components/Dashboard/Pages/Org/Developers/devKit'
import {
  MCPConnection,
  MCP_SCOPE_ADMIN,
  MCP_SCOPE_WRITE,
  disconnectMCPConnection,
  getMCPSettings,
  listMCPConnections,
  updateMCPSettings,
} from '@services/mcp/mcp'

const CLIENTS: { id: string; name: string }[] = [
  { id: 'claude', name: 'Claude' },
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'vscode', name: 'VS Code' },
  { id: 'claude_code', name: 'Claude Code' },
]

// Copyable config for clients that read a file or take a command. Claude and
// ChatGPT are set up in their own settings UI, so they only get the steps.
function clientConfig(client: string, url: string): { file: string; code: string; lang: CodeLang } | null {
  const u = url || 'https://…/mcp'
  switch (client) {
    case 'cursor':
      return {
        file: '~/.cursor/mcp.json',
        lang: 'json',
        code: JSON.stringify({ mcpServers: { learnhouse: { url: u } } }, null, 2),
      }
    case 'vscode':
      return {
        file: '.vscode/mcp.json',
        lang: 'json',
        code: JSON.stringify({ servers: { learnhouse: { type: 'http', url: u } } }, null, 2),
      }
    case 'claude_code':
      return { file: 'terminal', lang: 'bash', code: `claude mcp add --transport http learnhouse ${u}` }
    default:
      return null
  }
}

// Placeholder handed to i18next for {{url}} so each step can show the URL as
// mono text instead of plain prose.
const URL_MARK = '⁣URL⁣'

function formatDate(seconds: number | null, locale: string): string {
  if (!seconds) return ''
  try {
    return new Date(seconds * 1000).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

// `org` is the admin view (switch + everyone's apps); `mine` is a member's
// own apps, shown in account settings.
const OrgEditMCP = ({ scope = 'org' }: { scope?: 'org' | 'mine' }) => {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const [client, setClient] = useState(CLIENTS[0].id)
  const [toggling, setToggling] = useState(false)
  const [disconnectTarget, setDisconnectTarget] = useState<MCPConnection | null>(null)

  const settingsKey = ['org', org?.id, 'mcp', 'settings']
  const connectionsKey = ['org', org?.id, 'mcp', 'connections', scope]

  const { data: settings } = useQuery({
    queryKey: settingsKey,
    queryFn: () => getMCPSettings(org.id, accessToken as string),
    enabled: !!(org?.id && accessToken),
  })
  const { data: connectionsData, isLoading } = useQuery<MCPConnection[]>({
    queryKey: connectionsKey,
    queryFn: () => listMCPConnections(org.id, scope, accessToken as string),
    enabled: !!(org?.id && accessToken),
  })
  const connections = Array.isArray(connectionsData) ? connectionsData : []

  const toggle = async (enabled: boolean) => {
    setToggling(true)
    try {
      await updateMCPSettings(org.id, enabled, accessToken as string)
      queryClient.invalidateQueries({ queryKey: settingsKey })
      toast.success(enabled ? t('dashboard.mcp.toasts.enabled') : t('dashboard.mcp.toasts.disabled'))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.mcp.toasts.error'))
    } finally {
      setToggling(false)
    }
  }

  const disconnect = async (connection: MCPConnection) => {
    try {
      await disconnectMCPConnection(org.id, connection.grant_uuid, accessToken as string)
      queryClient.invalidateQueries({ queryKey: connectionsKey })
      toast.success(t('dashboard.mcp.toasts.disconnected', { app: connection.client_name }))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.mcp.toasts.error'))
    }
  }

  const url = settings?.mcp_url ?? ''
  const steps = t(`dashboard.mcp.clients.${client}`, { returnObjects: true, url: URL_MARK }) as unknown
  const stepList = Array.isArray(steps) ? (steps as string[]) : []
  const config = clientConfig(client, url)

  const renderStep = (step: string) => {
    const parts = step.split(URL_MARK)
    return parts.map((part, i) => (
      <React.Fragment key={i}>
        {part}
        {i < parts.length - 1 && (
          <code dir="ltr" className="font-mono text-[12px] text-neutral-800 bg-neutral-100 rounded px-1 py-0.5 break-all">
            {url || '…'}
          </code>
        )}
      </React.Fragment>
    ))
  }

  return (
    <div className="flex flex-col gap-5">
      {settings && scope === 'mine' && settings.server_enabled && !settings.enabled && (
        <Notice>{t('dashboard.mcp.org_disabled')}</Notice>
      )}
      {settings && !settings.server_enabled && <Notice>{t('dashboard.mcp.server_disabled')}</Notice>}

      <div className={`grid grid-cols-1 gap-5 items-start ${scope === 'org' ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]' : ''}`}>
        {/* Server */}
        <SectionCard
          icon={<Plug size={18} />}
          title={t('dashboard.mcp.title')}
          description={scope === 'org' ? t('dashboard.mcp.description') : t('dashboard.mcp.description_member')}
        >
          <div className="flex flex-col gap-4">
            {settings && scope === 'org' && (
              <label className="flex items-center justify-between gap-4 rounded-xl ring-1 ring-inset ring-neutral-200/80 px-3.5 py-3 cursor-pointer">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{t('dashboard.mcp.toggle')}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
                    <span className={`w-1.5 h-1.5 rounded-full ${settings.enabled ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
                    {settings.enabled ? t('dashboard.mcp.on') : t('dashboard.mcp.off')}
                  </span>
                </span>
                <Switch
                  checked={settings.enabled}
                  disabled={!settings.server_enabled || toggling}
                  onCheckedChange={toggle}
                  aria-label={t('dashboard.mcp.toggle')}
                />
              </label>
            )}
            <MonoField label={t('dashboard.mcp.server_url')} value={url} />
            <div className="rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3.5 py-3 flex flex-col gap-2 text-xs text-neutral-500 leading-relaxed">
              <p>{scope === 'org' ? t('dashboard.mcp.plans_note') : t('dashboard.mcp.plans_note_member')}</p>
              <p>{t('dashboard.mcp.toolsets_hint')}</p>
              {url && (
                <div className="flex items-center gap-2 pt-1">
                  <code dir="ltr" className="flex-1 min-w-0 truncate font-mono text-[11.5px] text-neutral-700">
                    {url}?toolsets=essentials
                  </code>
                  <CopyButton value={`${url}?toolsets=essentials`} label={false} variant="ghost" />
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Per-client instructions */}
        <SectionCard
          icon={<TerminalWindow size={18} />}
          title={t('dashboard.mcp.how_to')}
          description={t('dashboard.developers.mcp.how_to_description')}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1 rounded-lg bg-neutral-200/60 p-1 w-fit max-w-full" role="tablist">
              {CLIENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  onClick={() => setClient(c.id)}
                  aria-selected={client === c.id}
                  className={`h-7 px-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    client === c.id
                      ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]'
                      : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <ol className="flex flex-col gap-3">
              {stepList.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-px w-5 h-5 rounded-full bg-neutral-900 text-white text-[10.5px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-sm text-neutral-700 leading-relaxed min-w-0">{renderStep(step)}</span>
                </li>
              ))}
            </ol>
            {config && (
              <CodeBlock
                key={client}
                title={config.file}
                tabs={[{ key: client, label: config.file, code: config.code, lang: config.lang }]}
              />
            )}
          </div>
        </SectionCard>
      </div>

      {/* Connected apps */}
      <SectionCard
        icon={<PlugsConnected size={18} />}
        title={t('dashboard.mcp.connections_title')}
        description={
          scope === 'org' ? t('dashboard.mcp.connections_description') : t('dashboard.mcp.connections_description_member')
        }
        actions={
          connections.length > 0 ? (
            <span className="text-xs font-semibold text-neutral-400 tabular-nums">{connections.length}</span>
          ) : undefined
        }
        bodyClassName="pt-3 pb-1"
      >
        {isLoading ? (
          <div className="animate-pulse divide-y divide-neutral-100">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="w-9 h-9 rounded-xl bg-neutral-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-neutral-100 rounded w-32" />
                  <div className="h-3 bg-neutral-100 rounded w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : connections.length === 0 ? (
          <EmptyState
            icon={<PlugsConnected size={22} />}
            title={t('dashboard.mcp.no_connections')}
            description={t('dashboard.developers.mcp.empty_hint')}
          />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {connections.map((c) => {
              const name = [c.user?.first_name, c.user?.last_name].filter(Boolean).join(' ') || c.user?.username
              const scopes = Array.isArray(c.scopes) ? c.scopes : []
              const canWrite = scopes.includes(MCP_SCOPE_WRITE)
              const canAdmin = scopes.includes(MCP_SCOPE_ADMIN)
              return (
                <li key={c.grant_uuid} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-b from-neutral-800 to-neutral-900 text-white flex items-center justify-center text-sm font-semibold shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                    {(c.client_name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-neutral-900 truncate">{c.client_name}</div>
                    <div className="text-xs text-neutral-500 truncate">
                      {scope === 'org' ? `${t('dashboard.mcp.connected_by', { name })} · ` : ''}
                      {t('dashboard.mcp.connected_on', { date: formatDate(c.created_at, i18n.language) })}
                      {c.last_used_at
                        ? ` · ${t('dashboard.mcp.last_used', { date: formatDate(c.last_used_at, i18n.language) })}`
                        : ''}
                    </div>
                  </div>
                  <Chip
                    tone={canAdmin ? 'violet' : canWrite ? 'amber' : 'sky'}
                    icon={canAdmin ? <UserGear size={12} /> : canWrite ? <PencilSimple size={12} /> : <Eye size={12} />}
                    className="max-sm:hidden"
                  >
                    {canAdmin
                      ? t('dashboard.mcp.access_admin')
                      : canWrite
                        ? t('dashboard.mcp.access_write')
                        : t('dashboard.mcp.access_read')}
                  </Chip>
                  <Button variant="danger-ghost" size="sm" onClick={() => setDisconnectTarget(c)} aria-label={t('dashboard.mcp.disconnect')}>
                    <span className="hidden sm:inline">{t('dashboard.mcp.disconnect')}</span>
                    <span className="sm:hidden">×</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      <ConfirmDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title={t('dashboard.developers.mcp.disconnect_title', { app: disconnectTarget?.client_name ?? '' })}
        message={t('dashboard.developers.mcp.disconnect_message')}
        confirmLabel={t('dashboard.mcp.disconnect')}
        onConfirm={() => (disconnectTarget ? disconnect(disconnectTarget) : undefined)}
      />
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 ring-1 ring-inset ring-amber-600/15 px-3.5 py-2.5 text-sm text-amber-900">
      <Warning size={16} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
      {children}
    </div>
  )
}

export default OrgEditMCP
