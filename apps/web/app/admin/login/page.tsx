'use client'
import React, { useState } from 'react'
import { useAuth } from '@components/Contexts/AuthContext'
import { ShieldStar, WarningCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Button, FieldLabel, INPUT } from '@/design'

export default function AdminLoginPage() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError(t('admin.login.invalid_credentials'))
      } else {
        window.location.href = '/admin'
      }
    } catch {
      setError(t('admin.login.generic_error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--adm-canvas)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 text-center">
          <img src="/lrn-dash.svg" alt="" className="h-11 w-11 mb-4" />
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t('admin.shell.title')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('admin.login.sign_in_to_continue')}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl nice-shadow p-6 flex flex-col gap-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/10">
              <WarningCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <label htmlFor="email" className="block">
            <FieldLabel>{t('admin.login.email')}</FieldLabel>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              className={INPUT}
              placeholder="admin@example.com"
            />
          </label>

          <label htmlFor="password" className="block">
            <FieldLabel>{t('admin.login.password')}</FieldLabel>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={INPUT}
              placeholder={t('admin.login.password_placeholder')}
            />
          </label>

          <Button type="submit" variant="primary" size="lg" loading={isLoading} className="w-full justify-center mt-1">
            {isLoading ? t('admin.login.signing_in') : t('admin.login.sign_in')}
          </Button>
        </form>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-neutral-400">
          <ShieldStar size={13} weight="fill" />
          {t('admin.login.superadmin_only')}
        </p>
      </div>
    </div>
  )
}
