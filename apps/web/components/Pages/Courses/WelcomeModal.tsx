'use client'
import React, { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dialog, DialogContent, DialogTitle } from '@components/ui/dialog'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import { getAPIUrl } from '@services/config/config'
import 'github-markdown-css/github-markdown-light.css'

interface WelcomeStep {
  title: string
  body: string
}

interface WelcomeConfig {
  markdown?: string
  steps?: WelcomeStep[]
}

interface WelcomeModalProps {
  config?: WelcomeConfig
  courseUuid: string
  user: any
  accessToken?: string
  onFinished?: () => void
}

const LOCAL_SKIP_KEY = (courseUuid: string, userId: number | string) =>
  `lh_welcome_skipped_${courseUuid}_${userId}`

const WelcomeModal: React.FC<WelcomeModalProps> = ({
  config,
  courseUuid,
  user,
  accessToken,
  onFinished,
}) => {
  const [open, setOpen] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [saving, setSaving] = useState(false)

  const steps = useMemo(() => config?.steps || [], [config])
  const hasMarkdown = !!config?.markdown
  const totalSlides = (hasMarkdown ? 1 : 0) + steps.length

  useEffect(() => {
    if (!config || (!hasMarkdown && steps.length === 0)) return
    if (!user?.id) return
    const alreadyOnboarded = user?.details?.onboarded === true
    if (alreadyOnboarded) return
    const skipKey = LOCAL_SKIP_KEY(courseUuid, user.id)
    if (typeof window !== 'undefined' && window.localStorage?.getItem(skipKey)) return
    setOpen(true)
  }, [config, hasMarkdown, steps.length, user?.id, user?.details?.onboarded, courseUuid])

  const markOnboarded = async () => {
    if (!user?.id || !accessToken) return
    setSaving(true)
    try {
      const currentDetails = (user?.details && typeof user.details === 'object') ? user.details : {}
      const newDetails = { ...currentDetails, onboarded: true, onboarded_course_uuid: courseUuid }
      const body = {
        username: user.username,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email,
        avatar_image: user.avatar_image || '',
        bio: user.bio || '',
        details: newDetails,
        profile: user.profile || {},
      }
      await fetch(`${getAPIUrl()}users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      })
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem(LOCAL_SKIP_KEY(courseUuid, user.id), '1')
      }
    } catch {
      // fail silently — the local skip key below still prevents a loop
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem(LOCAL_SKIP_KEY(courseUuid, user.id), '1')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleClose = async () => {
    await markOnboarded()
    setOpen(false)
    onFinished?.()
  }

  const handleNext = () => {
    if (stepIdx < totalSlides - 1) {
      setStepIdx(stepIdx + 1)
    } else {
      handleClose()
    }
  }

  if (!config || (!hasMarkdown && steps.length === 0)) return null

  const onIntro = hasMarkdown && stepIdx === 0
  const currentStep = hasMarkdown ? steps[stepIdx - 1] : steps[stepIdx]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="flex flex-col w-[95vw] max-w-[95vw] sm:max-w-lg bg-white border border-gray-200 shadow-xl p-0 overflow-hidden rounded-2xl">
        <DialogTitle className="sr-only">Bienvenida al curso</DialogTitle>
        <div className="bg-gradient-to-br from-indigo-50 via-white to-rose-50 p-6 md:p-8">
          <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full bg-white/80 text-xs font-semibold text-indigo-700 border border-indigo-100">
            <Sparkles size={12} /> Paso {stepIdx + 1} de {totalSlides}
          </div>

          {onIntro ? (
            <div className="markdown-body max-w-none" style={{ backgroundColor: 'transparent' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {config.markdown || ''}
              </ReactMarkdown>
            </div>
          ) : currentStep ? (
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{currentStep.title}</h2>
              <p className="text-gray-700 text-sm leading-relaxed">{currentStep.body}</p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-6 py-4 bg-white border-t border-gray-100">
          <div className="flex gap-1.5">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === stepIdx ? 'w-6 bg-black' : 'w-1.5 bg-gray-200'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {stepIdx < totalSlides - 1 ? (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-xs text-gray-500 hover:text-gray-900 px-2"
                  disabled={saving}
                >
                  Saltar
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition"
                >
                  Siguiente <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-black text-white text-sm font-semibold hover:bg-gray-800 transition disabled:opacity-60"
              >
                {saving ? 'Guardando…' : (<>Empezar <Check size={14} /></>)}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default WelcomeModal
