'use client'
import React, { useEffect, useState } from 'react'
import { Award } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import OrgSquareLogo, { hasOrgLogo } from '@components/Objects/Org/OrgSquareLogo'
import { formatDate } from '@/lib/format'

/** The artwork is laid out once, at A4 landscape in CSS pixels, and scaled to
 * whatever box shows it (see CertificatePreview). Every size below is a real
 * pixel size, which keeps the on-screen certificate, the editor preview and
 * the rasterised PDF identical. */
export const CERTIFICATE_WIDTH = 1123
export const CERTIFICATE_HEIGHT = 794

type Frame = 'single' | 'double' | 'brackets' | 'bar' | 'rounded' | 'hairline'

export interface CertificateStyle {
  accent: string
  frame: Frame
}

/** Stored pattern keys (certificate_pattern) mapped to a restrained style: an
 * accent colour and a frame. The keys are kept so existing certificates keep
 * their look. */
export const CERTIFICATE_STYLES: Record<string, CertificateStyle> = {
  professional: { accent: '#111827', frame: 'double' },
  minimal: { accent: '#111827', frame: 'hairline' },
  modern: { accent: '#2563eb', frame: 'bar' },
  academic: { accent: '#1e3a8a', frame: 'double' },
  royal: { accent: '#a16207', frame: 'double' },
  vintage: { accent: '#9a3412', frame: 'single' },
  tech: { accent: '#0e7490', frame: 'brackets' },
  nature: { accent: '#166534', frame: 'rounded' },
  geometric: { accent: '#6d28d9', frame: 'brackets' },
  waves: { accent: '#1d4ed8', frame: 'single' },
}

export const CERTIFICATE_PATTERN_KEYS = Object.keys(CERTIFICATE_STYLES)

export function getCertificateStyle(pattern?: string): CertificateStyle {
  return CERTIFICATE_STYLES[pattern || ''] || CERTIFICATE_STYLES.professional
}

export interface CertificateArtworkProps {
  certificationName: string
  certificationDescription?: string
  certificationType?: string
  certificatePattern?: string
  certificateInstructor?: string
  certificateId?: string
  awardedDate?: string
  qrCodeLink?: string
  /** Absent in the editors, which preview the certificate without a learner. */
  learnerName?: string
}

function FrameArt({ frame, accent }: CertificateStyle) {
  const inset = 28
  const box: React.CSSProperties = { position: 'absolute', inset }
  switch (frame) {
    case 'double':
      return (
        <>
          <div style={{ ...box, border: `2px solid ${accent}` }} />
          <div style={{ position: 'absolute', inset: inset + 8, border: `1px solid ${accent}`, opacity: 0.45 }} />
        </>
      )
    case 'single':
      return <div style={{ ...box, border: `1.5px solid ${accent}` }} />
    case 'rounded':
      return <div style={{ ...box, border: `1.5px solid ${accent}`, borderRadius: 18 }} />
    case 'hairline':
      return <div style={{ ...box, border: '1px solid #e5e7eb' }} />
    case 'bar':
      return (
        <>
          <div style={{ ...box, border: '1px solid #e5e7eb' }} />
          <div style={{ position: 'absolute', top: inset, bottom: inset, left: inset, width: 10, background: accent }} />
        </>
      )
    case 'brackets': {
      const arm = 56
      const corner = (pos: React.CSSProperties, sides: string[]) => (
        <div
          style={{
            position: 'absolute',
            width: arm,
            height: arm,
            ...pos,
            ...Object.fromEntries(sides.map((s) => [`border${s}`, `2px solid ${accent}`])),
          }}
        />
      )
      return (
        <>
          <div style={{ ...box, border: '1px solid #e5e7eb' }} />
          {corner({ top: inset, left: inset }, ['Top', 'Left'])}
          {corner({ top: inset, right: inset }, ['Top', 'Right'])}
          {corner({ bottom: inset, left: inset }, ['Bottom', 'Left'])}
          {corner({ bottom: inset, right: inset }, ['Bottom', 'Right'])}
        </>
      )
    }
  }
}

function useQrCode(value?: string) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!value) return
    let cancelled = false
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(value, { width: 240, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#ffffff' } })
      )
      .then((data) => !cancelled && setUrl(data))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [value])
  return value ? url : ''
}

