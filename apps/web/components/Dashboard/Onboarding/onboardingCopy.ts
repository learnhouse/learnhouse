import type React from 'react'
import { Handshake, UsersThree, CurrencyCircleDollar, GraduationCap, ChatsCircle } from '@phosphor-icons/react'
import type { OnboardingIntent } from '@components/Hooks/useOnboarding'

// The welcome asks what the admin is building; the launch plan then explains
// every step in those terms. Text lives in locales under onboarding.intent.*
// (label, hint, headline) and onboarding.why.<intent>.<step>.
export const INTENTS: { id: OnboardingIntent; icon: React.ElementType }[] = [
  { id: 'customers', icon: Handshake },
  { id: 'team', icon: UsersThree },
  { id: 'sell', icon: CurrencyCircleDollar },
  { id: 'school', icon: GraduationCap },
  { id: 'community', icon: ChatsCircle },
]

export const whyKey = (intent: OnboardingIntent, stepId: string) => `onboarding.why.${intent}.${stepId}`
