'use client'
import React, { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Check, Loader2, AlertTriangle } from 'lucide-react'
import { motion } from 'motion/react'
import toast from 'react-hot-toast'
import { verifyStripeConnection } from '@services/payments/providers/stripe'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import {
  readStripeCallbackParams,
  stripeCallbackStep,
} from '@lib/payments/stripeConnectCallback'
import Image from 'next/image'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { useTranslation } from 'react-i18next'

function StripeConnectCallbackInner() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const session = useLHSession()
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState('')
  const { track } = useLHAnalytics('dashboard')
  // Settled once: Stripe's code is single-use, so after it has been sent (or the
  // page has given up) no later render — a session refresh, a rotated token —
  // may act on it again.
  const handled = useRef(false)

  const accessToken = session?.data?.tokens?.access_token

  useEffect(() => {
    const fail = (title: string, reason = '') => {
      setStatus('error')
      setMessage(title)
      setDetail(reason || t('payments.stripe_retry'))
      toast.error(title)
    }

    if (handled.current) return
    const params = readStripeCallbackParams(searchParams)
    if (params.kind !== 'ready') {
      handled.current = true
      return fail(t(params.kind === 'cancelled' ? 'payments.stripe_denied' : 'payments.stripe_failed'))
    }

    const step = stripeCallbackStep(session?.status, accessToken, handled.current)
    if (step === 'wait') return
    handled.current = true
    if (step === 'login' || !accessToken) {
      return fail(t('payments.stripe_failed'), t('payments.stripe_login_required'))
    }

    const connect = async () => {
      try {
        const res = await verifyStripeConnection(params.orgId, params.code, params.state, accessToken)
        if (!res.success) {
          const apiDetail = res.data?.detail
          return fail(t('payments.stripe_failed'), typeof apiDetail === 'string' ? apiDetail : '')
        }

        track(AnalyticsEvent.PaymentProviderConnected, { provider: 'stripe' })
        setStatus('success')
        setMessage(t('payments.stripe_success'))
        setDetail(t('payments.stripe_return'))

        if (window.opener) {
          window.opener.postMessage({ type: 'payment_provider_connected', provider: 'stripe' }, '*')
          setTimeout(() => window.close(), 2000)
        }
      } catch (error) {
        console.error('Error verifying Stripe connection:', error)
        fail(t('payments.stripe_failed'))
      }
    }
    connect()
  }, [session?.status, accessToken, searchParams, t, track])

  return (
    <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="mb-10">
          <Image
            quality={100}
            width={50}
            height={50}
            src={learnhouseIcon}
            alt=""
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white p-8 rounded-xl nice-shadow max-w-md w-full mx-4"
        >
          <div className="flex flex-col items-center text-center space-y-4">
            {status === 'processing' && (
              <>
                <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
                <h2 className="text-xl font-semibold text-gray-800">
                  {t('payments.stripe_completing')}
                </h2>
                <p className="text-gray-500">
                  {t('payments.stripe_wait')}
                </p>
              </>
            )}

            {status === 'success' && (
              <>
                <div className="bg-green-100 p-3 rounded-full">
                  <Check className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">{message}</h2>
                <p className="text-gray-500">{detail}</p>
              </>
            )}

            {status === 'error' && (
              <>
                <div className="bg-red-100 p-3 rounded-full">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">{message}</h2>
                <p className="text-gray-500">{detail}</p>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default function StripeConnectCallback() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full bg-[#f8f8f8] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
      </div>
    }>
      <StripeConnectCallbackInner />
    </Suspense>
  )
}
