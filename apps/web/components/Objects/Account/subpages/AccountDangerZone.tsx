'use client'
import React, { useState } from 'react'
import { Trash, Warning } from '@phosphor-icons/react'
import { Button, INPUT } from '@/design'
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
// account also deletes any organization the user is the sole admin of (and all
// of that org's content) server-side (users.py::delete_user_by_id). We surface
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
    <section className="bg-white rounded-2xl nice-shadow ring-1 ring-inset ring-rose-100">
      <div className="p-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <Warning size={18} weight="duotone" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900 leading-tight">
              {t('account.delete.title', { defaultValue: 'Delete account' })}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {t('account.delete.zone_subtitle', {
                defaultValue: 'Permanently delete your account. This cannot be undone.',
              })}
            </p>
            <p className="mt-3 text-sm text-neutral-500 max-w-xl">
              {t('account.delete.zone_body', {
                defaultValue:
                  'This removes your account and access. Any organization you are the sole admin of (and all of its courses and content) will be deleted too. Organizations with other admins are kept; you are simply removed from them.',
              })}
            </p>
          </div>
        </div>
        <Button
          variant="danger"
          className="shrink-0 self-start ms-12 sm:ms-0"
          icon={<Trash size={14} weight="bold" />}
          onClick={() => {
            setError(null)
            setConfirmText('')
            setConfirmOpen(true)
          }}
        >
          {t('account.delete.title', { defaultValue: 'Delete account' })}
        </Button>
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
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex-shrink-0">
                <Warning size={18} weight="duotone" />
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
            <label htmlFor="account-delete-confirm" className="block text-sm font-semibold text-neutral-800 mb-1.5">
              {t('account.delete.confirm_label', {
                defaultValue: 'Type {{username}} to confirm',
                username,
              })}
            </label>
            <input
              id="account-delete-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={username}
              autoComplete="off"
              className={`${INPUT} focus:ring-rose-500/30`}
            />
            {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
          </div>

          <DialogFooter className="mt-5 gap-2">
            <Button
              onClick={() => {
                if (deleting) return
                setConfirmOpen(false)
                setConfirmText('')
                setError(null)
              }}
              disabled={deleting}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={!canDelete} loading={deleting}>
              {deleting
                ? t('account.delete.deleting', { defaultValue: 'Deleting…' })
                : t('account.delete.title', { defaultValue: 'Delete account' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
