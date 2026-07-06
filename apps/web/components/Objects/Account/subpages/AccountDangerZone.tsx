'use client'
import React, { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { signOut } from '@components/Contexts/AuthContext'
import { getUriWithoutOrg } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { deleteAccount } from '@services/settings/deleteAccount'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@components/ui/dialog'

// Self-service "delete my account" for the account settings pages. Deleting the
// account also deletes any organization the user is the sole admin of — and all
// of that org's content — server-side (users.py::delete_user_by_id). We surface
// that consequence prominently and require typing the username to confirm.
export default function AccountDangerZone() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const user = session?.data?.user
  const access_token = session?.data?.tokens?.access_token

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const username = user?.username ?? ''
  const canDelete = confirmText.trim() === username && !!username

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await deleteAccount(user.id, access_token)
      toast.success(
        t('account.delete.success', { defaultValue: 'Your account has been deleted.' })
      )
      setConfirmOpen(false)
      setConfirmText('')
      // Tear down the session and send the (now anonymous) user to login.
      signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/login') })
    } catch (e: any) {
      setError(
        getErrorMessage(
          e?.data?.detail,
          t('account.delete.error', {
            defaultValue: 'Could not delete your account. Please try again.',
          })
        )
      )
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl nice-shadow ring-1 ring-inset ring-red-100 overflow-hidden mt-6">
      <div className="flex flex-col bg-red-50/60 -space-y-1 px-5 py-3 mx-3 mt-3 rounded-md">
        <h1 className="font-bold text-xl text-red-700 flex items-center gap-2">
          <AlertTriangle size={18} />
          {t('account.delete.title', { defaultValue: 'Delete account' })}
        </h1>
        <h2 className="text-red-500/80 text-md pl-7">
          {t('account.delete.zone_subtitle', {
            defaultValue: 'Permanently delete your account. This cannot be undone.',
          })}
        </h2>
      </div>

      <div className="mx-5 mt-3 mb-5 sm:flex sm:items-center sm:justify-between gap-4">
        <p className="text-sm text-gray-500 max-w-xl">
          {t('account.delete.zone_body', {
            defaultValue:
              'This removes your account and access. Any organization you are the sole admin of — and all of its courses and content — will be deleted too. Organizations with other admins are kept; you are simply removed from them.',
          })}
        </p>
        <div className="mt-4 sm:mt-0 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setError(null)
              setConfirmText('')
              setConfirmOpen(true)
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-red-600 hover:bg-red-700 transition-colors"
          >
            <Trash2 size={15} />
            {t('account.delete.title', { defaultValue: 'Delete account' })}
          </button>
        </div>
      </div>

      {/* Typed-confirmation delete dialog */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (deleting) return
          setConfirmOpen(open)
          if (!open) {
            setConfirmText('')
            setError(null)
          }
        }}
      >
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 text-red-600 flex-shrink-0">
                <AlertTriangle size={18} />
              </div>
              <DialogTitle>
                {t('account.delete.title', { defaultValue: 'Delete account' })}
              </DialogTitle>
            </div>
            <DialogDescription className="mt-3">
              {t('account.delete.warning', {
                defaultValue:
                  'This permanently deletes your account and all associated data, including any organization you solely own. This action cannot be undone.',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <label className="block text-xs font-medium text-black/50 mb-1.5">
              {t('account.delete.confirm_label', {
                defaultValue: 'Type {{username}} to confirm',
                username,
              })}
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={username}
              autoComplete="off"
              className="w-full px-3 py-2 text-sm rounded-xl border border-black/10 bg-white focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 transition-colors"
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>

          <DialogFooter className="mt-5 gap-2">
            <button
              type="button"
              onClick={() => {
                if (deleting) return
                setConfirmOpen(false)
                setConfirmText('')
                setError(null)
              }}
              disabled={deleting}
              className="px-4 py-2 text-sm font-semibold rounded-xl text-gray-700 bg-black/[0.04] hover:bg-black/[0.07] transition-colors disabled:opacity-50"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
              className="px-4 py-2 text-sm font-semibold rounded-xl text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting
                ? t('account.delete.deleting', { defaultValue: 'Deleting…' })
                : t('account.delete.title', { defaultValue: 'Delete account' })}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
