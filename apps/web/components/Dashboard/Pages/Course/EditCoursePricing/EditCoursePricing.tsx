'use client'
import React, { useEffect, useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  getZarinPalStatus,
  setCourseZarinPalPrice,
} from '@services/payments/providers/zarinpal'
import {
  getIranKishStatus,
  setCourseIranKishPrice,
} from '@services/payments/providers/irankish'
import { useTranslation } from 'react-i18next'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { formatCurrency, formatNumber } from '@/lib/format'
import { FloppyDisk } from '@phosphor-icons/react'
import { Banknote, Info } from 'lucide-react'

type SetPriceFn = (
  _orgId: number,
  _courseId: number,
  _priceIrr: number | null,
  _access_token: string
) => Promise<any>

type StatusFn = (_access_token?: string) => Promise<any>

interface GatewayPricingProps {
  // Translation key suffix + i18n label for this gateway.
  gatewayKey: 'zarinpal' | 'irankish'
  label: string
  // Key the backend stores the IRR price under, inside course.extra_metadata.
  metadataKey: string
  getStatus: StatusFn
  setPrice: SetPriceFn
}

/**
 * One self-contained price control for a single payment gateway: probes whether
 * the gateway is configured, seeds from the course's current price, and saves
 * (or clears, with an empty input) directly via the provider's service.
 */
const GatewayPricing: React.FC<GatewayPricingProps> = ({
  gatewayKey,
  label,
  metadataKey,
  getStatus,
  setPrice: setPriceService,
}) => {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const course = useCourse() as any
  const courseStructure = course?.courseStructure
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    getStatus(access_token)
      .then((res: any) => {
        // getResponseMetadata wraps the parsed body under `data`, so the
        // {enabled} payload lives at res.data.enabled (not res.enabled).
        if (active) setEnabled(Boolean(res?.data?.enabled ?? res?.enabled))
      })
      .catch(() => {
        if (active) setEnabled(false)
      })
    return () => {
      active = false
    }
  }, [access_token, getStatus])

  useEffect(() => {
    const current = courseStructure?.extra_metadata?.[metadataKey]
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrice(current != null ? String(current) : '')
  }, [courseStructure, metadataKey])

  // `price` is stored as a raw digit string; parse it for validation/saving.
  const parsed = price.trim() === '' ? null : Number(price.trim())
  const priceInvalid = parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)

  // Show the amount with thousands separators while typing (e.g. 500,000),
  // but keep only digits in state.
  const displayValue =
    parsed !== null && Number.isFinite(parsed)
      ? formatNumber(parsed, i18n.language)
      : price

  const onPriceChange = (raw: string) => {
    // Keep digits only; drop separators, spaces, and any other characters so
    // state is always a clean integer string.
    setPrice(raw.replace(/\D/g, ''))
  }

  const inputId = `${gatewayKey}-price`

  const save = async () => {
    if (priceInvalid) {
      toast.error(t('dashboard.courses.pricing.price_invalid'))
      return
    }
    setSaving(true)
    const tid = toast.loading(t('dashboard.courses.pricing.saving'))
    try {
      await setPriceService(org.id, Number(courseStructure.id), parsed, access_token)
      await revalidateTags(['courses'], org.slug)
      queryClient.invalidateQueries({
        queryKey: queryKeys.courses.meta(courseStructure.course_uuid),
      })
      toast.success(
        parsed === null
          ? t('dashboard.courses.pricing.cleared')
          : t('dashboard.courses.pricing.saved'),
        { id: tid }
      )
    } catch (e: any) {
      toast.error(e?.message || t('dashboard.courses.pricing.error'), { id: tid })
    } finally {
      setSaving(false)
    }
  }

  const preview =
    parsed !== null && !priceInvalid
      ? formatCurrency(parsed, 'IRR', i18n.language)
      : null

  return (
    <div className="bg-white rounded-xl nice-shadow">
      <div className="flex items-center justify-between bg-gray-50 px-5 py-3 m-3 rounded-md">
        <div className="flex items-center gap-2">
          <Banknote className="w-5 h-5 text-gray-600" />
          <h3 className="font-bold text-lg text-gray-800">{label}</h3>
          {enabled === true && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              {t('dashboard.courses.pricing.configured')}
            </span>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving || enabled === false}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white nice-shadow hover:bg-neutral-800 transition-colors disabled:opacity-40"
        >
          <FloppyDisk size={16} weight="bold" />
          <span>{t('dashboard.courses.pricing.save')}</span>
        </button>
      </div>

      <div className="p-4 pt-1 space-y-4 max-w-xl">
        {enabled === false && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Info className="w-5 h-5 text-amber-800 shrink-0" />
              <h4 className="text-amber-800 font-semibold">
                {t('dashboard.courses.pricing.not_configured_title', { gateway: label })}
              </h4>
            </div>
            <p className="text-amber-700 text-sm mt-1">
              {t(`dashboard.courses.pricing.not_configured_description_${gatewayKey}`)}
            </p>
          </div>
        )}

        <div>
          <Label htmlFor={inputId} className="flex items-center gap-2">
            {t('dashboard.courses.pricing.price_label')}
          </Label>
          <Input
            id={inputId}
            type="text"
            inputMode="numeric"
            value={displayValue}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder={t('dashboard.courses.pricing.price_placeholder')}
            aria-invalid={priceInvalid}
            disabled={enabled === false}
          />
          <p className={`text-xs mt-1 ${priceInvalid ? 'text-red-600' : 'text-gray-500'}`}>
            {priceInvalid
              ? t('dashboard.courses.pricing.price_invalid')
              : t('dashboard.courses.pricing.price_help')}
          </p>
          {preview && (
            <p className="text-sm text-gray-700 mt-2">
              {t('dashboard.courses.pricing.price_preview', { price: preview })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const EditCoursePricing: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div className="sm:mx-10 mx-0 space-y-4">
      <div className="px-1">
        <h1 className="font-bold text-xl text-gray-800">
          {t('dashboard.courses.pricing.title')}
        </h1>
        <h2 className="text-gray-500 text-md">
          {t('dashboard.courses.pricing.subtitle')}
        </h2>
      </div>

      <GatewayPricing
        gatewayKey="zarinpal"
        label={t('dashboard.courses.pricing.gateways.zarinpal')}
        metadataKey="zarinpal_price_irr"
        getStatus={getZarinPalStatus}
        setPrice={setCourseZarinPalPrice}
      />

      <GatewayPricing
        gatewayKey="irankish"
        label={t('dashboard.courses.pricing.gateways.irankish')}
        metadataKey="irankish_price_irr"
        getStatus={getIranKishStatus}
        setPrice={setCourseIranKishPrice}
      />
    </div>
  )
}

export default EditCoursePricing
