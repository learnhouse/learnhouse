'use client'
import React, { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  Blocks,
  CheckCircle2,
  Loader2,
  Power,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import {
  OrgAppAdmin,
  approveOrgApp,
  describeScope,
  listOrgApps,
  setOrgAppEnabled,
  uninstallOrgApp,
  uploadAppPackage,
} from '@services/apps/apps'

/**
 * Admin manage surface: upload a packaged app (zip), review + approve the
 * scopes its manifest requests, enable/disable and uninstall apps.
 */
function OrgAppsManage() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // App awaiting scope review after an upload, plus the checkbox state.
  const [reviewApp, setReviewApp] = useState<OrgAppAdmin | null>(null)
  const [grantedScopes, setGrantedScopes] = useState<string[]>([])

  const { data: apps, isLoading } = useQuery<OrgAppAdmin[]>({
    queryKey: ['org-apps-admin', org?.id],
    queryFn: () => listOrgApps(org.id, accessToken),
    enabled: !!org?.id && !!accessToken,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['org-apps-admin', org?.id] })
    queryClient.invalidateQueries({ queryKey: ['org-apps', org?.id] })
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    const loadingToast = toast.loading(
      t('dashboard.apps.uploading', { defaultValue: 'Uploading app package...' })
    )
    try {
      const res = await uploadAppPackage(org.id, file, accessToken)
      if (res.success) {
        toast.success(
          t('dashboard.apps.uploaded', { defaultValue: 'App uploaded — review its permissions' }),
          { id: loadingToast }
        )
        setReviewApp(res.data as OrgAppAdmin)
        setGrantedScopes((res.data as OrgAppAdmin).requested_scopes)
        refresh()
      } else {
        toast.error(res.data?.detail || 'Failed to upload app', { id: loadingToast })
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to upload app', { id: loadingToast })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleApprove = async () => {
    if (!reviewApp) return
    const loadingToast = toast.loading(
      t('dashboard.apps.approving', { defaultValue: 'Activating app...' })
    )
    try {
      const res = await approveOrgApp(org.id, reviewApp.app_uuid, grantedScopes, accessToken)
      if (res.success) {
        toast.success(t('dashboard.apps.approved', { defaultValue: 'App activated' }), {
          id: loadingToast,
        })
        setReviewApp(null)
        refresh()
      } else {
        toast.error(res.data?.detail || 'Failed to activate app', { id: loadingToast })
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to activate app', { id: loadingToast })
    }
  }

  const handleToggle = async (app: OrgAppAdmin) => {
    const res = await setOrgAppEnabled(org.id, app.app_uuid, !app.enabled, accessToken)
    if (res.success) {
      toast.success(
        app.enabled
          ? t('dashboard.apps.disabled', { defaultValue: 'App disabled' })
          : t('dashboard.apps.enabled', { defaultValue: 'App enabled' })
      )
      refresh()
    } else {
      toast.error(res.data?.detail || 'Failed to update app')
    }
  }

  const handleUninstall = async (app: OrgAppAdmin) => {
    const res = await uninstallOrgApp(org.id, app.app_uuid, accessToken)
    if (res.success) {
      toast.success(t('dashboard.apps.uninstalled', { defaultValue: 'App uninstalled' }))
      refresh()
    } else {
      toast.error(res.data?.detail || 'Failed to uninstall app')
    }
  }

  return (
    <div className="ml-4 mr-4 sm:ml-10 sm:mr-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4 mb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2 text-gray-700 font-bold">
          <Blocks size={18} />
          <span>{t('dashboard.apps.installed_title', { defaultValue: 'Installed Apps' })}</span>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center space-x-2 rounded-lg bg-black text-white text-sm px-3 py-2 hover:bg-gray-800 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            <span>{t('dashboard.apps.upload', { defaultValue: 'Upload app (.zip)' })}</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : !apps || apps.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          {t('dashboard.apps.empty', {
            defaultValue:
              'No apps installed yet. Upload a packaged app (.zip with a learnhouse.json manifest) to get started.',
          })}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {apps.map((app) => (
            <div key={app.app_uuid} className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-gray-800 truncate">{app.name}</span>
                  <span className="text-xs text-gray-400">v{app.version}</span>
                  {app.status === 'pending' ? (
                    <span className="text-xs rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">
                      {t('dashboard.apps.pending', { defaultValue: 'Awaiting approval' })}
                    </span>
                  ) : app.enabled ? (
                    <span className="text-xs rounded-full bg-green-100 text-green-700 px-2 py-0.5">
                      {t('dashboard.apps.active', { defaultValue: 'Active' })}
                    </span>
                  ) : (
                    <span className="text-xs rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">
                      {t('dashboard.apps.inactive', { defaultValue: 'Disabled' })}
                    </span>
                  )}
                </div>
                {app.description && (
                  <div className="text-sm text-gray-500 truncate">{app.description}</div>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  {app.requested_scopes.length > 0
                    ? app.requested_scopes.join(', ')
                    : t('dashboard.apps.no_scopes', { defaultValue: 'No permissions requested' })}
                </div>
              </div>
              <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                {app.status === 'pending' ? (
                  <button
                    onClick={() => {
                      setReviewApp(app)
                      setGrantedScopes(app.requested_scopes)
                    }}
                    className="flex items-center space-x-1 rounded-lg bg-amber-500 text-white text-xs px-3 py-1.5 hover:bg-amber-600"
                  >
                    <ShieldCheck size={14} />
                    <span>{t('dashboard.apps.review', { defaultValue: 'Review & activate' })}</span>
                  </button>
                ) : (
                  <>
                    {app.enabled && (
                      <Link
                        href={getUriWithOrg(org?.slug, '') + `/dash/apps/${app.slug}`}
                        className="text-xs text-gray-600 hover:text-black underline"
                      >
                        {t('dashboard.apps.open', { defaultValue: 'Open' })}
                      </Link>
                    )}
                    <button
                      onClick={() => handleToggle(app)}
                      className="flex items-center space-x-1 rounded-lg bg-gray-100 text-gray-700 text-xs px-3 py-1.5 hover:bg-gray-200"
                    >
                      <Power size={14} />
                      <span>
                        {app.enabled
                          ? t('dashboard.apps.disable', { defaultValue: 'Disable' })
                          : t('dashboard.apps.enable', { defaultValue: 'Enable' })}
                      </span>
                    </button>
                  </>
                )}
                <ConfirmationModal
                  confirmationButtonText={t('dashboard.apps.uninstall', {
                    defaultValue: 'Uninstall',
                  })}
                  confirmationMessage={t('dashboard.apps.uninstall_confirm', {
                    defaultValue:
                      'This removes the app and deletes its files. Members will lose access immediately.',
                  })}
                  dialogTitle={`${t('dashboard.apps.uninstall', { defaultValue: 'Uninstall' })} ${app.name}?`}
                  dialogTrigger={
                    <button className="flex items-center space-x-1 rounded-lg bg-red-50 text-red-600 text-xs px-3 py-1.5 hover:bg-red-100">
                      <Trash2 size={14} />
                      <span>{t('dashboard.apps.uninstall', { defaultValue: 'Uninstall' })}</span>
                    </button>
                  }
                  functionToExecute={() => handleUninstall(app)}
                  status="warning"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl nice-shadow max-w-lg w-full p-6">
            <div className="flex items-center space-x-2 mb-1">
              <ShieldCheck size={18} className="text-amber-600" />
              <h2 className="font-bold text-lg text-gray-800">
                {t('dashboard.apps.review_title', { defaultValue: 'Review permissions' })}
              </h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {t('dashboard.apps.review_subtitle', {
                defaultValue:
                  '"{{name}}" requests the permissions below. It will only ever act on behalf of the member using it — never beyond their own rights.',
                name: reviewApp.name,
              })}
            </p>
            {reviewApp.requested_scopes.length === 0 ? (
              <div className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-4">
                {t('dashboard.apps.review_no_scopes', {
                  defaultValue: 'This app requests no API permissions.',
                })}
              </div>
            ) : (
              <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
                {reviewApp.requested_scopes.map((scope) => (
                  <label
                    key={scope}
                    className="flex items-center space-x-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={grantedScopes.includes(scope)}
                      onChange={(e) =>
                        setGrantedScopes((prev) =>
                          e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope)
                        )
                      }
                    />
                    <span>{describeScope(scope)}</span>
                    <span className="text-xs text-gray-400 ml-auto">{scope}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setReviewApp(null)}
                className="rounded-lg bg-gray-100 text-gray-700 text-sm px-4 py-2 hover:bg-gray-200"
              >
                {t('dashboard.apps.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleApprove}
                className="flex items-center space-x-2 rounded-lg bg-black text-white text-sm px-4 py-2 hover:bg-gray-800"
              >
                <CheckCircle2 size={16} />
                <span>
                  {t('dashboard.apps.approve', { defaultValue: 'Approve & activate' })}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OrgAppsManage
