'use client'
import React from 'react'
import { Form, Formik } from 'formik'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { LinkSimple, Plus, ShareNetwork, X } from '@phosphor-icons/react'
import { SiFacebook, SiInstagram, SiX, SiYoutube } from '@icons-pack/react-simple-icons'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updateOrganization } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { BrandingSection } from './BrandingShared'
import { FooterLinksVignette } from './BrandingVignettes'

interface SocialValues {
  socials: {
    twitter?: string
    facebook?: string
    instagram?: string
    youtube?: string
  }
  links: Record<string, string>
}

const SOCIALS: { key: keyof SocialValues['socials']; Icon: React.ElementType; color: string }[] = [
  { key: 'twitter', Icon: SiX, color: '#111111' },
  { key: 'facebook', Icon: SiFacebook, color: '#1877F2' },
  { key: 'instagram', Icon: SiInstagram, color: '#E4405F' },
  { key: 'youtube', Icon: SiYoutube, color: '#FF0000' },
]

const MAX_LINKS = 3

export default function SocialTab() {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const initialValues: SocialValues = {
    socials: org?.socials || {},
    links: org?.links || {},
  }

  const save = async (values: SocialValues) => {
    const toastId = toast.loading(t('dashboard.organization.settings.updating'))
    try {
      await updateOrganization(org.id, values, accessToken)
      await revalidateTags(['organizations'], org.slug)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(t('dashboard.organization.settings.update_success'), { id: toastId })
      router.refresh()
    } catch (_err) {
      toast.error(t('dashboard.organization.settings.update_error'), { id: toastId })
    }
  }

  return (
    <Formik
      enableReinitialize
      initialValues={initialValues}
      onSubmit={async (values, { setSubmitting }) => {
        await save(values)
        setSubmitting(false)
      }}
    >
      {({ isSubmitting, values, handleChange, setFieldValue, dirty }) => (
        <Form>
          <BrandingSection
            icon={ShareNetwork}
            title={t('dashboard.organization.branding.social.title')}
            description={t('dashboard.organization.branding.social.description')}
            aside={
              <FooterLinksVignette
                socials={values.socials}
                links={values.links}
                name={org?.name}
                label={t('dashboard.organization.branding.vignettes.footer')}
              />
            }
          >
            <div className="grid gap-2.5 max-w-md">
              {SOCIALS.map(({ key, Icon, color }) => (
                <div key={key} className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${color}14` }}
                  >
                    <Icon size={15} color={color} />
                  </span>
                  <Input
                    id={`socials.${key}`}
                    name={`socials.${key}`}
                    value={values.socials[key] || ''}
                    onChange={handleChange}
                    placeholder={t(`dashboard.organization.socials.placeholders.${key}`)}
                    className="h-9 bg-white"
                  />
                </div>
              ))}
            </div>
          </BrandingSection>

          <BrandingSection
            icon={LinkSimple}
            title={t('dashboard.organization.branding.social.links_title')}
            description={t('dashboard.organization.branding.social.links_desc')}
          >
            <div className="space-y-2.5 max-w-xl">
              {Object.entries(values.links).map(([linkKey, linkValue], index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder={t('dashboard.organization.socials.placeholders.label')}
                    value={linkKey}
                    className="h-9 w-1/3 bg-white"
                    onChange={(e) => {
                      const next: Record<string, string> = {}
                      // Rebuild in order so renaming a key keeps its position.
                      Object.entries(values.links).forEach(([k, v]) => {
                        next[k === linkKey ? e.target.value : k] = v
                      })
                      setFieldValue('links', next)
                    }}
                  />
                  <Input
                    placeholder={t('dashboard.organization.socials.placeholders.url')}
                    value={linkValue}
                    className="h-9 flex-1 bg-white"
                    onChange={(e) => setFieldValue('links', { ...values.links, [linkKey]: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('common.remove', { defaultValue: 'Remove' })}
                    onClick={() => {
                      const next = { ...values.links }
                      delete next[linkKey]
                      setFieldValue('links', next)
                    }}
                    className="text-gray-400 hover:text-gray-700"
                  >
                    <X size={14} weight="bold" />
                  </Button>
                </div>
              ))}

              {Object.keys(values.links).length < MAX_LINKS && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg bg-white"
                  onClick={() => {
                    const next = { ...values.links }
                    next[`Link ${Object.keys(next).length + 1}`] = ''
                    setFieldValue('links', next)
                  }}
                >
                  <Plus size={14} weight="bold" className="me-1.5" />
                  {t('dashboard.organization.socials.add_link')}
                </Button>
              )}
            </div>
          </BrandingSection>

          <div className="flex items-center justify-between gap-4 px-5 py-4 bg-gray-50/70 border-t border-gray-100 rounded-b-xl">
            <p className="text-xs text-gray-400">{t('dashboard.organization.socials.custom_links_desc')}</p>
            <Button
              type="submit"
              disabled={isSubmitting || !dirty}
              className="bg-black text-white hover:bg-black/90 rounded-lg"
            >
              {isSubmitting
                ? t('dashboard.organization.settings.saving')
                : t('dashboard.organization.settings.save_changes')}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  )
}
