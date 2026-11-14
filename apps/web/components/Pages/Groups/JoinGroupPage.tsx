'use client'
import React, { use, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Ticket } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Button, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { useUG } from '@components/Dashboard/Pages/Users/OrgUserGroups/groupsApi'

/** A learner joins a group with the code their teacher shared. */
export default function JoinGroupPage(props: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = use(props.params)
  const { t } = useTranslation()
  const params = useSearchParams()
  const { call, token } = useUG()
  const qc = useQueryClient()
  const [code, setCode] = useState(params?.get('code') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState<any | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const out = await call<any>('POST', 'join', { code: code.trim() })
      setJoined(out)
      qc.invalidateQueries({ queryKey: ['usergroups'] })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <GeneralWrapperStyled>
      <div className="flex justify-center py-10 sm:py-16">
        <div className="w-full max-w-md bg-white rounded-2xl nice-shadow p-6 sm:p-8">
          {joined ? (
            <div className="flex flex-col items-center text-center gap-3" data-testid="join-success">
              <span className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle size={30} weight="fill" />
              </span>
              <h1 className="text-xl font-bold text-gray-900">
                {joined.status === 'already_member' ? t('groups.join.already', { name: joined.name }) : t('groups.join.joined', { name: joined.name })}
              </h1>
              <p className="text-sm text-gray-500">{t('groups.join.joined_desc')}</p>
              <Link href={getUriWithOrg(orgslug, `/groups/${String(joined.usergroup_uuid).replace('usergroup_', '')}`)} className="mt-2">
                <Button variant="primary">{t('groups.join.open_group')}</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <span className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Ticket size={24} weight="duotone" />
              </span>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t('groups.join.title')}</h1>
                <p className="mt-1 text-sm text-gray-500">{t('groups.join.desc')}</p>
              </div>
              <input
                className={`${INPUT} h-11 text-center font-mono text-lg tracking-[0.2em] uppercase`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="K7Q2-M9XP"
                aria-label={t('groups.join.code')}
                autoComplete="off"
                maxLength={20}
                data-testid="join-code-input"
              />
              {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
              {!token ? (
                <Link href={getUriWithOrg(orgslug, `/login?redirect=${encodeURIComponent(`/groups/join?code=${code}`)}`)}>
                  <Button variant="primary" className="w-full">{t('groups.join.sign_in')}</Button>
                </Link>
              ) : (
                <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.trim().length < 4} className="w-full" data-testid="join-submit">
                  {t('groups.join.submit')}
                </Button>
              )}
            </form>
          )}
        </div>
      </div>
    </GeneralWrapperStyled>
  )
}
