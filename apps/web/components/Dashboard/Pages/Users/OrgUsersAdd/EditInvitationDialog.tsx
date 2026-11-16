'use client'
import React from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { PencilSimple } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { updateInvitation, type Invitation } from '@services/organizations/invitations'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import {
  CourseIcon,
  EXPIRY_CHOICES,
  GroupIcon,
  MultiPicker,
  RolePickerGrid,
  formatDate,
  invitationKeys,
  useCourseItems,
  useGroupItems,
  useInvitationAuth,
  useInvitationOptions,
} from './invitationsKit'

/** Change what a pending invitation grants before it is accepted. */
export default function EditInvitationDialog({
  invitation,
  onOpenChange,
}: {
  invitation: Invitation | null
  onOpenChange: (_open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { orgId, token } = useInvitationAuth()
  const queryClient = useQueryClient()
  const open = !!invitation
  const { data: options } = useInvitationOptions(open)
  const groupItems = useGroupItems(open)
  const courseItems = useCourseItems(open)
  const [roleId, setRoleId] = React.useState(4)
  const [groups, setGroups] = React.useState<string[]>([])
  const [courses, setCourses] = React.useState<string[]>([])
  const [message, setMessage] = React.useState('')
  const [extend, setExtend] = React.useState(0)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!invitation) return
    setRoleId(invitation.role?.id ?? 4)
    setGroups(invitation.usergroups.map((g) => String(g.id)))
    setCourses(invitation.courses.map((c) => c.course_uuid))
    setMessage(invitation.message ?? '')
    setExtend(0)
  }, [invitation])

  const save = async () => {
    if (!invitation) return
    setSaving(true)
    try {
      const res = await updateInvitation(
        orgId,
        invitation.invitation_uuid,
        {
          role_id: roleId,
          usergroup_ids: groups.map(Number),
          course_uuids: courses,
          message: message.trim(),
          ...(extend ? { expires_in_days: extend } : {}),
        },
        token
      )
      if (res.success) {
        toast.success(t('dashboard.users.invitations.toasts.updated'))
        queryClient.invalidateQueries({ queryKey: invitationKeys.all(orgId) })
        onOpenChange(false)
      } else {
        toast.error(getErrorMessage(res.data?.detail, t('dashboard.users.invitations.toasts.error')))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="lg"
      preventClose={saving}
      icon={<PencilSimple size={16} />}
      dialogTitle={t('dashboard.users.invitations.edit.title')}
      dialogDescription={invitation ? t('dashboard.users.invitations.edit.description', { email: invitation.email }) : undefined}
      dialogContent={
        <div className="flex flex-col gap-6">
          <section>
            <FieldLabel>{t('dashboard.users.invitations.fields.role')}</FieldLabel>
            {options && <RolePickerGrid roles={options.roles} value={roleId} onChange={setRoleId} />}
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
          <section className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-4">
            <div className="min-w-0">
              <FieldLabel hint={`${message.length}/1000`}>{t('dashboard.users.invitations.fields.message')}</FieldLabel>
              <textarea
                value={message}
                maxLength={1000}
                rows={3}
                onChange={(e) => setMessage(e.target.value)}
                aria-label={t('dashboard.users.invitations.fields.message')}
                placeholder={t('dashboard.users.invitations.fields.message_placeholder')}
                className={TEXTAREA}
              />
            </div>
            <div className="min-w-0">
              <FieldLabel>{t('dashboard.users.invitations.fields.expiry')}</FieldLabel>
              <select value={extend} onChange={(e) => setExtend(Number(e.target.value))} className={INPUT} aria-label={t('dashboard.users.invitations.fields.expiry')}>
                <option value={0}>
                  {t('dashboard.users.invitations.edit.keep_expiry', { date: formatDate(invitation?.expires_at, i18n.language) })}
                </option>
                {EXPIRY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {t('dashboard.users.invitations.edit.extend', { count: d })}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('dashboard.users.invitations.edit.save')}
          </Button>
        </>
      }
    />
  )
}
