'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Info, Ticket } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, FieldLabel, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
import { createInviteCodeV2 } from '@services/organizations/invitations'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { queryKeys } from '@/lib/query/keys'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import {
  CourseIcon,
  GroupIcon,
  MultiPicker,
  RolePickerGrid,
  useCourseItems,
  useGroupItems,
  useInvitationAuth,
  useInvitationOptions,
} from '@components/Dashboard/Pages/Users/OrgUsersAdd/invitationsKit'

const CODE_EXPIRY = [0, 7, 30, 90, 365]

// Creates a shareable invite code: a learner-level role (never one that can
// manage people or open the dashboard), optional groups and courses, an
// optional use cap and expiry.
function OrgInviteCodeGenerate({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const { orgId, token } = useInvitationAuth()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const { data: options } = useInvitationOptions(open)
  const groupItems = useGroupItems(open)
  const courseItems = useCourseItems(open)
  const [roleId, setRoleId] = React.useState(4)
  const [groups, setGroups] = React.useState<string[]>([])
  const [courses, setCourses] = React.useState<string[]>([])
  const [maxUses, setMaxUses] = React.useState('')
  const [expiry, setExpiry] = React.useState(0)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setRoleId(4)
    setGroups([])
    setCourses([])
    setMaxUses('')
    setExpiry(0)
  }, [open])

  const uses = maxUses.trim() ? Number(maxUses) : null
  const usesInvalid = uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > 100000)

  async function handleGenerate() {
    if (usesInvalid) return
    setPending(true)
    try {
      const res = await createInviteCodeV2(
        orgId,
        { role_id: roleId, usergroup_ids: groups.map(Number), course_uuids: courses, max_uses: uses, expires_in_days: expiry || null },
        token
      )
      if (res.success) {
        track(AnalyticsEvent.InviteCodeCreated, { mode: groups.length ? 'usergroup' : 'normal', usergroup_id: groups[0] ? Number(groups[0]) : undefined })
        queryClient.invalidateQueries({ queryKey: queryKeys.org.inviteCodes(orgId) })
        onOpenChange(false)
      } else {
        toast.error(getErrorMessage(res.data?.detail, t('dashboard.users.invitations.toasts.error')))
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
      size="lg"
      icon={<Ticket size={16} />}
      dialogTitle={t('dashboard.users.signups.invite_codes.actions.generate_title')}
      dialogDescription={t('dashboard.users.invitations.codes.description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={<Ticket size={14} />} onClick={handleGenerate} loading={pending} disabled={usesInvalid}>
            {t('dashboard.users.signups.generate_modal.generate_button')}
          </Button>
        </>
      }
      dialogContent={
        <div className="flex flex-col gap-6">
          <section>
            <FieldLabel hint={t('dashboard.users.invitations.codes.role_hint')}>{t('dashboard.users.invitations.fields.role')}</FieldLabel>
            {options && <RolePickerGrid roles={options.roles} value={roleId} onChange={setRoleId} codesOnly />}
            <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-500">
              <Info size={13} className="shrink-0 mt-0.5 text-neutral-400" />
              {t('dashboard.users.invitations.codes.role_note')}
            </p>
          </section>
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <FieldLabel hint={t('common.optional')}>{t('dashboard.users.invitations.fields.groups')}</FieldLabel>
              <MultiPicker
                items={groupItems}
                value={groups}
                onChange={setGroups}
                icon={<GroupIcon />}
                label={t('dashboard.users.invitations.fields.groups')}
                placeholder={t('dashboard.users.invitations.fields.groups_placeholder')}
                emptyText={t('dashboard.users.invitations.fields.no_groups')}
              />
            </div>
            <div className="min-w-0">
              <FieldLabel hint={t('common.optional')}>{t('dashboard.users.invitations.fields.courses')}</FieldLabel>
              <MultiPicker
                items={courseItems}
                value={courses}
                onChange={setCourses}
                icon={<CourseIcon />}
                label={t('dashboard.users.invitations.fields.courses')}
                placeholder={t('dashboard.users.invitations.fields.courses_placeholder')}
                emptyText={t('dashboard.users.invitations.fields.no_courses')}
              />
            </div>
          </section>
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block min-w-0">
              <FieldLabel error={usesInvalid ? t('dashboard.users.invitations.codes.max_uses_invalid') : undefined} hint={t('common.optional')}>
                {t('dashboard.users.invitations.codes.max_uses')}
              </FieldLabel>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder={t('dashboard.users.invitations.codes.unlimited')}
                className={INPUT}
              />
            </label>
            <label className="block min-w-0">
              <FieldLabel>{t('dashboard.users.invitations.fields.expiry')}</FieldLabel>
              <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} className={INPUT}>
                {CODE_EXPIRY.map((d) => (
                  <option key={d} value={d}>
                    {d ? t('dashboard.users.invitations.fields.days', { count: d }) : t('dashboard.users.invitations.codes.never')}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>
      }
    />
  )
}

export default OrgInviteCodeGenerate
