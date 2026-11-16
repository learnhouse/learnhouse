'use client'

import type { Icon } from '@phosphor-icons/react'
import {
  BookOpen,
  Broadcast,
  ChalkboardSimple,
  ChatCircleDots,
  ChatsCircle,
  CheckCircle,
  Certificate,
  ClipboardText,
  CreditCard,
  EnvelopeSimple,
  Gauge,
  HandWaving,
  LockKeyOpen,
  Megaphone,
  Path,
  Plugs,
  Sparkle,
  Student,
  UserPlus,
  UsersThree,
  VideoCamera,
  WarningCircle,
} from '@phosphor-icons/react'

// One quiet icon per category (monochrome; rows stay neutral like Messages).
const CATEGORY_ICON: Record<string, Icon> = {
  messages: ChatsCircle,
  assignments: ClipboardText,
  courses: BookOpen,
  live: VideoCamera,
  community: ChatCircleDots,
  groups: UsersThree,
  billing: CreditCard,
  boards: ChalkboardSimple,
  teaching: Student,
  people: UserPlus,
  integrations: Plugs,
  newsletter: EnvelopeSimple,
  plan: Gauge,
  automation: Sparkle,
}

const TYPE_ICON: Partial<Record<string, Icon>> = {
  assignment_graded: CheckCircle,
  chapter_unlocked: LockKeyOpen,
  certificate: Certificate,
  path_assigned: Path,
  path_completed: Path,
  live_session: Broadcast,
  group_announcement: Megaphone,
  board_hand_raise: HandWaving,
  payment_failed: WarningCircle,
  org_payment_failed: WarningCircle,
  integration_alert: WarningCircle,
}

export function categoryIcon(category: string): Icon {
  return CATEGORY_ICON[category] || BookOpen
}

export function typeLook(type: string, category?: string): { Icon: Icon } {
  return { Icon: TYPE_ICON[type] || categoryIcon(category || 'courses') }
}
