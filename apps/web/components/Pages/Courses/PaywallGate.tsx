'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { getOfferCheckoutSession } from '@services/payments/offers'

interface PaywallCopy {
  headline?: string
  subhead?: string
  benefits?: string[]
  price_label?: string
  price_sub?: string
  urgency?: string
  cta_label?: string
  secondary_label?: string
  guarantee?: string
}

interface PaywallOfferApi {
  offer_uuid: string
  name: string
  description: string
  benefits: string
  amount: number
  currency: string
  org_id: number
}

interface PaywallGateProps {
  chapterUuid: string
  orgslug: string
  courseUuid: string
  copy?: PaywallCopy
  accessToken?: string
  redirectBackPath?: string
  fallback?: React.ReactNode
}

function formatPrice(amount: number, currency: string) {
  if (typeof amount !== 'number') return ''
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

const PaywallGate: React.FC<PaywallGateProps> = ({
  chapterUuid,
  orgslug,
  courseUuid,
  copy,
  accessToken,
  redirectBackPath,
  fallback,
}) => {
  const [offer, setOffer] = useState<PaywallOfferApi | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`${getAPIUrl()}chapters/${chapterUuid}/paywall_offer`, {
          method: 'GET',
        })
        if (cancelled) return
        if (res.status === 404) {
          setNotFound(true)
        } else if (res.ok) {
          const data = await res.json()
          setOffer(data)
        } else {
          setNotFound(true)
        }
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [chapterUuid])

  const handleCheckout = async () => {
    if (!offer || !accessToken) return
    setError(null)
    setCheckoutLoading(true)
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const backPath = redirectBackPath || getUriWithOrg(orgslug, `/course/${courseUuid}`)
      const redirectUri = `${origin}${backPath}${backPath.includes('?') ? '&' : '?'}paid=1`
      const res: any = await getOfferCheckoutSession(
        offer.org_id,
        offer.offer_uuid,
        redirectUri,
        accessToken
      )
      if (res?.success && res?.data?.url) {
        window.location.href = res.data.url
      } else {
        setError(res?.HTTPmessage || 'No se pudo iniciar el checkout. Intenta de nuevo.')
        setCheckoutLoading(false)
      }
    } catch (e: any) {
      setError(e?.message || 'Error iniciando el checkout.')
      setCheckoutLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto my-16 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-8 text-center animate-pulse">
        <div className="h-6 bg-gray-100 rounded w-1/2 mx-auto mb-4" />
        <div className="h-3 bg-gray-100 rounded w-3/4 mx-auto mb-2" />
        <div className="h-3 bg-gray-100 rounded w-2/3 mx-auto" />
      </div>
    )
  }

  if (notFound || !offer) {
    return fallback ? <>{fallback}</> : null
  }

  const headline = copy?.headline || 'Has llegado al contenido premium'
  const subhead = copy?.subhead || offer.description || 'Desbloquea el curso completo para continuar.'
  const benefits = (copy?.benefits && copy.benefits.length > 0)
    ? copy.benefits
    : (offer.benefits ? offer.benefits.split('\n').filter(Boolean) : [])
  const priceLabel = copy?.price_label || formatPrice(offer.amount, offer.currency)
  const priceSub = copy?.price_sub || 'pago único · acceso de por vida'
  const ctaLabel = copy?.cta_label || 'Desbloquear ahora'
  const secondaryLabel = copy?.secondary_label || 'Volver al curso'

  return (
    <div className="max-w-3xl mx-auto my-10 rounded-2xl border border-indigo-100/70 bg-gradient-to-br from-indigo-50 via-white to-rose-50 shadow-sm overflow-hidden">
      <div className="p-6 md:p-10">
        <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full bg-white/80 text-xs font-semibold text-indigo-700 border border-indigo-100">
          <Lock size={12} /> Capítulo premium
        </div>

        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{headline}</h1>
        <p className="text-gray-600 text-sm md:text-base mb-6 leading-relaxed">{subhead}</p>

        {benefits.length > 0 && (
          <ul className="space-y-2 mb-6">
            {benefits.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                <Check size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <div className="flex items-end gap-2 mb-1">
            <span className="text-3xl md:text-4xl font-extrabold text-gray-900">{priceLabel}</span>
            <span className="text-xs text-gray-500 pb-1">{priceSub}</span>
          </div>
          {copy?.urgency && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-100">
              <Sparkles size={12} /> {copy.urgency}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {accessToken ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition disabled:opacity-60"
            >
              {checkoutLoading ? 'Abriendo checkout…' : (<>{ctaLabel} <ArrowRight size={16} /></>)}
            </button>
          ) : (
            <Link
              href={getUriWithOrg(orgslug, `/login?next=${encodeURIComponent(redirectBackPath || `/course/${courseUuid}`)}`)}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition"
            >
              Inicia sesión para desbloquear <ArrowRight size={16} />
            </Link>
          )}
          <Link
            href={getUriWithOrg(orgslug, `/course/${courseUuid}`)}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
          >
            {secondaryLabel}
          </Link>
        </div>

        {copy?.guarantee && (
          <div className="mt-5 flex items-start gap-2 text-xs text-gray-500">
            <ShieldCheck size={14} className="text-emerald-500 mt-0.5" />
            <span>{copy.guarantee}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default PaywallGate
