'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { toast } from 'react-hot-toast'
import { AlertTriangle, Trash2, Users, Eraser, Loader2 } from 'lucide-react'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  deleteOrganizationFromBackend,
  removeAllUsersFromOrg,
  wipeOrgContent,
} from '@services/organizations/orgs'

const OrgEditDangerZone: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { isAdmin, rights } = useAdminStatus()

  const [confirmText, setConfirmText] = React.useState('')
  const [isDeletingOrg, setIsDeletingOrg] = React.useState(false)
  const [isRemovingUsers, setIsRemovingUsers] = React.useState(false)
  const [isWipingContent, setIsWipingContent] = React.useState(false)

  // Only admins (or users with explicit org-delete rights) should ever see this.
  const canDeleteOrg = rights?.organizations?.action_delete === true || isAdmin === true

  if (!org?.id) {
    return null
  }

  if (isAdmin === false && !canDeleteOrg) {
    return (
      <div className="sm:mx-10 mx-0">
        <div className="bg-white rounded-xl nice-shadow p-6 text-gray-500">
          You don&apos;t have permission to manage this organization&apos;s danger zone.
        </div>
      </div>
    )
  }

  const handleRemoveAllUsers = async () => {
    setIsRemovingUsers(true)
    const loadingToast = toast.loading('Removing all members…')
    try {
      await removeAllUsersFromOrg(org.id, access_token)
      toast.success('All other members removed', { id: loadingToast })
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove members', { id: loadingToast })
    } finally {
      setIsRemovingUsers(false)
    }
  }

  const handleWipeContent = async () => {
    setIsWipingContent(true)
    const loadingToast = toast.loading('Wiping organization content…')
    try {
      const res = await wipeOrgContent(org.id, access_token)
      toast.success(
        `Content wiped${typeof res?.deleted_courses === 'number' ? ` (${res.deleted_courses} course(s) deleted)` : ''}`,
        { id: loadingToast }
      )
    } catch (err: any) {
      toast.error(err?.message || 'Failed to wipe content', { id: loadingToast })
    } finally {
      setIsWipingContent(false)
    }
  }

  const handleDeleteOrg = async () => {
    if (confirmText !== org.slug) return
    setIsDeletingOrg(true)
    const loadingToast = toast.loading('Deleting organization…')
    try {
      await deleteOrganizationFromBackend(org.id, access_token)
      toast.success('Organization deleted', { id: loadingToast })
      // The org no longer exists — send the user back to the root so they land
      // on org selection / login rather than a broken dashboard.
      setTimeout(() => {
        window.location.href = '/'
      }, 800)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete organization', { id: loadingToast })
      setIsDeletingOrg(false)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 space-y-4">
      <div className="rounded-xl nice-shadow bg-white border border-red-100 overflow-hidden">
        <div className="flex items-center space-x-2 bg-red-50 px-5 py-3 border-b border-red-100">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <h1 className="font-bold text-xl text-red-700">Danger Zone</h1>
            <h2 className="text-red-500/80 text-sm">
              These actions are permanent and cannot be undone.
            </h2>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {/* Remove all members */}
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4 text-gray-700" />
                <span className="font-semibold text-gray-800">Remove all members</span>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                Remove every member from this organization except you. Courses and
                other content are kept.
              </p>
            </div>
            <ConfirmationModal
              confirmationButtonText="Remove all members"
              confirmationMessage="Every member except you will be removed from this organization. This cannot be undone."
              dialogTitle="Remove all members?"
              status="warning"
              functionToExecute={handleRemoveAllUsers}
              dialogTrigger={
                <button
                  type="button"
                  disabled={isRemovingUsers}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition disabled:opacity-50"
                >
                  {isRemovingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  <span>Remove all</span>
                </button>
              }
            />
          </div>

          {/* Wipe content */}
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="space-y-0.5">
              <div className="flex items-center space-x-2">
                <Eraser className="h-4 w-4 text-gray-700" />
                <span className="font-semibold text-gray-800">Wipe all content</span>
              </div>
              <p className="text-sm text-gray-500 max-w-xl">
                Permanently delete all courses and their content. The organization
                and its members are kept.
              </p>
            </div>
            <ConfirmationModal
              confirmationButtonText="Wipe all content"
              confirmationMessage="All courses and their content will be permanently deleted. This cannot be undone."
              dialogTitle="Wipe all content?"
              status="warning"
              functionToExecute={handleWipeContent}
              dialogTrigger={
                <button
                  type="button"
                  disabled={isWipingContent}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 transition disabled:opacity-50"
                >
                  {isWipingContent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
                  <span>Wipe content</span>
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
                  <span className="font-semibold text-red-800">Delete this organization</span>
                </div>
                <p className="text-sm text-gray-500 max-w-xl">
                  Permanently delete <span className="font-semibold">{org.name}</span> and
                  everything in it — members, courses, content and settings. This
                  cannot be undone.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-500">
                  Type <span className="font-mono font-semibold text-gray-700">{org.slug}</span> to confirm.
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={org.slug}
                    className="w-full max-w-xs px-3 py-2 border border-red-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  />
                  <button
                    type="button"
                    onClick={handleDeleteOrg}
                    disabled={confirmText !== org.slug || isDeletingOrg}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isDeletingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    <span>Delete organization</span>
                  </button>
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
