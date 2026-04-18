'use client'
import React, { useState, useEffect, useRef } from 'react'
import {
  Plus,
  Trash2,
  Shield,
  AlertTriangle,
  Loader2,
  Link2,
  Ruler,
  MessageSquare,
  Timer,
  Gauge,
  CalendarClock,
  MailCheck,
  Lock,
  SmilePlus,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import {
  updateCommunity,
  CommunityModerationSettings,
} from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import toast from 'react-hot-toast'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'

type Settings = Required<CommunityModerationSettings>

const DEFAULT_SETTINGS: Settings = {
  block_links: false,
  min_post_length: 0,
  max_post_length: 0,
  max_comment_length: 0,
  slow_mode_seconds: 0,
  max_posts_per_day: 0,
  min_account_age_days: 0,
  require_email_verified: false,
  disable_reactions: false,
  auto_lock_days: 0,
}

function normalizeSettings(stored: CommunityModerationSettings | null | undefined): Settings {
  return {
    block_links: stored?.block_links ?? DEFAULT_SETTINGS.block_links,
    min_post_length: stored?.min_post_length ?? DEFAULT_SETTINGS.min_post_length,
    max_post_length: stored?.max_post_length ?? DEFAULT_SETTINGS.max_post_length,
    max_comment_length: stored?.max_comment_length ?? DEFAULT_SETTINGS.max_comment_length,
    slow_mode_seconds: stored?.slow_mode_seconds ?? DEFAULT_SETTINGS.slow_mode_seconds,
    max_posts_per_day: stored?.max_posts_per_day ?? DEFAULT_SETTINGS.max_posts_per_day,
    min_account_age_days: stored?.min_account_age_days ?? DEFAULT_SETTINGS.min_account_age_days,
    require_email_verified:
      stored?.require_email_verified ?? DEFAULT_SETTINGS.require_email_verified,
    disable_reactions: stored?.disable_reactions ?? DEFAULT_SETTINGS.disable_reactions,
    auto_lock_days: stored?.auto_lock_days ?? DEFAULT_SETTINGS.auto_lock_days,
  }
}

function settingsEqual(a: Settings, b: Settings) {
  return (
    a.block_links === b.block_links &&
    a.min_post_length === b.min_post_length &&
    a.max_post_length === b.max_post_length &&
    a.max_comment_length === b.max_comment_length &&
    a.slow_mode_seconds === b.slow_mode_seconds &&
    a.max_posts_per_day === b.max_posts_per_day &&
    a.min_account_age_days === b.min_account_age_days &&
    a.require_email_verified === b.require_email_verified &&
    a.disable_reactions === b.disable_reactions &&
    a.auto_lock_days === b.auto_lock_days
  )
}

type NumericKey =
  | 'min_post_length'
  | 'max_post_length'
  | 'max_comment_length'
  | 'slow_mode_seconds'
  | 'max_posts_per_day'
  | 'min_account_age_days'
  | 'auto_lock_days'

type ToggleKey = 'block_links' | 'require_email_verified' | 'disable_reactions'

const CommunityEditModeration: React.FC = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const communityState = useCommunity()
  const dispatch = useCommunityDispatch()
  const community = communityState?.community
  const accessToken = session?.data?.tokens?.access_token
  const inputRef = useRef<HTMLInputElement>(null)
  const batchInputRef = useRef<HTMLTextAreaElement>(null)

  const [words, setWords] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [newWord, setNewWord] = useState('')
  const [batchWords, setBatchWords] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (community) {
      setWords(community.moderation_words || [])
      setSettings(normalizeSettings(community.moderation_settings))
    }
  }, [community])

  useEffect(() => {
    if (!community) return
    const originalWords = community.moderation_words || []
    const wordsChanged =
      words.length !== originalWords.length || words.some((w, i) => w !== originalWords[i])
    const originalSettings = normalizeSettings(community.moderation_settings)
    setHasChanges(wordsChanged || !settingsEqual(settings, originalSettings))
  }, [words, settings, community])

  if (!community) return null

  const handleAddWord = () => {
    const trimmedWord = newWord.trim().toLowerCase()
    if (!trimmedWord) return
    if (words.includes(trimmedWord)) {
      setError(t('dashboard.courses.communities.moderation.word_exists_error'))
      return
    }
    setWords([...words, trimmedWord])
    setNewWord('')
    setError(null)
    inputRef.current?.focus()
  }

  const handleBatchAdd = () => {
    if (!batchWords.trim()) return
    const newWordsToAdd = batchWords
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0)
      .filter((w) => !words.includes(w))

    if (newWordsToAdd.length === 0) {
      setError(t('dashboard.courses.communities.moderation.all_words_exist_error'))
      return
    }

    setWords([...words, ...Array.from(new Set(newWordsToAdd))])
    setBatchWords('')
    setError(null)
  }

  const handleRemoveWord = (wordToRemove: string) => {
    setWords(words.filter((w) => w !== wordToRemove))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddWord()
    }
  }

  const setNumber = (key: NumericKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const parsed = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0))
    setSettings((prev) => ({ ...prev, [key]: parsed }))
  }

  const setToggle = (key: ToggleKey) => (checked: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: checked }))
  }

  const handleSave = async () => {
    setIsSubmitting(true)
    setError(null)
    const loadingToast = toast.loading(t('dashboard.courses.communities.moderation.toasts.saving'))

    try {
      const payload = {
        moderation_words: words,
        moderation_settings: settings,
      }
      await updateCommunity(community.community_uuid, payload, accessToken)
      await revalidateTags(['communities'], org.slug)
      mutate(`${getAPIUrl()}communities/${community.community_uuid}`)
      if (dispatch) {
        dispatch({
          type: 'setCommunity',
          payload: { ...community, moderation_words: words, moderation_settings: settings },
        })
      }
      toast.success(t('dashboard.courses.communities.moderation.toasts.save_success'), { id: loadingToast })
      router.refresh()
    } catch (err) {
      setError(t('dashboard.courses.communities.moderation.toasts.save_error'))
      toast.error(t('dashboard.courses.communities.moderation.toasts.save_error'), { id: loadingToast })
      console.error('Failed to update moderation settings:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">{t('dashboard.courses.communities.moderation.title')}</h1>
          <h2 className="text-gray-500 text-md">
            {t('dashboard.courses.communities.moderation.subtitle')}
          </h2>
        </div>

        <div className="mx-5 my-5 space-y-6">
          <div className="flex gap-3 p-4 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">{t('dashboard.courses.communities.moderation.info_title')}</p>
              <p className="text-amber-700 mt-0.5">
                {t('dashboard.courses.communities.moderation.info_description')}
              </p>
            </div>
          </div>

          {/* Section: Content restrictions */}
          <Section icon={<Shield size={16} className="text-gray-600" />} title={t('dashboard.courses.communities.moderation.restrictions_title')}>
            <ToggleRow
              icon={<Link2 size={18} className="text-gray-500" />}
              label={t('dashboard.courses.communities.moderation.block_links_label')}
              description={t('dashboard.courses.communities.moderation.block_links_description')}
              checked={settings.block_links}
              onChange={setToggle('block_links')}
            />
            <ToggleRow
              icon={<SmilePlus size={18} className="text-gray-500" />}
              label={t('dashboard.courses.communities.moderation.disable_reactions_label')}
              description={t('dashboard.courses.communities.moderation.disable_reactions_description')}
              checked={settings.disable_reactions}
              onChange={setToggle('disable_reactions')}
            />
          </Section>

          {/* Section: Length limits */}
          <Section icon={<Ruler size={16} className="text-gray-600" />} title={t('dashboard.courses.communities.moderation.length_title')}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <NumberField
                label={t('dashboard.courses.communities.moderation.min_post_length_label')}
                value={settings.min_post_length}
                onChange={setNumber('min_post_length')}
                hint={t('dashboard.courses.communities.moderation.zero_disables')}
              />
              <NumberField
                label={t('dashboard.courses.communities.moderation.max_post_length_label')}
                value={settings.max_post_length}
                onChange={setNumber('max_post_length')}
                hint={t('dashboard.courses.communities.moderation.zero_disables')}
              />
              <NumberField
                label={t('dashboard.courses.communities.moderation.max_comment_length_label')}
                value={settings.max_comment_length}
                onChange={setNumber('max_comment_length')}
                hint={t('dashboard.courses.communities.moderation.zero_disables')}
              />
            </div>
          </Section>

          {/* Section: Rate limits */}
          <Section icon={<Gauge size={16} className="text-gray-600" />} title={t('dashboard.courses.communities.moderation.rate_limits_title')}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <NumberField
                icon={<Timer size={14} className="text-gray-400" />}
                label={t('dashboard.courses.communities.moderation.slow_mode_label')}
                value={settings.slow_mode_seconds}
                onChange={setNumber('slow_mode_seconds')}
                hint={t('dashboard.courses.communities.moderation.slow_mode_hint')}
              />
              <NumberField
                label={t('dashboard.courses.communities.moderation.max_posts_per_day_label')}
                value={settings.max_posts_per_day}
                onChange={setNumber('max_posts_per_day')}
                hint={t('dashboard.courses.communities.moderation.zero_disables')}
              />
              <NumberField
                icon={<CalendarClock size={14} className="text-gray-400" />}
                label={t('dashboard.courses.communities.moderation.auto_lock_days_label')}
                value={settings.auto_lock_days}
                onChange={setNumber('auto_lock_days')}
                hint={t('dashboard.courses.communities.moderation.auto_lock_days_hint')}
              />
            </div>
          </Section>

          {/* Section: Account requirements */}
          <Section icon={<Lock size={16} className="text-gray-600" />} title={t('dashboard.courses.communities.moderation.account_requirements_title')}>
            <div className="space-y-4">
              <NumberField
                label={t('dashboard.courses.communities.moderation.min_account_age_label')}
                value={settings.min_account_age_days}
                onChange={setNumber('min_account_age_days')}
                hint={t('dashboard.courses.communities.moderation.min_account_age_hint')}
              />
              <ToggleRow
                icon={<MailCheck size={18} className="text-gray-500" />}
                label={t('dashboard.courses.communities.moderation.require_email_verified_label')}
                description={t('dashboard.courses.communities.moderation.require_email_verified_description')}
                checked={settings.require_email_verified}
                onChange={setToggle('require_email_verified')}
              />
            </div>
          </Section>

          {/* Section: Blocked words */}
          <Section icon={<MessageSquare size={16} className="text-gray-600" />} title={t('dashboard.courses.communities.moderation.blocked_words_section_title')}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('dashboard.courses.communities.moderation.add_word_label')}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      ref={inputRef}
                      type="text"
                      value={newWord}
                      onChange={(e) => {
                        setNewWord(e.target.value)
                        setError(null)
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={t('dashboard.courses.communities.moderation.add_word_placeholder')}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      onClick={handleAddWord}
                      disabled={!newWord.trim()}
                      className="bg-gray-900 hover:bg-gray-800"
                    >
                      <Plus size={16} className="mr-2" />
                      {t('dashboard.courses.communities.moderation.add_button')}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('dashboard.courses.communities.moderation.batch_add_label')}
                  </Label>
                  <p className="text-xs text-gray-500 mb-2">
                    {t('dashboard.courses.communities.moderation.batch_add_description')}
                  </p>
                  <textarea
                    ref={batchInputRef}
                    value={batchWords}
                    onChange={(e) => {
                      setBatchWords(e.target.value)
                      setError(null)
                    }}
                    placeholder={t('dashboard.courses.communities.moderation.batch_add_placeholder')}
                    className="w-full min-h-[100px] px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                  <Button
                    type="button"
                    onClick={handleBatchAdd}
                    disabled={!batchWords.trim()}
                    className="mt-2 bg-gray-900 hover:bg-gray-800"
                  >
                    <Plus size={16} className="mr-2" />
                    {t('dashboard.courses.communities.moderation.add_all_button')}
                  </Button>
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}
              </div>

              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('dashboard.courses.communities.moderation.blocked_words_label')} ({words.length})
                </Label>
                {words.length === 0 ? (
                  <div className="py-12 text-center border border-dashed border-gray-200 rounded-lg">
                    <Shield size={32} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">{t('dashboard.courses.communities.moderation.no_blocked_words')}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {t('dashboard.courses.communities.moderation.no_blocked_words_description')}
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {words.map((word, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 group"
                      >
                        <span className="text-sm text-gray-700 font-mono">{word}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveWord(word)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={isSubmitting || !hasChanges}
              className="bg-black text-white hover:bg-black/90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  {t('common.saving')}
                </>
              ) : (
                t('common.save_changes')
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SectionProps {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}

function Section({ icon, title, children }: SectionProps) {
  return (
    <section className="border border-gray-200 rounded-lg overflow-hidden">
      <header className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b border-gray-200">
        {icon}
        <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
      </header>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  )
}

interface ToggleRowProps {
  icon: React.ReactNode
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({ icon, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <Label className="text-sm font-medium text-gray-800">{label}</Label>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  hint?: string
  icon?: React.ReactNode
}

function NumberField({ label, value, onChange, hint, icon }: NumberFieldProps) {
  return (
    <div>
      <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1">
        {icon}
        {label}
      </Label>
      <Input type="number" min={0} value={value || ''} onChange={onChange} placeholder="0" />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export default CommunityEditModeration
