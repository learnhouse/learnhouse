'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { LinkSimple, Plus, X } from '@phosphor-icons/react'
import { SiFacebook, SiInstagram, SiX, SiYoutube } from '@icons-pack/react-simple-icons'
import { Button, FieldLabel, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'

export interface OrgSocials {
  twitter?: string
  facebook?: string
  instagram?: string
  linkedin?: string
  youtube?: string
}

const SOCIALS: { key: keyof OrgSocials; Icon: React.ElementType; color: string }[] = [
  { key: 'twitter', Icon: SiX, color: '#111111' },
  { key: 'facebook', Icon: SiFacebook, color: '#1877F2' },
  { key: 'instagram', Icon: SiInstagram, color: '#E4405F' },
  { key: 'youtube', Icon: SiYoutube, color: '#FF0000' },
]

export const MAX_CUSTOM_LINKS = 3

/**
 * Social profiles and up to three custom footer links. Controlled: the
 * General tab owns the values and saves them with the rest of the profile.
 */
export default function OrgEditSocials({
  socials,
  links,
  onChange,
  disabled,
}: {
  socials: OrgSocials
  links: Record<string, string>
  onChange: (_next: { socials?: OrgSocials; links?: Record<string, string> }) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const entries = Object.entries(links ?? {})

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <FieldLabel>{t('dashboard.organization.socials.labels.social_links')}</FieldLabel>
        <div className="grid gap-2">
          {SOCIALS.map(({ key, Icon, color }) => (
            <div key={key} className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}14` }}
              >
                <Icon size={15} color={color} />
              </span>
              <input
                id={`socials.${key}`}
                value={socials?.[key] || ''}
                onChange={(e) => onChange({ socials: { ...socials, [key]: e.target.value } })}
                placeholder={t(`dashboard.organization.socials.placeholders.${key}`)}
                disabled={disabled}
                className={INPUT}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel hint={`${entries.length}/${MAX_CUSTOM_LINKS}`}>
          {t('dashboard.organization.socials.labels.custom_links')}
        </FieldLabel>
        <div className="grid gap-2">
          {entries.map(([linkKey, linkValue], index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                <LinkSimple size={15} />
              </span>
              <input
                placeholder={t('dashboard.organization.socials.placeholders.label')}
                value={linkKey}
                disabled={disabled}
                className={`${INPUT} !w-1/3`}
                onChange={(e) => {
                  const next: Record<string, string> = {}
                  // Rebuild in order so renaming a key keeps its position.
                  entries.forEach(([k, v]) => {
                    next[k === linkKey ? e.target.value : k] = v
                  })
                  onChange({ links: next })
                }}
              />
              <input
                placeholder={t('dashboard.organization.socials.placeholders.url')}
                value={linkValue}
                disabled={disabled}
                className={`${INPUT} flex-1`}
                onChange={(e) => onChange({ links: { ...links, [linkKey]: e.target.value } })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.remove', { defaultValue: 'Remove' })}
                title={t('common.remove', { defaultValue: 'Remove' })}
                disabled={disabled}
                onClick={() => {
                  const next = { ...links }
                  delete next[linkKey]
                  onChange({ links: next })
                }}
                icon={<X size={14} />}
              />
            </div>
          ))}

          {entries.length < MAX_CUSTOM_LINKS && (
            <div>
              <Button
                size="sm"
                disabled={disabled}
                icon={<Plus size={13} />}
                onClick={() => {
                  const next = { ...links }
                  next[`Link ${entries.length + 1}`] = ''
                  onChange({ links: next })
                }}
              >
                {t('dashboard.organization.socials.add_link')}
              </Button>
            </div>
          )}
          <p className="text-xs text-neutral-500">{t('dashboard.organization.socials.custom_links_desc')}</p>
        </div>
      </div>
    </div>
  )
}
