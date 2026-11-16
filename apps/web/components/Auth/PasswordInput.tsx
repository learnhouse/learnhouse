'use client'
import React from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { AUTH_INPUT } from '@components/Auth/AuthUI'

/**
 * The auth password field with a show/hide toggle. Takes the same props as an
 * input (so it works under Radix `Form.Control asChild`); `type` is managed.
 */
const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className = '', ...props }, ref) {
    const { t } = useTranslation()
    const [shown, setShown] = React.useState(false)
    const label = shown
      ? t('auth.hide_password', { defaultValue: 'Hide password' })
      : t('auth.show_password', { defaultValue: 'Show password' })
    return (
      <div className="relative">
        <input ref={ref} {...props} type={shown ? 'text' : 'password'} className={`${AUTH_INPUT} pe-10 ${className}`} />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={label}
          aria-pressed={shown}
          title={label}
          className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-xl text-neutral-400 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15"
        >
          {shown ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    )
  }
)

export default PasswordInput
