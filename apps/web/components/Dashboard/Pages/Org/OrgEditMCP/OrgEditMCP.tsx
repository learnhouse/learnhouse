'use client'
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { Check, Copy, Eye, PencilLine, Plug, Trash2, UserCog } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Switch } from '@components/ui/switch'
import { Button } from '@components/ui/button'
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
  const [copied, setCopied] = useState(false)
  const [client, setClient] = useState(CLIENTS[0].id)

  const settingsKey = ['org', org?.id, 'mcp', 'settings']
  const connectionsKey = ['org', org?.id, 'mcp', 'connections', scope]

  const { data: settings } = useQuery({
    queryKey: settingsKey,
    queryFn: () => getMCPSettings(org.id, accessToken as string),
    enabled: !!(org?.id && accessToken),
  })
  const { data: connections, isLoading } = useQuery<MCPConnection[]>({
    queryKey: connectionsKey,
    queryFn: () => listMCPConnections(org.id, scope, accessToken as string),
    enabled: !!(org?.id && accessToken),
  })

  const toggle = async (enabled: boolean) => {
    try {
      await updateMCPSettings(org.id, enabled, accessToken as string)
      queryClient.invalidateQueries({ queryKey: settingsKey })
      toast.success(enabled ? t('dashboard.mcp.toasts.enabled') : t('dashboard.mcp.toasts.disabled'))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.mcp.toasts.error'))
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('dashboard.mcp.toasts.copy_failed'))
    }
  }

  const steps = t(`dashboard.mcp.clients.${client}`, { returnObjects: true, url }) as unknown
  const stepList = Array.isArray(steps) ? (steps as string[]) : []

  return (
    <div className="sm:mx-10 mx-0 flex flex-col gap-6 pb-10">
      <div className="bg-white rounded-xl nice-shadow p-5 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-bold text-xl text-gray-800 flex items-center gap-2">
              <Plug size={18} />
              {t('dashboard.mcp.title')}
            </h2>
            <p className="text-sm text-gray-500 max-w-2xl">
              {scope === 'org' ? t('dashboard.mcp.description') : t('dashboard.mcp.description_member')}
            </p>
          </div>
          {settings && scope === 'org' && (
            <label className="flex items-center gap-2 text-sm text-gray-700 flex-none">
              <Switch
                checked={settings.enabled}
                disabled={!settings.server_enabled}
                onCheckedChange={toggle}
                aria-label={t('dashboard.mcp.toggle')}
              />
              {settings.enabled ? t('dashboard.mcp.on') : t('dashboard.mcp.off')}
            </label>
          )}
        </div>

        {settings && scope === 'mine' && settings.server_enabled && !settings.enabled && (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 px-3 py-2">
            {t('dashboard.mcp.org_disabled')}
          </p>
        )}

        {settings && !settings.server_enabled && (
          <p className="text-sm rounded-md bg-amber-50 text-amber-800 px-3 py-2">
            {t('dashboard.mcp.server_disabled')}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-gray-800">{t('dashboard.mcp.server_url')}</span>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="flex-1 min-w-0 truncate rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-800"
            >
              {url || '...'}
            </code>
            <Button variant="outline" size="sm" onClick={copy} disabled={!url}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span className="ms-1.5">{copied ? t('dashboard.mcp.copied') : t('dashboard.mcp.copy')}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-gray-800">{t('dashboard.mcp.how_to')}</span>
          <div className="flex flex-wrap gap-1.5">
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setClient(c.id)}
                aria-pressed={client === c.id}
                className={
                  client === c.id
                    ? 'rounded-full bg-gray-900 text-white px-3 py-1 text-xs font-medium'
                    : 'rounded-full bg-gray-100 text-gray-600 px-3 py-1 text-xs font-medium hover:bg-gray-200'
                }
              >
                {c.name}
              </button>
            ))}
          </div>
          <ol className="list-decimal ps-5 flex flex-col gap-1 text-sm text-gray-600">
            {stepList.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="text-xs text-gray-500">
            {scope === 'org' ? t('dashboard.mcp.plans_note') : t('dashboard.mcp.plans_note_member')}
          </p>
          <p className="text-xs text-gray-500">{t('dashboard.mcp.toolsets_hint')}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl nice-shadow p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-800">{t('dashboard.mcp.connections_title')}</h3>
          <p className="text-sm text-gray-500">
            {scope === 'org'
              ? t('dashboard.mcp.connections_description')
              : t('dashboard.mcp.connections_description_member')}
          </p>
        </div>
        {isLoading && <div className="h-10 rounded bg-gray-50 animate-pulse" />}
        {!isLoading && (connections?.length ?? 0) === 0 && (
          <p className="text-sm text-gray-400">{t('dashboard.mcp.no_connections')}</p>
        )}
        <ul className="flex flex-col divide-y divide-gray-100">
          {(connections ?? []).map((c) => {
            const name =
              [c.user.first_name, c.user.last_name].filter(Boolean).join(' ') || c.user.username
            const canWrite = c.scopes.includes(MCP_SCOPE_WRITE)
            const canAdmin = c.scopes.includes(MCP_SCOPE_ADMIN)
            return (
              <li key={c.grant_uuid} className="flex items-center gap-3 py-3">
                <div className="w-9 h-9 rounded-lg bg-gray-900 text-white flex items-center justify-center text-sm font-semibold flex-none">
                  {(c.client_name || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{c.client_name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {scope === 'org' ? `${t('dashboard.mcp.connected_by', { name })} · ` : ''}
                    {t('dashboard.mcp.connected_on', { date: formatDate(c.created_at, i18n.language) })}
                    {c.last_used_at
                      ? ` · ${t('dashboard.mcp.last_used', { date: formatDate(c.last_used_at, i18n.language) })}`
                      : ''}
                  </div>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {canAdmin ? <UserCog size={12} /> : canWrite ? <PencilLine size={12} /> : <Eye size={12} />}
                  {canAdmin
                    ? t('dashboard.mcp.access_admin')
                    : canWrite
                      ? t('dashboard.mcp.access_write')
                      : t('dashboard.mcp.access_read')}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnect(c)}
                  aria-label={t('dashboard.mcp.disconnect')}
                >
                  <Trash2 size={14} />
                  <span className="ms-1.5 hidden sm:inline">{t('dashboard.mcp.disconnect')}</span>
                </Button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default OrgEditMCP
