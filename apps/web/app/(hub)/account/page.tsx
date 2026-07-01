'use client'
import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, AlertTriangle, Trash2, ShieldAlert, UserCog, KeyRound } from 'lucide-react'
import { Toaster, toast } from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { signOut } from '@components/Contexts/AuthContext'
import UserAvatar from '@components/Objects/UserAvatar'
import AccountGeneral from '@components/Objects/Account/subpages/AccountGeneral'
import AccountSecurity from '@components/Objects/Account/subpages/AccountSecurity'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@components/ui/dialog'
import { deleteUser } from './_lib/deleteUser'

function AccountClient() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()

  const access_token = session?.data?.tokens?.access_token
  const user = session?.data?.user
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  // Redirect unauthenticated users to login (mirror app/home/home.tsx).
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  const showLoader = isLoading || !isAuthenticated

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <Toaster />
      <div className="relative min-h-screen">
        {/* Blueprint grid — fades in from bottom */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 min-h-screen px-4 py-8">
          <div className="w-full max-w-2xl mx-auto">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3 min-w-0">
                <Link
                  href="/home"
                  className="flex items-center justify-center w-9 h-9 rounded-xl bg-white nice-shadow text-black/50 hover:text-black transition-colors flex-shrink-0"
                  aria-label={t('account.back_home', { defaultValue: 'Back to organizations' })}
                >
                  <ArrowLeft size={16} />
                </Link>
                <div className="flex flex-col min-w-0">
                  <h1 className="text-lg font-black tracking-tight text-gray-900 truncate">
                    {t('account.title', { defaultValue: 'Account settings' })}
                  </h1>
                  <p className="text-xs text-black/40 truncate">
                    {t('account.subtitle', {
                      defaultValue: 'Manage your profile, security and account',
                    })}
                  </p>
                </div>
              </div>
              {isAuthenticated && (
                <UserAvatar border="border-2" rounded="rounded-full" width={36} />
              )}
            </div>

            {showLoader ? (
              <div className="space-y-4">
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
                <div className="h-28 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* A. Profile — identity (first/last name, username, bio, avatar) */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <UserCog size={15} className="text-black/40" />
                    <h2 className="text-sm font-semibold text-gray-700">
                      {t('account.section.profile', { defaultValue: 'Profile' })}
                    </h2>
                  </div>
                  <AccountGeneral />
                </section>

                {/* B. Security — change password */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <KeyRound size={15} className="text-black/40" />
                    <h2 className="text-sm font-semibold text-gray-700">
                      {t('account.section.security', { defaultValue: 'Security' })}
                    </h2>
                  </div>
                  <AccountSecurity />
                </section>

                {/* C. Danger zone — delete account */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <ShieldAlert size={15} className="text-red-500/70" />
                    <h2 className="text-sm font-semibold text-red-600">
                      {t('account.section.danger', { defaultValue: 'Danger zone' })}
                    </h2>
                  </div>
                  <DangerZone user={user} access_token={access_token} />
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DangerZone({ user, access_token }: { user: any; access_token: string }) {
  const { t } = useTranslation()
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
      await deleteUser(user.id, access_token)
      toast.success(
        t('account.delete.success', { defaultValue: 'Your account has been deleted.' })
      )
      setConfirmOpen(false)
      setConfirmText('')
      // Tear down the session and send the (now anonymous) user to login.
      signOut({ redirect: true, callbackUrl: '/login' })
    } catch (e: any) {
      setError(
        e?.data?.detail ||
          t('account.delete.error', {
            defaultValue: 'Could not delete your account. Please try again.',
          })
      )
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white nice-shadow ring-1 ring-inset ring-red-100 overflow-hidden">
      <div className="p-5 sm:flex sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 text-red-600 flex-shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">
              {t('account.delete.title', { defaultValue: 'Delete account' })}
            </h3>
            <p className="text-sm text-black/50 mt-0.5">
              {t('account.delete.description', {
                defaultValue:
                  'Permanently delete your account and remove your access. This cannot be undone.',
              })}
            </p>
          </div>
        </div>
        <div className="mt-4 sm:mt-0 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              setError(null)
              setConfirmText('')
              setConfirmOpen(true)
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white bg-red-600 hover:bg-red-700 transition-colors"
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
                  'This permanently deletes your account and all associated data. This action cannot be undone.',
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

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[100] bg-white" />}>
      <AccountClient />
    </Suspense>
  )
}
