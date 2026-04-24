'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import 'github-markdown-css/github-markdown-light.css'

interface LandingConfig {
  hero_markdown?: string
  benefits?: string[]
  cta_label?: string
  preview_image?: string
}

interface LandingHeroProps {
  config: LandingConfig
  orgslug: string
  courseuuid: string
  isAuthenticated: boolean
  firstChapterHref?: string | null
}

const LandingHero: React.FC<LandingHeroProps> = ({
  config,
  orgslug,
  courseuuid,
  isAuthenticated,
  firstChapterHref,
}) => {
  const router = useRouter()
  const [email, setEmail] = useState('')

  const heroMd = config?.hero_markdown
  const benefits = config?.benefits || []
  const ctaLabel = config?.cta_label || 'Empezar gratis'

  if (!heroMd && benefits.length === 0) return null

  const signupHref = (() => {
    const next = firstChapterHref || getUriWithOrg(orgslug, `/course/${courseuuid}`)
    const base = getUriWithOrg(orgslug, `/signup?next=${encodeURIComponent(next)}&course_uuid=${courseuuid}`)
    return email ? `${base}&email=${encodeURIComponent(email)}` : base
  })()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(signupHref)
  }

  // Authenticated users see a shorter hero (no email capture, just a "continue" CTA)
  if (isAuthenticated) {
    return (
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-rose-50 border border-indigo-100/60 p-6 md:p-8 shadow-sm">
        <div className="max-w-3xl markdown-body" style={{ backgroundColor: 'transparent' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{heroMd || ''}</ReactMarkdown>
        </div>
        {firstChapterHref && (
          <div className="mt-4">
            <button
              onClick={() => router.push(firstChapterHref)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition"
            >
              Continuar curso <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // Anonymous users: full hero with email capture
  return (
    <div className="mb-8 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-rose-50 border border-indigo-100/60 p-6 md:p-10 shadow-sm">
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full bg-white/80 text-xs font-semibold text-indigo-700 border border-indigo-100">
            <Sparkles size={12} /> 2 capítulos gratis · empieza ahora
          </div>
          <div className="max-w-2xl markdown-body" style={{ backgroundColor: 'transparent' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{heroMd || ''}</ReactMarkdown>
          </div>

          {benefits.length > 0 && (
            <ul className="mt-5 space-y-2">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col sm:flex-row gap-2 max-w-md">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="flex-1 h-11 px-4 rounded-full bg-white border border-gray-200 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition"
            >
              {ctaLabel} <ArrowRight size={16} />
            </button>
          </form>
          <p className="mt-2 text-xs text-gray-500">Sin spam. Solo para crear tu cuenta y guardar tu progreso.</p>
        </div>
      </div>
    </div>
  )
}

export default LandingHero
