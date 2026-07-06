import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

// Shared transactional email layout (React Email). One flexible template drives
// every message — welcome, purchase, plan change, payment failed, etc. — via an
// accent color plus optional card / transition / bullet blocks. Ported from the
// platform repo's templates/shared.tsx and kept provider-agnostic (rendered to
// HTML by services/emails/resend.ts).

export interface InfoCard {
  label: string
  title: string
  caption?: string
  color: string
}

export interface TransitionCard {
  fromLabel: string
  fromValue: string
  fromColor: string
  toLabel: string
  toValue: string
  toColor: string
}

export interface LearnHouseEmailProps {
  accentColor: string
  heading: string
  subtitle: string
  body?: string
  bulletPoints?: string[]
  card?: InfoCard
  transition?: TransitionCard
  /** Optional call-to-action. */
  cta?: { label: string; href: string }
}

const LOGO_URL = 'https://www.learnhouse.io/learnhouse-dark.svg'

export function LearnHouseEmail({
  accentColor,
  heading,
  subtitle,
  body,
  bulletPoints,
  card,
  transition,
  cta,
}: LearnHouseEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{subtitle}</Preview>
      <Body style={{ backgroundColor: '#f5f5f5', fontFamily: 'Inter, Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: 16, overflow: 'hidden', maxWidth: 560, margin: '0 auto', border: '1px solid #eee' }}>
          {/* Accent bar */}
          <div style={{ height: 6, backgroundColor: accentColor }} />

          <Section style={{ padding: '32px 40px 8px' }}>
            <Img src={LOGO_URL} alt="LearnHouse" height={28} style={{ marginBottom: 24 }} />
            <Heading style={{ fontSize: 24, fontWeight: 800, color: '#171717', margin: '0 0 8px', lineHeight: 1.25 }}>
              {heading}
            </Heading>
            <Text style={{ fontSize: 15, color: '#525252', margin: 0, lineHeight: 1.5 }}>{subtitle}</Text>
          </Section>

          {body && (
            <Section style={{ padding: '8px 40px' }}>
              <Text style={{ fontSize: 14, color: '#404040', margin: 0, lineHeight: 1.6 }}>{body}</Text>
            </Section>
          )}

          {card && (
            <Section style={{ padding: '8px 40px' }}>
              <div style={{ border: `1px solid ${card.color}22`, backgroundColor: `${card.color}0d`, borderRadius: 12, padding: '16px 18px' }}>
                <Text style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: card.color, margin: '0 0 4px' }}>
                  {card.label}
                </Text>
                <Text style={{ fontSize: 18, fontWeight: 700, color: '#171717', margin: 0 }}>{card.title}</Text>
                {card.caption && <Text style={{ fontSize: 12, color: '#737373', margin: '2px 0 0' }}>{card.caption}</Text>}
              </div>
            </Section>
          )}

          {transition && (
            <Section style={{ padding: '8px 40px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                <div style={{ flex: 1, border: `1px solid ${transition.fromColor}22`, backgroundColor: `${transition.fromColor}0d`, borderRadius: 12, padding: '12px 14px' }}>
                  <Text style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: transition.fromColor, margin: '0 0 2px' }}>{transition.fromLabel}</Text>
                  <Text style={{ fontSize: 16, fontWeight: 700, color: '#171717', margin: 0 }}>{transition.fromValue}</Text>
                </div>
                <div style={{ flex: 1, border: `1px solid ${transition.toColor}22`, backgroundColor: `${transition.toColor}0d`, borderRadius: 12, padding: '12px 14px' }}>
                  <Text style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: transition.toColor, margin: '0 0 2px' }}>{transition.toLabel}</Text>
                  <Text style={{ fontSize: 16, fontWeight: 700, color: '#171717', margin: 0 }}>{transition.toValue}</Text>
                </div>
              </div>
            </Section>
          )}

          {bulletPoints && bulletPoints.length > 0 && (
            <Section style={{ padding: '8px 40px' }}>
              {bulletPoints.map((point, i) => (
                <Text key={i} style={{ fontSize: 14, color: '#404040', margin: '0 0 6px', lineHeight: 1.5 }}>
                  <span style={{ color: accentColor, fontWeight: 700, marginRight: 8 }}>•</span>
                  {point}
                </Text>
              ))}
            </Section>
          )}

          {cta && (
            <Section style={{ padding: '16px 40px 8px' }}>
              <a
                href={cta.href}
                style={{ display: 'inline-block', backgroundColor: accentColor, color: '#ffffff', fontWeight: 700, fontSize: 14, padding: '11px 22px', borderRadius: 10, textDecoration: 'none' }}
              >
                {cta.label}
              </a>
            </Section>
          )}

          <Hr style={{ borderColor: '#eee', margin: '24px 40px 0' }} />
          <Section style={{ padding: '16px 40px 32px' }}>
            <Text style={{ fontSize: 12, color: '#a3a3a3', margin: 0 }}>
              LearnHouse — the open-source learning platform.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default LearnHouseEmail
