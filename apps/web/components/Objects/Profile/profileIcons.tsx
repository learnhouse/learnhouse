'use client'
import React from 'react'
import {
  Article,
  Briefcase,
  BookOpen,
  Buildings,
  Calendar,
  Envelope,
  FacebookLogo,
  GithubLogo,
  Globe,
  GraduationCap,
  IdentificationBadge,
  ImagesSquare,
  InstagramLogo,
  Laptop,
  Lightbulb,
  LinkSimple,
  LinkedinLogo,
  MapPin,
  MastodonLogo,
  Medal,
  Sparkle,
  Star,
  Tag,
  Users,
  XLogo,
  YoutubeLogo,
  type Icon,
} from '@phosphor-icons/react'
import type { LinkKind, SectionType } from '@/lib/profile/profile'

/** Icons a detail row can pick (keys are the stored values, kept from the old Lucide names). */
export const DETAIL_ICONS: { name: string; labelKey: string; icon: Icon }[] = [
  { name: 'briefcase', labelKey: 'user.settings.general.icons.briefcase', icon: Briefcase },
  { name: 'graduation-cap', labelKey: 'user.settings.general.icons.education', icon: GraduationCap },
  { name: 'map-pin', labelKey: 'user.settings.general.icons.location', icon: MapPin },
  { name: 'building-2', labelKey: 'user.settings.general.icons.organization', icon: Buildings },
  { name: 'speciality', labelKey: 'user.settings.general.icons.speciality', icon: Lightbulb },
  { name: 'globe', labelKey: 'user.settings.general.icons.website', icon: Globe },
  { name: 'laptop-2', labelKey: 'user.settings.general.icons.tech', icon: Laptop },
  { name: 'award', labelKey: 'user.settings.general.icons.achievement', icon: Medal },
  { name: 'book-open', labelKey: 'user.settings.general.icons.book', icon: BookOpen },
  { name: 'link', labelKey: 'user.settings.general.icons.link', icon: LinkSimple },
  { name: 'users', labelKey: 'user.settings.general.icons.community', icon: Users },
  { name: 'calendar', labelKey: 'user.settings.general.icons.calendar', icon: Calendar },
]

export function DetailIcon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const Cmp = DETAIL_ICONS.find((i) => i.name === name)?.icon ?? Tag
  return <Cmp size={size} className={className} aria-hidden="true" />
}

const LINK_ICONS: Record<LinkKind, Icon> = {
  github: GithubLogo,
  linkedin: LinkedinLogo,
  x: XLogo,
  youtube: YoutubeLogo,
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  mastodon: MastodonLogo,
  mail: Envelope,
  website: Globe,
}

export function LinkKindIcon({ kind, size = 16, className = '' }: { kind: LinkKind; size?: number; className?: string }) {
  const Cmp = LINK_ICONS[kind]
  return <Cmp size={size} className={className} aria-hidden="true" />
}

/** Builder + section headings: icon and default title per section type. */
export const SECTION_META: Record<SectionType, { icon: Icon; labelKey: string; label: string; descriptionKey: string; description: string }> = {
  details: {
    icon: IdentificationBadge,
    labelKey: 'user.settings.profile_builder.section_types.details.label',
    label: 'Details',
    descriptionKey: 'user.settings.profile_builder.section_types.details.description',
    description: 'Title, organization, location and other facts',
  },
  text: {
    icon: Article,
    labelKey: 'user.settings.profile_builder.section_types.text.label',
    label: 'Text',
    descriptionKey: 'user.settings.profile_builder.section_types.text.description',
    description: 'Add formatted text content',
  },
  links: {
    icon: LinkSimple,
    labelKey: 'user.settings.profile_builder.section_types.links.label',
    label: 'Links',
    descriptionKey: 'user.settings.profile_builder.section_types.links.description',
    description: 'Add social or professional links',
  },
  skills: {
    icon: Sparkle,
    labelKey: 'user.settings.profile_builder.section_types.skills.label',
    label: 'Skills',
    descriptionKey: 'user.settings.profile_builder.section_types.skills.description',
    description: 'Showcase your skills and expertise',
  },
  experience: {
    icon: Briefcase,
    labelKey: 'user.settings.profile_builder.section_types.experience.label',
    label: 'Experience',
    descriptionKey: 'user.settings.profile_builder.section_types.experience.description',
    description: 'Add work or project experience',
  },
  education: {
    icon: GraduationCap,
    labelKey: 'user.settings.profile_builder.section_types.education.label',
    label: 'Education',
    descriptionKey: 'user.settings.profile_builder.section_types.education.description',
    description: 'Add educational background',
  },
  affiliation: {
    icon: Buildings,
    labelKey: 'user.settings.profile_builder.section_types.affiliation.label',
    label: 'Affiliation',
    descriptionKey: 'user.settings.profile_builder.section_types.affiliation.description',
    description: 'Add organizational affiliations',
  },
  'image-gallery': {
    icon: ImagesSquare,
    labelKey: 'user.settings.profile_builder.section_types.image_gallery.label',
    label: 'Image Gallery',
    descriptionKey: 'user.settings.profile_builder.section_types.image_gallery.description',
    description: 'Add a collection of images',
  },
  featured: {
    icon: Star,
    labelKey: 'user.settings.profile_builder.section_types.featured.label',
    label: 'Featured',
    descriptionKey: 'user.settings.profile_builder.section_types.featured.description',
    description: 'Pin your best courses, certificates and badges',
  },
  courses: {
    icon: BookOpen,
    labelKey: 'user.settings.profile_builder.section_types.courses.label',
    label: 'Courses',
    descriptionKey: 'user.settings.profile_builder.section_types.courses.description',
    description: 'Display authored courses',
  },
}
