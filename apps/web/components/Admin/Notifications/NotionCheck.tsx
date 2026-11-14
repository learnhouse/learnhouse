'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckCircle, Database, MagicWand, WarningCircle, XCircle } from '@phosphor-icons/react'
import { Button } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { opsKeys, setupNotion, testChannel, type ChannelTestResult } from '@services/ee/platform/ops'
import { useAccessToken } from '@components/Admin/hooks'

// "Check database" for a Notion channel: which database the token reaches,
// which properties are missing or have the wrong type, and a one-click
// "Create missing properties" (the API renames the title property to Name).

export function TestResultLine({ result }: { result: ChannelTestResult }) {
  const { t } = useTranslation()
  return (
    <p className={`flex items-start gap-1.5 text-xs ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
      {result.ok ? <CheckCircle size={14} weight="fill" className="mt-px shrink-0" /> : <XCircle size={14} weight="fill" className="mt-px shrink-0" />}
      <span className="min-w-0 break-words">{result.detail || (result.ok ? t('admin.notifications.channels.test_ok') : t('admin.notifications.channels.test_failed'))}</span>
    </p>
  )
}

export default function NotionCheck({ channelUuid, autoRun = false, initial }: { channelUuid: string; autoRun?: boolean; initial?: ChannelTestResult | null }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const [result, setResult] = React.useState<ChannelTestResult | null>(initial ?? null)
  const [checking, setChecking] = React.useState(false)
  const [fixing, setFixing] = React.useState(false)

  const check = React.useCallback(async () => {
    setChecking(true)
    try {
      setResult(await testChannel(token, channelUuid))
    } catch (err) {
      setResult({ ok: false, detail: errorMessage(err, t('admin.notifications.channels.test_failed')) })
    } finally {
      setChecking(false)
      queryClient.invalidateQueries({ queryKey: opsKeys.channels() })
    }
  }, [token, channelUuid, t, queryClient])

  const ran = React.useRef(false)
  React.useEffect(() => {
    if (autoRun && token && !ran.current) {
      ran.current = true
      check()
    }
  }, [autoRun, token, check])

  const fix = async () => {
    setFixing(true)
    try {
      const res = await setupNotion(token, channelUuid)
      const created = Array.isArray(res?.created) ? res.created : []
      toast.success(created.length ? t('admin.notifications.channels.props_created', { list: created.join(', ') }) : res?.detail || t('admin.notifications.channels.props_ok'))
      await check()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setFixing(false)
    }
  }

  const missing = Array.isArray(result?.missing) ? result!.missing : []
  const wrong = Array.isArray(result?.wrong_type) ? result!.wrong_type : []
  const fixable = missing.length > 0 || wrong.length > 0

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Database size={13} />} onClick={check} loading={checking}>
          {t('admin.notifications.channels.check_database')}
        </Button>
        {fixable && (
          <Button size="sm" variant="primary" icon={<MagicWand size={13} />} onClick={fix} loading={fixing}>
            {t('admin.notifications.channels.create_props')}
          </Button>
        )}
      </div>
      {result && (
        <div className="space-y-1.5">
          {result.database_title && (
            <p className="text-xs text-neutral-600">
              {t('admin.notifications.channels.database')}: <span className="font-semibold text-neutral-900">{result.database_title}</span>
            </p>
          )}
          <TestResultLine result={result} />
          {missing.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700">
              <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
              <span>{t('admin.notifications.channels.missing_props', { list: missing.join(', ') })}</span>
            </p>
          )}
          {wrong.map((w) => (
            <p key={w.name} className="flex items-start gap-1.5 text-xs text-amber-700">
              <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
              <span>{t('admin.notifications.channels.wrong_type', { name: w.name, expected: w.expected, found: w.found })}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
