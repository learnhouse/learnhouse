'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Copy, Check, ArrowUpRight, Certificate, ChartLineUp, PlusCircle, CaretRight } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAbsoluteUriWithOrg, getUriWithOrg } from '@services/config/config'
import { useOnboarding } from '@components/Hooks/useOnboarding'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'

const NEXT = [
  { key: 'certificates', icon: Certificate, href: '/dash/courses' },
  { key: 'analytics', icon: ChartLineUp, href: '/dash/analytics' },
  { key: 'next_course', icon: PlusCircle, href: '/dash/courses?new=true' },
]

/** The end of setup: the school is live, here is its link, here is what's next. */
export default function LaunchFinale() {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
  const { dismiss } = useOnboarding()
  const org = useOrg() as any
  const orgSlug = org?.slug || ''
  const url = getAbsoluteUriWithOrg(orgSlug, '/')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the link is still selectable */
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      <section className="bg-white rounded-xl nice-shadow overflow-hidden">
        <div className="px-5 pt-5 pb-5">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle size={18} weight="fill" />
            <span className="text-xs font-semibold">{t('onboarding.finale.badge')}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-gray-900">
            {t('onboarding.finale.title', { name: org?.name || '' })}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">{t('onboarding.finale.subtitle')}</p>

          <label className="mt-5 block text-xs font-medium text-gray-500">{t('onboarding.finale.link_label')}</label>
          <div className="mt-1.5 flex max-w-xl items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-100 select-all">
              {url}
            </span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-xs font-bold text-white nice-shadow hover:bg-gray-800 transition-colors"
            >
              {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
              {copied ? t('onboarding.finale.copied') : t('onboarding.finale.copy')}
            </button>
            <a
              href={getUriWithOrg(orgSlug, '/')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-2 text-gray-500 nice-shadow hover:text-gray-900 transition-colors"
              aria-label={t('onboarding.finale.open')}
              title={t('onboarding.finale.open')}
            >
              <ArrowUpRight size={14} weight="bold" data-dir-flip />
            </a>
          </div>
        </div>
        <div className="border-t border-gray-100 px-5 py-3">
          <Link
            href={getUriWithOrg(orgSlug, '/dash')}
            onClick={() => {
              track(AnalyticsEvent.OnboardingFinished)
              dismiss()
            }}
            className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
          >
            {t('onboarding.finale.close')}
          </Link>
        </div>
      </section>

      <section className="bg-white rounded-xl nice-shadow overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-sm font-semibold text-gray-700">{t('onboarding.finale.whats_next')}</h3>
        </div>
        <ul className="px-2 pb-2">
          {NEXT.filter((n) => n.key !== 'analytics' || isOrgAnalyticsAvailable()).map((n) => (
            <li key={n.key}>
              <Link
                href={getUriWithOrg(orgSlug, n.href)}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-50 transition-colors"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <n.icon size={16} weight="duotone" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{t(`onboarding.finale.next.${n.key}.title`)}</span>
                  <span className="block text-xs text-gray-400">{t(`onboarding.finale.next.${n.key}.desc`)}</span>
                </span>
                <CaretRight size={12} className="shrink-0 text-gray-300 group-hover:text-gray-500" data-dir-flip />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
