'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { toast } from 'react-hot-toast'
import { Warning, Trash, UserMinus, Eraser, LockSimple } from '@phosphor-icons/react'
import { Trans, useTranslation } from 'react-i18next'
import {
  deleteOrganization,
  removeAllUsersFromOrg,
  wipeOrgContent,
} from '@services/organizations/orgs'
import { Button, ConfirmDialog, EmptyState, SectionCard, SettingRow } from '@components/Dashboard/Shared/DashKit/DashKit'
import { TypeToConfirmDialog } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'

type Dialog = 'members' | 'wipe' | 'delete' | null

const OrgEditDangerZone: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { canManageOrg } = useAdminStatus()

  const [dialog, setDialog] = React.useState<Dialog>(null)
  const [isRemovingUsers, setIsRemovingUsers] = React.useState(false)
  const [isWipingContent, setIsWipingContent] = React.useState(false)
  const [isDeletingOrg, setIsDeletingOrg] = React.useState(false)

  // Mirror the backend: delete/wipe/remove-all are authorized on admin/maintainer
  // role membership (rbac "delete"/"update" → authorization_verify_based_on_org_
  // admin_status), which canManageOrg (organizations.action_update, superadmin
  // bypass) reflects. The broad `isAdmin` (dashboard access) also lets editors in,
  // so gating on it showed them a delete button the API would 403, a dead button.
  const canDeleteOrg = canManageOrg === true

  if (!org?.id) {
    return null
  }

  if (!canManageOrg) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState icon={<LockSimple size={22} />} title={t('dashboard.organization.danger_zone.no_permission')} />
      </div>
    )
  }

  const handleRemoveAllUsers = async () => {
    setIsRemovingUsers(true)
    const loadingToast = toast.loading(t('dashboard.organization.danger_zone.removing_members'))
    try {
      await removeAllUsersFromOrg(org.id, access_token)
      toast.success(t('dashboard.organization.danger_zone.members_removed'), { id: loadingToast })
    } catch (err: any) {
      toast.error(err?.message || t('dashboard.organization.danger_zone.remove_members_failed'), { id: loadingToast })
    } finally {
      setIsRemovingUsers(false)
    }
  }

  const handleWipeContent = async () => {
    setIsWipingContent(true)
    const loadingToast = toast.loading(t('dashboard.organization.danger_zone.wiping_content'))
    try {
      const res = await wipeOrgContent(org.id, access_token)
      toast.success(
        typeof res?.deleted_courses === 'number'
          ? t('dashboard.organization.danger_zone.content_wiped_count', { count: res.deleted_courses })
          : t('dashboard.organization.danger_zone.content_wiped'),
        { id: loadingToast }
      )
    } catch (err: any) {
      toast.error(err?.message || t('dashboard.organization.danger_zone.wipe_failed'), { id: loadingToast })
    } finally {
      setIsWipingContent(false)
    }
  }

  const handleDeleteOrg = async () => {
    setIsDeletingOrg(true)
    const loadingToast = toast.loading(t('dashboard.organization.danger_zone.deleting_org'))
    try {
      await deleteOrganization(org.id, access_token)
      toast.success(t('dashboard.organization.danger_zone.org_deleted'), { id: loadingToast })
      // The org no longer exists; send the user back to the root so they land
      // on org selection / login rather than a broken dashboard.
      setTimeout(() => {
        window.location.href = '/'
      }, 800)
    } catch (err: any) {
      toast.error(err?.message || t('dashboard.organization.danger_zone.delete_org_failed'), { id: loadingToast })
      setIsDeletingOrg(false)
    }
  }

  const close = (open: boolean) => !open && setDialog(null)

  return (
    <>
      <SectionCard
        icon={<Warning size={18} />}
        title={t('dashboard.organization.danger_zone.title')}
        description={t('dashboard.organization.danger_zone.subtitle')}
        className="ring-1 ring-rose-200/80 [&>div:first-child>div>div:first-child]:bg-rose-50 [&>div:first-child>div>div:first-child]:text-rose-600 [&_h2]:text-rose-700"
      >
        <div className="divide-y divide-rose-100/80">
          <SettingRow
            icon={<UserMinus size={18} />}
            title={t('dashboard.organization.danger_zone.remove_members_title')}
            description={t('dashboard.organization.danger_zone.remove_members_desc')}
            control={
              <Button variant="danger-ghost" onClick={() => setDialog('members')} loading={isRemovingUsers} className="ring-1 ring-inset ring-rose-200">
                {t('dashboard.organization.danger_zone.remove_all')}
              </Button>
            }
          />
          <SettingRow
            icon={<Eraser size={18} />}
            title={t('dashboard.organization.danger_zone.wipe_title')}
            description={t('dashboard.organization.danger_zone.wipe_desc')}
            control={
              <Button variant="danger-ghost" onClick={() => setDialog('wipe')} loading={isWipingContent} className="ring-1 ring-inset ring-rose-200">
                {t('dashboard.organization.danger_zone.wipe_content')}
              </Button>
            }
          />
          {canDeleteOrg && (
            <SettingRow
              icon={<Trash size={18} className="text-rose-500" />}
              title={<span className="text-rose-700">{t('dashboard.organization.danger_zone.delete_title')}</span>}
              description={
                <Trans
                  i18nKey="dashboard.organization.danger_zone.delete_desc"
                  values={{ name: org.name }}
                  components={{ strong: <span className="font-semibold text-neutral-700" /> }}
                />
              }
              control={
                <Button variant="danger" icon={<Trash size={14} />} onClick={() => setDialog('delete')} loading={isDeletingOrg}>
                  {t('dashboard.organization.danger_zone.delete_org')}
                </Button>
              }
            />
          )}
        </div>
      </SectionCard>

      <ConfirmDialog
        open={dialog === 'members'}
        onOpenChange={close}
        title={t('dashboard.organization.danger_zone.remove_members_dialog')}
        message={t('dashboard.organization.danger_zone.remove_members_confirm')}
        confirmLabel={t('dashboard.organization.danger_zone.remove_members_title')}
        onConfirm={handleRemoveAllUsers}
      />
      <ConfirmDialog
        open={dialog === 'wipe'}
        onOpenChange={close}
        title={t('dashboard.organization.danger_zone.wipe_dialog')}
        message={t('dashboard.organization.danger_zone.wipe_confirm')}
        confirmLabel={t('dashboard.organization.danger_zone.wipe_title')}
        onConfirm={handleWipeContent}
      />
      <TypeToConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        title={t('dashboard.organization.danger_zone.delete_title')}
        message={
          <Trans
            i18nKey="dashboard.organization.danger_zone.delete_desc"
            values={{ name: org.name }}
            components={{ strong: <span className="font-semibold text-neutral-900" /> }}
          />
        }
        expected={org.slug}
        prompt={
          <Trans
            i18nKey="dashboard.organization.danger_zone.type_to_confirm"
            values={{ slug: org.slug }}
            components={{ code: <span data-ltr-content className="font-mono font-semibold text-neutral-700" /> }}
          />
        }
        confirmLabel={t('dashboard.organization.danger_zone.delete_org')}
        onConfirm={handleDeleteOrg}
      />
    </>
  )
}

export default OrgEditDangerZone
