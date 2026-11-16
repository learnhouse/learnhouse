'use client'
import React from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowSquareOut, Ticket, Users, UsersThree } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, ChoiceCard, FieldLabel, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { createInviteCode } from '@services/organizations/invites'
import { getUserGroups } from '@services/usergroups/usergroups'
import { asArray } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

// Dialog that creates an invite code, optionally tied to a user group so new
// members land in it on signup.
function OrgInviteCodeGenerate({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const [mode, setMode] = React.useState<'normal' | 'usergroup'>('normal')
  const [usergroupId, setUsergroupId] = React.useState(0)
  const [pending, setPending] = React.useState(false)

  const { data: usergroups = [] } = useQuery({
    queryKey: queryKeys.usergroups.list(org?.id),
    queryFn: () => getUserGroups(org.id, access_token),
    select: (res: any) => asArray<any>(res),
    enabled: !!(org?.id && access_token && open),
    staleTime: 60_000,
  })
  const hasGroups = usergroups.length > 0

  // Default to the first group once they load, and reset when reopened.
  React.useEffect(() => {
    if (!open) return
    setMode('normal')
    setUsergroupId(usergroups[0]?.id ?? 0)
  }, [open, usergroups])

  async function handleGenerate() {
    const ugId = mode === 'usergroup' && usergroupId ? usergroupId : undefined
    setPending(true)
    try {
      const res = await createInviteCode(org.id, access_token, ugId)
      if (res.status == 200) {
        track(AnalyticsEvent.InviteCodeCreated, { mode, usergroup_id: ugId })
        queryClient.invalidateQueries({ queryKey: queryKeys.org.inviteCodes(org.id) })
        onOpenChange(false)
      } else {
        toast.error(t('dashboard.users.signups.generate_modal.toasts.error', { status: res.status, detail: res.data?.detail }))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      preventClose={pending}
      size="md"
      icon={<Ticket size={16} />}
      dialogTitle={t('dashboard.users.signups.invite_codes.actions.generate_title')}
      dialogDescription={t('dashboard.users.signups.invite_codes.actions.generate_description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={<Ticket size={14} />} onClick={handleGenerate} loading={pending}>
            {t('dashboard.users.signups.generate_modal.generate_button')}
          </Button>
        </>
      }
      dialogContent={
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup">
            <ChoiceCard
              selected={mode === 'normal'}
              onClick={() => setMode('normal')}
              icon={<Users size={18} />}
              title={t('dashboard.users.signups.generate_modal.normal_title')}
              description={t('dashboard.users.signups.generate_modal.normal_description')}
            />
            <ChoiceCard
              selected={mode === 'usergroup'}
              onClick={() => hasGroups && setMode('usergroup')}
              icon={<UsersThree size={18} />}
              title={t('dashboard.users.signups.generate_modal.linked_title')}
              description={t('dashboard.users.signups.generate_modal.linked_description')}
            />
          </div>

          {mode === 'usergroup' && hasGroups && (
            <label className="block">
              <FieldLabel hint={t('dashboard.users.dash.signups.usergroup_hint')}>{t('access.select_user_group')}</FieldLabel>
              <select value={usergroupId} onChange={(e) => setUsergroupId(Number(e.target.value))} className={INPUT}>
                {usergroups.map((ug: any) => (
                  <option key={ug.id} value={ug.id}>
                    {ug.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!hasGroups && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 px-3.5 py-2.5 text-xs text-neutral-600">
              <span>{t('dashboard.users.signups.generate_modal.no_usergroups')}</span>
              <Link
                target="_blank"
                href={getUriWithOrg(org?.slug, '/dash/users/settings/usergroups')}
                className="inline-flex items-center gap-1 font-semibold text-neutral-800 hover:text-neutral-950"
              >
                {t('dashboard.users.signups.generate_modal.create_usergroup_link')}
                <ArrowSquareOut size={12} />
              </Link>
            </div>
          )}

          <p className="text-xs text-neutral-400">{t('dashboard.users.dash.signups.expiry_hint')}</p>
        </div>
      }
    />
  )
}

export default OrgInviteCodeGenerate