// dir="ltr" deliberately, with physical positioning throughout.
//
// The certificate is rasterised by html2canvas for PDF export, which
// reimplements layout and clones into an offscreen iframe where dir
// inheritance is unreliable. Text nodes use dir="auto" so Arabic names and
// titles still read correctly inside the fixed layout.
function CertificateArtwork({
  certificationName,
  certificationDescription,
  certificationType,
  certificatePattern,
  certificateInstructor,
  certificateId,
  awardedDate,
  qrCodeLink,
  learnerName,
}: CertificateArtworkProps) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const style = getCertificateStyle(certificatePattern)
  const qr = useQrCode(qrCodeLink || certificateId)
  const typeKey = certificationType || 'completion'
  const date = awardedDate || formatDate(new Date(), i18n.language, { dateStyle: 'long' })
  const signer = certificateInstructor?.trim()

  const caption: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#9ca3af',
    fontWeight: 600,
  }

  return (
    <div
      dir="ltr"
      style={{ width: CERTIFICATE_WIDTH, height: CERTIFICATE_HEIGHT, position: 'relative', background: '#ffffff', color: '#111827', overflow: 'hidden' }}
    >
      <FrameArt {...style} />

      {/* Issuer */}
      <div style={{ position: 'absolute', top: 76, left: 92, right: 92, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {hasOrgLogo(org) && (
            <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden' }}>
              <OrgSquareLogo org={org} fallback={null} wideInsetClassName="" crossOrigin="anonymous" />
            </div>
          )}
          <span dir="auto" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {org?.name || 'LearnHouse'}
          </span>
        </div>
        <span style={{ ...caption, color: style.accent }}>
          {t(`dashboard.courses.certification.types.${typeKey}`)}
        </span>
      </div>

      {/* Body */}
      <div style={{ position: 'absolute', top: 178, left: 120, right: 120, textAlign: 'center' }}>
        <div style={{ fontSize: 15, letterSpacing: '0.32em', textTransform: 'uppercase', fontWeight: 600, color: style.accent }}>
          {t('certificate.document.title')}
        </div>
        <div style={{ fontSize: 17, color: '#6b7280', marginTop: 34 }}>{t('certificate.document.presented_to')}</div>
        <div
          dir="auto"
          style={{
            fontSize: 54,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1.1,
            marginTop: 12,
            color: learnerName ? '#111827' : '#d1d5db',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {learnerName || t('certificate.document.learner_placeholder')}
        </div>
        <div style={{ width: 64, height: 2, background: style.accent, margin: '26px auto 0' }} />
        <div style={{ fontSize: 17, color: '#6b7280', marginTop: 26 }}>{t('certificate.document.for_completing')}</div>
        <div dir="auto" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.015em', marginTop: 8 }}>
          {certificationName || t('certificate.document.name_placeholder')}
        </div>
        {certificationDescription && (
          <div
            dir="auto"
            style={{
              fontSize: 15,
              lineHeight: 1.55,
              color: '#6b7280',
              margin: '12px auto 0',
              maxWidth: 640,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {certificationDescription}
          </div>
        )}
      </div>

      {/* Signatures, seal, verification */}
      <div style={{ position: 'absolute', left: 92, right: 92, bottom: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ width: 300 }}>
          <div dir="auto" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, paddingBottom: 10, borderBottom: '1px solid #d1d5db' }}>
            {signer || org?.name || 'LearnHouse'}
          </div>
          <div style={{ ...caption, marginTop: 10 }}>
            {signer ? t('certificate.document.instructor') : t('certificate.document.issued_by')}
          </div>
        </div>

        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: '50%',
            border: `2px solid ${style.accent}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 4,
          }}
        >
          <div style={{ width: 78, height: 78, borderRadius: '50%', border: `1px solid ${style.accent}`, opacity: 0.9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Award size={34} strokeWidth={1.5} color={style.accent} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ width: 200 }}>
            <div style={{ fontSize: 16, fontWeight: 600, paddingBottom: 10, borderBottom: '1px solid #d1d5db' }}>{date}</div>
            <div style={{ ...caption, marginTop: 10 }}>{t('certificate.document.date')}</div>
          </div>
          {qr ? (
            <img src={qr} alt="" style={{ width: 76, height: 76 }} />
          ) : (
            <div style={{ width: 76, height: 76, background: '#f3f4f6', borderRadius: 6 }} />
          )}
        </div>
      </div>

      {certificateId && (
        <div style={{ position: 'absolute', bottom: 44, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#9ca3af', letterSpacing: '0.04em' }}>
          {t('certificate.document.credential_id')} {certificateId}
        </div>
      )}
    </div>
  )
}

export default CertificateArtwork
