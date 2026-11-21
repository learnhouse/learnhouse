'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise } from '@phosphor-icons/react'
import ErrorShell, { ErrorActionRows, ErrorButton } from '@components/Objects/StyledElements/Error/ErrorShell'

/**
 * Full-page notice for a self-hosted Enterprise platform whose license lapsed
 * with `on_lapse: lock`. Calm on purpose: learners land here too, and nothing
 * on their side is broken. Only administrators can act, by contacting
 * LearnHouse; the page names no internals (reasons, keys, logs).
 *
 * Rendered by the /license-locked route (the proxy rewrites every locked page
 * there) and by LicenseLockGate when an API call answers 423.
 */
export default function LicenseLockedScreen() {
  const { t } = useTranslation()
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#f8f8f8] antialiased" data-testid="license-locked">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#d4d4d8_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <header className="relative z-10 flex items-center px-6 py-5 sm:px-10">
        <img src="/lrn-text.svg" alt="LearnHouse" width={120} height={18} className="h-[18px] w-auto opacity-80" />
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-24">
        <ErrorShell
          flush
          kind="permission"
          title={t('license.locked.title')}
          description={t('license.locked.description')}
          actions={
            <ErrorActionRows
              main={[
                <ErrorButton
                  key="retry"
                  onClick={() => window.location.reload()}
                  icon={<ArrowClockwise size={15} />}
                  label={t('license.locked.retry')}
                />,
              ]}
            />
          }
        >
          <p className="max-w-sm text-[13px] leading-relaxed text-gray-500">{t('license.locked.admin_hint')}</p>
        </ErrorShell>
      </main>
    </div>
  )
}
