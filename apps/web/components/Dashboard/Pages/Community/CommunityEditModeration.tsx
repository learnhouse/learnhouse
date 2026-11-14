'use client'
import React, { useRef, useState } from 'react'
import {
  CalendarX,
  ChatCenteredText,
  EnvelopeSimple,
  Gauge,
  Info,
  LinkSimple,
  LockSimple,
  MonitorPlay,
  Plus,
  Prohibit,
  Ruler,
  ShieldCheck,
  Smiley,
  Timer,
  Trash,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { CommunityModerationSettings } from '@services/communities/communities'
import { Switch } from '@components/ui/switch'
import {
  Button,
  FieldLabel,
  INPUT,
  SectionCard,
  SettingRow,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'

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
  allow_rich_content: false,
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
    allow_rich_content: stored?.allow_rich_content ?? DEFAULT_SETTINGS.allow_rich_content,
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
    a.auto_lock_days === b.auto_lock_days &&
    a.allow_rich_content === b.allow_rich_content
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

type ToggleKey = 'block_links' | 'require_email_verified' | 'disable_reactions' | 'allow_rich_content'

export type ModerationDraft = { words: string[]; settings: Settings }

export function moderationDraftOf(community: { moderation_words?: string[] | null; moderation_settings?: CommunityModerationSettings | null }): ModerationDraft {
  return { words: community.moderation_words || [], settings: normalizeSettings(community.moderation_settings) }
}

export function moderationDraftEqual(a: ModerationDraft, b: ModerationDraft) {
  return (
    a.words.length === b.words.length &&
    a.words.every((w, i) => w === b.words[i]) &&
    settingsEqual(a.settings, b.settings)
  )
}

// The moderation part of the community settings page, controlled by the
// page so it saves together with the rest (one save action).
export function ModerationSections({
  value,
  onChange,
  part = 'all',
}: {
  value: ModerationDraft
  onChange: (_next: ModerationDraft) => void
  // 'rules': restrictions, limits and requirements; 'words': the blocked
  // words list. Lets the settings page put them under separate sub-tabs.
  part?: 'all' | 'rules' | 'words'
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const batchInputRef = useRef<HTMLTextAreaElement>(null)
  const [newWord, setNewWord] = useState('')
  const [batchWords, setBatchWords] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { words, settings } = value
  const setWords = (next: string[]) => onChange({ ...value, words: next })

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
    onChange({ ...value, settings: { ...settings, [key]: parsed } })
  }

  const setToggle = (key: ToggleKey) => (checked: boolean) => {
    onChange({ ...value, settings: { ...settings, [key]: checked } })
  }

  return (
    <>
      {part !== 'words' && (
        <>
          <div className="flex gap-3 rounded-2xl bg-white nice-shadow px-5 py-4">
            <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Info size={18} />
            </span>
            <div className="text-sm min-w-0">
              <p className="font-semibold text-neutral-900">{t('dashboard.courses.communities.moderation.info_title')}</p>
              <p className="text-neutral-500 mt-0.5">{t('dashboard.courses.communities.moderation.info_description')}</p>
            </div>
          </div>

          <SectionCard
            icon={<ShieldCheck size={18} />}
            title={t('dashboard.courses.communities.moderation.restrictions_title')}
            description={t('communities.dash.moderation.restrictions_description')}
          >
            <div className="divide-y divide-neutral-100">
              <SettingRow
                icon={<LinkSimple size={16} />}
                title={t('dashboard.courses.communities.moderation.block_links_label')}
                description={t('dashboard.courses.communities.moderation.block_links_description')}
                control={<Switch checked={settings.block_links} onCheckedChange={setToggle('block_links')} />}
              />
              <SettingRow
                icon={<Smiley size={16} />}
                title={t('dashboard.courses.communities.moderation.disable_reactions_label')}
                description={t('dashboard.courses.communities.moderation.disable_reactions_description')}
                control={<Switch checked={settings.disable_reactions} onCheckedChange={setToggle('disable_reactions')} />}
              />
              <SettingRow
                icon={<MonitorPlay size={16} />}
                title={t('dashboard.courses.communities.moderation.allow_rich_content_label')}
                description={t('dashboard.courses.communities.moderation.allow_rich_content_description')}
                control={<Switch checked={settings.allow_rich_content} onCheckedChange={setToggle('allow_rich_content')} />}
              />
            </div>
          </SectionCard>

          <SectionCard
            icon={<Ruler size={18} />}
            title={t('dashboard.courses.communities.moderation.length_title')}
            description={t('communities.dash.moderation.length_description')}
          >
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
          </SectionCard>

          <SectionCard
            icon={<Gauge size={18} />}
            title={t('dashboard.courses.communities.moderation.rate_limits_title')}
            description={t('communities.dash.moderation.rate_limits_description')}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <NumberField
                icon={<Timer size={14} />}
                label={t('dashboard.courses.communities.moderation.slow_mode_label')}
                value={settings.slow_mode_seconds}
                onChange={setNumber('slow_mode_seconds')}
                hint={t('dashboard.courses.communities.moderation.slow_mode_hint')}
              />
              <NumberField
                icon={<ChatCenteredText size={14} />}
                label={t('dashboard.courses.communities.moderation.max_posts_per_day_label')}
                value={settings.max_posts_per_day}
                onChange={setNumber('max_posts_per_day')}
                hint={t('dashboard.courses.communities.moderation.zero_disables')}
              />
              <NumberField
                icon={<CalendarX size={14} />}
                label={t('dashboard.courses.communities.moderation.auto_lock_days_label')}
                value={settings.auto_lock_days}
                onChange={setNumber('auto_lock_days')}
                hint={t('dashboard.courses.communities.moderation.auto_lock_days_hint')}
              />
            </div>
          </SectionCard>

          <SectionCard
            icon={<LockSimple size={18} />}
            title={t('dashboard.courses.communities.moderation.account_requirements_title')}
            description={t('communities.dash.moderation.account_description')}
          >
            <div className="flex flex-col gap-5">
              <div className="max-w-xs">
                <NumberField
                  label={t('dashboard.courses.communities.moderation.min_account_age_label')}
                  value={settings.min_account_age_days}
                  onChange={setNumber('min_account_age_days')}
                  hint={t('dashboard.courses.communities.moderation.min_account_age_hint')}
                />
              </div>
              <SettingRow
                icon={<EnvelopeSimple size={16} />}
                title={t('dashboard.courses.communities.moderation.require_email_verified_label')}
                description={t('dashboard.courses.communities.moderation.require_email_verified_description')}
                control={<Switch checked={settings.require_email_verified} onCheckedChange={setToggle('require_email_verified')} />}
              />
            </div>
          </SectionCard>
        </>
      )}

      {part !== 'rules' && (
        <SectionCard
          icon={<Prohibit size={18} />}
          title={t('dashboard.courses.communities.moderation.blocked_words_section_title')}
          description={t('communities.dash.moderation.blocked_words_description')}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col gap-5">
              <div>
                <FieldLabel>{t('dashboard.courses.communities.moderation.add_word_label')}</FieldLabel>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newWord}
                    aria-label={t('dashboard.courses.communities.moderation.add_word_label')}
                    onChange={(e) => {
                      setNewWord(e.target.value)
                      setError(null)
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={t('dashboard.courses.communities.moderation.add_word_placeholder')}
                    className={`${INPUT} flex-1`}
                  />
                  <Button size="lg" icon={<Plus size={14} />} onClick={handleAddWord} disabled={!newWord.trim()}>
                    {t('dashboard.courses.communities.moderation.add_button')}
                  </Button>
                </div>
              </div>

              <div>
                <FieldLabel>{t('dashboard.courses.communities.moderation.batch_add_label')}</FieldLabel>
                <textarea
                  ref={batchInputRef}
                  value={batchWords}
                  rows={4}
                  aria-label={t('dashboard.courses.communities.moderation.batch_add_label')}
                  onChange={(e) => {
                    setBatchWords(e.target.value)
                    setError(null)
                  }}
                  placeholder={t('dashboard.courses.communities.moderation.batch_add_placeholder')}
                  className={TEXTAREA}
                />
                <p className="mt-1.5 text-xs text-neutral-400">{t('dashboard.courses.communities.moderation.batch_add_description')}</p>
                <Button size="sm" className="mt-2" icon={<Plus size={13} />} onClick={handleBatchAdd} disabled={!batchWords.trim()}>
                  {t('dashboard.courses.communities.moderation.add_all_button')}
                </Button>
              </div>

              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            </div>

            <div>
              <FieldLabel hint={<span className="tabular-nums">{words.length}</span>}>
                {t('dashboard.courses.communities.moderation.blocked_words_label')}
              </FieldLabel>
              {words.length === 0 ? (
                <div className="py-10 px-4 text-center rounded-xl ring-1 ring-inset ring-neutral-100 bg-neutral-50/50">
                  <Prohibit size={28} className="mx-auto text-neutral-300 mb-2" />
                  <p className="text-sm font-medium text-neutral-600">{t('dashboard.courses.communities.moderation.no_blocked_words')}</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    {t('dashboard.courses.communities.moderation.no_blocked_words_description')}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-[320px] overflow-y-auto rounded-xl ring-1 ring-inset ring-neutral-100 p-3">
                  {words.map((word) => (
                    <span
                      key={word}
                      className="inline-flex items-center gap-1 h-7 ps-2.5 pe-1 rounded-lg bg-neutral-100 text-xs font-mono text-neutral-700"
                    >
                      {word}
                      <button
                        type="button"
                        onClick={() => handleRemoveWord(word)}
                        aria-label={t('communities.dash.moderation.remove_word', { word })}
                        className="w-5 h-5 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      )}
    </>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange: (_e: React.ChangeEvent<HTMLInputElement>) => void
  hint?: string
  icon?: React.ReactNode
}

function NumberField({ label, value, onChange, hint, icon }: NumberFieldProps) {
  return (
    <div>
      <FieldLabel>
        <span className="inline-flex items-center gap-1.5">
          {icon && <span className="text-neutral-400">{icon}</span>}
          {label}
        </span>
      </FieldLabel>
      <input
        type="number"
        min={0}
        value={value || ''}
        onChange={onChange}
        placeholder="0"
        aria-label={label}
        className={`${INPUT} tabular-nums`}
      />
      {hint && <p className="mt-1.5 text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}
