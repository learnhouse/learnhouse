'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { toast } from 'react-hot-toast'
import { AlertTriangle, Trash2, Users, Eraser, Loader2 } from 'lucide-react'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { Trans, useTranslation } from 'react-i18next'
import {
  deleteOrganizationFromBackend,
  removeAllUsersFromOrg,
  wipeOrgContent,
} from '@services/organizations/orgs'

const OrgEditDangerZone: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { canManageOrg } = useAdminStatus()

  const [confirmText, setConfirmText] = React.useState('')
  const [isDeletingOrg, setIsDeletingOrg] = React.useState(false)
  const [isRemovingUsers, setIsRemovingUsers] = React.useState(false)
  const [isWipingContent, setIsWipingContent] = React.useState(false)

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
      <div className="sm:mx-10 mx-0">
        <div className="bg-white rounded-xl nice-shadow p-6 text-gray-500">
          {t('dashboard.organization.danger_zone.no_permission')}
        </div>
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
    if (confirmText !== org.slug) return
    setIsDeletingOrg(true)
    const loadingToast = toast.loading(t('dashboard.organization.danger_zone.deleting_org'))
    try {
      await deleteOrganizationFromBackend(org.id, access_token)
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

  return (
    <div className="sm:mx-10 mx-0 space-y-4">
      <div className="rounded-xl nice-shadow bg-white border border-red-100 overflow-hidden">
        <div className="flex items-center space-x-2 bg-red-50 px-5 py-3 border-b border-red-100">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <h1 className="font-bold text-xl text-red-700">{t('dashboard.organization.danger_zone.title')}</h1>
            <h2 className="text-red-500/80 text-sm">
              {t('dashboard.organization.danger_zone.subtitle')}
            </h2>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {/* Remove all members */}
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4 text-gray-700" />
                <span className="font-semibold text-gray-800">{t('dashboard.organization.danger_zone.remove_members_title')}</span>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                {t('dashboard.organization.danger_zone.remove_members_desc')}
              </p>
            </div>
            <ConfirmationModal
              confirmationButtonText={t('dashboard.organization.danger_zone.remove_members_title')}
              confirmationMessage={t('dashboard.organization.danger_zone.remove_members_confirm')}
              dialogTitle={t('dashboard.organization.danger_zone.remove_members_dialog')}
              status="warning"
              functionToExecute={handleRemoveAllUsers}
              dialogTrigger={
                <button
                  type="button"
                  disabled={isRemovingUsers}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition disabled:opacity-50"
                >
                  {isRemovingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  <span>{t('dashboard.organization.danger_zone.remove_all')}</span>
                </button>
              }
            />
          </div>

          {/* Wipe content */}
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-2">
                <Eraser className="h-4 w-4 text-gray-700" />
                <span className="font-semibold text-gray-800">{t('dashboard.organization.danger_zone.wipe_title')}</span>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                {t('dashboard.organization.danger_zone.wipe_desc')}
              </p>
            </div>
            <ConfirmationModal
              confirmationButtonText={t('dashboard.organization.danger_zone.wipe_title')}
              confirmationMessage={t('dashboard.organization.danger_zone.wipe_confirm')}
              dialogTitle={t('dashboard.organization.danger_zone.wipe_dialog')}
              status="warning"
              functionToExecute={handleWipeContent}
              dialogTrigger={
                <button
                  type="button"
                  disabled={isWipingContent}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition disabled:opacity-50"
                >
                  {isWipingContent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
                  <span>{t('dashboard.organization.danger_zone.wipe_content')}</span>
                </button>
              }
            />
          </div>

          {/* Delete organization (typed confirmation) */}
          {canDeleteOrg && (
            <div className="px-5 py-4 space-y-3 bg-red-50/30">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <Trash2 className="h-4 w-4 text-red-700" />
                  <span className="font-semibold text-red-800">{t('dashboard.organization.danger_zone.delete_title')}</span>
                </div>
                <p className="text-sm text-gray-500 max-w-xl">
                  <Trans
                    i18nKey="dashboard.organization.danger_zone.delete_desc"
                    values={{ name: org.name }}
                    components={{ strong: <span className="font-semibold" /> }}
                  />
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-500">
                  <Trans
                    i18nKey="dashboard.organization.danger_zone.type_to_confirm"
                    values={{ slug: org.slug }}
                    components={{ code: <span data-ltr-content className="font-mono font-semibold text-gray-700" /> }}
                  />
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={org.slug}
                    className="w-full max-w-xs px-3 py-2 border border-red-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  />
                  <ToolTip content={t('dashboard.organization.danger_zone.delete_org_tooltip', { defaultValue: 'Permanently delete org' })} side="top" slateBlack>
                    <button
                      type="button"
                      onClick={handleDeleteOrg}
                      disabled={confirmText !== org.slug || isDeletingOrg}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isDeletingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      <span>{t('dashboard.organization.danger_zone.delete_org')}</span>
                    </button>
                  </ToolTip>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default OrgEditDangerZone
