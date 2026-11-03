'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { MCPApproval, decideApproval, getApproval } from '@services/mcp/mcp'
import lrnLogo from 'public/lrn.svg'

// An AI app connected over MCP asked to do something that needs the member's
// own yes (deleting, publishing, changing access...). The member reviews it
// here, signed in as themselves; the app can then run that exact call once.
export default function ApproveClient() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const searchParams = useSearchParams()
  const id = searchParams.get('id') || ''

  const [approval, setApproval] = useState<MCPApproval | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [done, setDone] = useState<'approved' | 'declined' | null>(null)
  const loadedRef = useRef(false)

  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const status: string | undefined = session?.status

  useEffect(() => {
    if (status !== 'unauthenticated') return
    const back = `${window.location.pathname}${window.location.search}`
    window.location.replace(`/login?next=${encodeURIComponent(back)}`)
  }, [status])

  useEffect(() => {
    if (!accessToken || !id || loadedRef.current) return
    loadedRef.current = true
    getApproval(id, accessToken)
      .then(setApproval)
      .catch((e: Error) => setError(e.message))
  }, [accessToken, id])

  const answer = async (approve: boolean) => {
    if (!accessToken || busy) return
    setBusy(approve ? 'approve' : 'decline')
    setError('')
    try {
      const result = await decideApproval(id, approve, accessToken)
      setDone(result === 'approved' ? 'approved' : 'declined')
    } catch (e: any) {
      setError(e?.message || t('oauth_approve.errors.generic'))
    } finally {
      setBusy(null)
    }
  }

  if (!id || (error && !approval)) {
    return (
      <Shell>
        <Notice
          icon={<AlertTriangle className="w-7 h-7 text-red-600" />}
          tone="bg-red-50"
          title={t('oauth_approve.errors.title')}
          body={id ? error : t('oauth_approve.errors.missing')}
        />
      </Shell>
    )
  }

  if (!approval) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </Shell>
    )
  }

  if (done || approval.status !== 'pending') {
    const state = done || approval.status
    const approved = state === 'approved' || state === 'used'
    return (
      <Shell>
        <Notice
          icon={
            approved ? (
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            ) : (
              <XCircle className="w-7 h-7 text-gray-500" />
            )
          }
          tone={approved ? 'bg-green-50' : 'bg-gray-100'}
          title={approved ? t('oauth_approve.approved_title') : t('oauth_approve.declined_title')}
          body={
            approved
              ? t('oauth_approve.approved_body', { client: approval.client_name })
              : t('oauth_approve.declined_body', { client: approval.client_name })
          }
        />
      </Shell>
    )
  }

  const target = approval.target || {}
  return (
    <Shell>
      <div className="flex flex-col items-center text-center gap-2 pb-5 border-b border-gray-100">
        <div className="p-3 bg-amber-50 rounded-full">
          <ShieldAlert className="w-7 h-7 text-amber-600" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          {t('oauth_approve.title', { client: approval.client_name || t('oauth_approve.an_app') })}
        </h1>
        <p className="text-sm text-gray-500">
          {t('oauth_approve.in_org', { org: approval.org.name })}
        </p>
      </div>

      <section className="pt-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{t('oauth_approve.action')}</h2>
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900">
          {approval.summary}
        </p>
        {target.name && (
          <p className="mt-2 text-xs text-gray-500">
            {t('oauth_approve.target', { kind: target.kind || '', name: target.name })}
          </p>
        )}
        <p className="mt-3 text-xs text-gray-500">{t('oauth_approve.why')}</p>
      </section>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2 pt-6">
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={busy !== null}
          className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {busy === 'decline' ? <Loader2 className="w-4 h-4 mx-auto animate-spin" /> : t('oauth_approve.decline')}
        </button>
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={busy !== null}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40"
        >
          {busy === 'approve' ? <Loader2 className="w-4 h-4 mx-auto animate-spin" /> : t('oauth_approve.approve')}
        </button>
      </div>
      <p className="pt-4 text-center text-xs text-gray-400">{t('oauth_approve.expires')}</p>
    </Shell>
  )
}

function Notice({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ReactNode
  tone: string
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-6">
      <div className={`p-3 rounded-full ${tone}`}>{icon}</div>
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-600">{body}</p>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f8f8] flex flex-col items-center justify-center px-4 py-10">
      <Image src={lrnLogo} alt="LearnHouse" width={36} height={36} className="mb-6 opacity-90" />
      <div className="w-full max-w-md rounded-2xl bg-white nice-shadow p-6">{children}</div>
    </div>
  )
}
