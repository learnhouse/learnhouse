'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { BookOpenText, Plus, X } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getTranslationGlossary,
  localeName,
  updateTranslationGlossary,
  type Glossary,
} from '@services/courses/translations'
import { Button, INPUT, SectionCard, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { useAccessToken } from './useCourseLanguages'

const EMPTY: Glossary = { do_not_translate: [], terms: [], notes: '' }

/**
 * Optional glossary used by Atlas when translating: words to keep as they
 * are (brand names, code) and fixed translations of course terms.
 */
export function GlossaryEditor({ courseUuid, locales }: { courseUuid: string; locales: string[] }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const key = ['courseI18n', 'glossary', courseUuid]
  const { data, isLoading, error } = useQuery<Glossary>({
    queryKey: key,
    queryFn: () => getTranslationGlossary(courseUuid, token),
    enabled: !!token,
    retry: false,
  })
  const [draft, setDraft] = useState<Glossary>(EMPTY)
  const [newTerm, setNewTerm] = useState('')
  const [saving, setSaving] = useState(false)
  const [seen, setSeen] = useState<Glossary | undefined>(undefined)
  if (data && data !== seen) {
    setSeen(data)
    setDraft({ ...EMPTY, ...data, terms: data.terms || [], do_not_translate: data.do_not_translate || [] })
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify({ ...EMPTY, ...(data || {}) })
  const display = i18n.language || 'en'

  const save = async () => {
    setSaving(true)
    try {
      const cleaned: Glossary = {
        do_not_translate: draft.do_not_translate.map((s) => s.trim()).filter(Boolean),
        terms: draft.terms
          .filter((term) => term.source.trim())
          .map((term) => ({
            source: term.source.trim(),
            translations: Object.fromEntries(Object.entries(term.translations).filter(([, v]) => v.trim())),
          })),
        notes: draft.notes,
      }
      const saved = await updateTranslationGlossary(courseUuid, cleaned, token)
      queryClient.setQueryData(key, saved)
      toast.success(t('dashboard.courses.languages.glossary.saved', 'Glossary saved'))
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.languages.toasts.error', 'Something went wrong'))
    } finally {
      setSaving(false)
    }
  }

  const addKeep = () => {
    const v = newTerm.trim()
    if (!v || draft.do_not_translate.includes(v)) return setNewTerm('')
    setDraft({ ...draft, do_not_translate: [...draft.do_not_translate, v] })
    setNewTerm('')
  }

  return (
    <SectionCard
      icon={<BookOpenText size={18} />}
      title={t('dashboard.courses.languages.glossary.title', 'Glossary')}
      description={t(
        'dashboard.courses.languages.glossary.description',
        'Optional. Atlas keeps these words as they are and uses your translations of course terms.',
      )}
      actions={
        <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={save} data-testid="glossary-save">
          {t('dashboard.courses.languages.glossary.save', 'Save glossary')}
        </Button>
      }
    >
      {isLoading ? (
        <div className="h-20 rounded-xl bg-neutral-50 animate-pulse" />
      ) : error ? (
        <p className="text-sm text-neutral-400">{t('dashboard.courses.languages.glossary.unavailable', 'The glossary is not available yet.')}</p>
      ) : (
        <div className="space-y-6">
          <div>
            <div className="text-sm font-semibold text-neutral-800 mb-1.5">
              {t('dashboard.courses.languages.glossary.keep', 'Never translate')}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.do_not_translate.map((word) => (
                <span key={word} className="inline-flex items-center gap-1 h-7 ps-2.5 pe-1 rounded-full bg-neutral-100 text-xs font-medium text-neutral-700">
                  {word}
                  <button
                    type="button"
                    aria-label={t('dashboard.courses.languages.glossary.remove_word', { word, defaultValue: 'Remove {{word}}' })}
                    onClick={() => setDraft({ ...draft, do_not_translate: draft.do_not_translate.filter((w) => w !== word) })}
                    className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-neutral-200"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addKeep()
                  }
                }}
                onBlur={addKeep}
                placeholder={t('dashboard.courses.languages.glossary.keep_placeholder', 'Add a word, press Enter')}
                className="h-7 min-w-40 px-2.5 text-xs rounded-full bg-white ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                data-testid="glossary-keep-input"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-sm font-semibold text-neutral-800">
                {t('dashboard.courses.languages.glossary.terms', 'Term translations')}
              </span>
              <Button
                size="sm"
                icon={<Plus size={12} />}
                onClick={() => setDraft({ ...draft, terms: [...draft.terms, { source: '', translations: {} }] })}
              >
                {t('dashboard.courses.languages.glossary.add_term', 'Add term')}
              </Button>
            </div>
            {draft.terms.length === 0 ? (
              <p className="text-xs text-neutral-400">
                {t('dashboard.courses.languages.glossary.no_terms', 'No terms yet. Add one to fix how a word is translated.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="text-start font-medium pb-1.5 pe-2">{t('dashboard.courses.languages.glossary.source_term', 'Source term')}</th>
                      {locales.map((l) => (
                        <th key={l} className="text-start font-medium pb-1.5 pe-2">
                          {localeName(l, display)}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.terms.map((term, i) => (
                      <tr key={i}>
                        <td className="pe-2 pb-2 min-w-36">
                          <input
                            className={INPUT}
                            value={term.source}
                            onChange={(e) => {
                              const terms = [...draft.terms]
                              terms[i] = { ...term, source: e.target.value }
                              setDraft({ ...draft, terms })
                            }}
                          />
                        </td>
                        {locales.map((l) => (
                          <td key={l} className="pe-2 pb-2 min-w-36">
                            <input
                              className={INPUT}
                              lang={l}
                              value={term.translations[l] || ''}
                              onChange={(e) => {
                                const terms = [...draft.terms]
                                terms[i] = { ...term, translations: { ...term.translations, [l]: e.target.value } }
                                setDraft({ ...draft, terms })
                              }}
                            />
                          </td>
                        ))}
                        <td className="pb-2">
                          <button
                            type="button"
                            aria-label={t('dashboard.courses.languages.glossary.remove_term', 'Remove term')}
                            onClick={() => setDraft({ ...draft, terms: draft.terms.filter((_, j) => j !== i) })}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-semibold text-neutral-800 mb-1.5">
              {t('dashboard.courses.languages.glossary.notes', 'Notes for the translator')}
            </div>
            <textarea
              rows={2}
              className={TEXTAREA}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder={t('dashboard.courses.languages.glossary.notes_placeholder', 'Tone, audience, words to avoid…')}
            />
          </div>
        </div>
      )}
    </SectionCard>
  )
}
