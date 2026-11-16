import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { ArrowRight, MapPin, WarningCircle } from '@phosphor-icons/react'
import { getUser } from '@services/users/users'
import { getUriWithOrg } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import { Skeleton, buttonClass } from '@/design'
import { MessageUserButton } from '@components/Messaging/EntryButtons'
import { DetailIcon } from '@components/Objects/Profile/profileIcons'
import { normalizeDetails, normalizeProfile, visibleDetails } from '@/lib/profile/profile'

type UserProfilePopupProps = {
  children: React.ReactNode
  userId: string
}

type UserData = {
  id: number
  user_uuid: string
  first_name: string
  last_name: string
  username: string
  bio?: string
  avatar_image?: string
  details?: unknown
  profile?: unknown
}

/** Hover card on an avatar: name, headline, bio, a few details, and the way
 * to the full profile (or a message). Same data the public profile shows. */
const UserProfilePopup = ({ children, userId }: UserProfilePopupProps) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = Boolean(access_token)
  const params = useParams() as any
  const [userData, setUserData] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasOpened, setHasOpened] = useState(false)

  useEffect(() => {
    if (!hasOpened) return
    if (!userId) return
    // SECURITY: the profile fetch requires authentication to avoid leaking a
    // user enumeration surface. Anonymous viewers get a placeholder popup
    // (the trigger avatar is still rendered via `children`).
    if (!isAuthenticated) return

    const fetchUserData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const data = await getUser(userId, access_token)
        setUserData(data)
      } catch (err) {
        setError(t('user.profile_load_failed'))
        console.error('Error fetching user data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchUserData()
  }, [hasOpened, userId, access_token, isAuthenticated, t])

  const { doc, details } = useMemo(() => {
    const doc = normalizeProfile(userData?.profile, userData?.details)
    // Hidden details stay hidden here too.
    const detailsShown = doc.sections.some((s) => s.type === 'details' && !s.hidden)
    return { doc, details: detailsShown ? visibleDetails(normalizeDetails(userData?.details)).slice(0, 4) : [] }
  }, [userData])

  const name = userData ? [userData.first_name, userData.last_name].filter(Boolean).join(' ') || userData.username : ''
  const profileHref = userData?.username ? getUriWithOrg(params?.orgslug, `/user/${userData.username}`) : null

  return (
    <HoverCard openDelay={100} closeDelay={150} onOpenChange={(open) => { if (open && !hasOpened) setHasOpened(true) }}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent className="w-80 max-w-[calc(100vw-2rem)] bg-white p-0 rounded-2xl border-0 nice-shadow overflow-hidden">
        {!isAuthenticated ? (
          <div className="px-4 py-3.5 text-sm text-neutral-600">
            {t('user.sign_in_to_view_profile')}
          </div>
        ) : isLoading && !userData ? (
          <div className="p-4 flex items-start gap-3" aria-busy="true">
            <Skeleton className="w-12 h-12 !rounded-full shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ) : error && !userData ? (
          <div className="flex items-center gap-2 px-4 py-3.5 text-sm font-medium text-rose-600">
            <WarningCircle size={16} weight="fill" className="shrink-0" />
            {error}
          </div>
        ) : userData ? (
          <div>
            <div className="p-4 flex items-start gap-3">
              <div className="shrink-0 rounded-full">{children}</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-neutral-900 truncate leading-tight" dir="auto">
                  {name}
                  {doc.pronouns.trim() && <span className="ms-1.5 text-xs font-normal text-neutral-400">({doc.pronouns.trim()})</span>}
                </p>
                <p className="text-xs text-neutral-400 truncate"><bdi dir="ltr">@{userData.username}</bdi></p>
                {doc.headline.trim() && (
                  <p className="mt-1 text-[13px] font-medium text-neutral-700 line-clamp-2" dir="auto">{doc.headline.trim()}</p>
                )}
                {doc.location.trim() && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500 min-w-0">
                    <MapPin size={12} className="shrink-0" />
                    <span className="truncate" dir="auto">{doc.location.trim()}</span>
                  </p>
                )}
              </div>
            </div>
            {userData.bio && (
              <p className="px-4 -mt-1 pb-3 text-[13px] text-neutral-500 leading-normal line-clamp-3" dir="auto">
                {userData.bio}
              </p>
            )}
            {details.length > 0 && (
              <ul className="px-4 py-3 space-y-2 border-t border-neutral-100">
                {details.map((detail) => (
                  <li key={detail.id} className="flex items-center gap-2.5 min-w-0">
                    <DetailIcon name={detail.icon} size={14} className="shrink-0 text-neutral-400" />
                    <span className="truncate text-[13px] text-neutral-700" dir="auto">{detail.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {profileHref && (
              <div className="flex items-center gap-2 px-4 py-3 border-t border-neutral-100 bg-neutral-50/60">
                <MessageUserButton orgslug={params?.orgslug} userUuid={userData.user_uuid} userId={userData.id} />
                <Link href={profileHref} className={`${buttonClass('secondary', 'md')} ms-auto`}>
                  {t('user.profile.view_profile', { defaultValue: 'View profile' })}
                  <ArrowRight size={13} className="rtl:rotate-180" />
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

export default UserProfilePopup
