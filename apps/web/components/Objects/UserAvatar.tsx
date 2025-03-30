import React, { useEffect, useState } from 'react'
import { getUriWithOrg } from '@services/config/config'
import { useParams } from 'next/navigation'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserProfilePopup from './UserProfilePopup'
import { getUserByUsername } from '@services/users/users'

type UserAvatarProps = {
  width?: number
  avatar_url?: string
  use_with_session?: boolean
  rounded?: 'rounded-md' | 'rounded-xl' | 'rounded-lg' | 'rounded-full' | 'rounded'
  border?: 'border-2' | 'border-4' | 'border-8'
  borderColor?: string
  predefined_avatar?: 'ai' | 'empty'
  backgroundColor?: 'bg-white' | 'bg-gray-100' 
  showProfilePopup?: boolean
  userId?: string
  username?: string
}

function UserAvatar(props: UserAvatarProps) {
  const session = useLHSession() as any
  const params = useParams() as any
  const [userData, setUserData] = useState<any>(null)

  useEffect(() => {
    const fetchUserByUsername = async () => {
      if (props.username && session?.data?.tokens?.access_token) {
        try {
          const data = await getUserByUsername(props.username, session.data.tokens.access_token)
          setUserData(data)
        } catch (error) {
          console.error('Error fetching user by username:', error)
        }
      }
    }

    fetchUserByUsername()
  }, [props.username, session?.data?.tokens?.access_token])

  const isExternalUrl = (url: string): boolean => {
    return url.startsWith('http://') || url.startsWith('https://')
  }

  const extractExternalUrl = (url: string): string | null => {
    // Check if the URL contains an embedded external URL
    const matches = url.match(/avatars\/(https?:\/\/[^/]+.*$)/)
    if (matches && matches[1]) {
      return matches[1]
    }
    return null
  }

  const getAvatarUrl = (): string => {
    // If predefined avatar is specified
    if (props.predefined_avatar) {
      const avatarType = props.predefined_avatar === 'ai' ? 'ai_avatar.png' : 'empty_avatar.png'
      return getUriWithOrg(params.orgslug, `/${avatarType}`)
    }

    // If avatar_url prop is provided
    if (props.avatar_url) {
      // Check if it's a malformed URL (external URL processed through getUserAvatarMediaDirectory)
      const extractedUrl = extractExternalUrl(props.avatar_url)
      if (extractedUrl) {
        return extractedUrl
      }
      // If it's a direct external URL
      if (isExternalUrl(props.avatar_url)) {
        return props.avatar_url
      }
      // Otherwise use as is
      return props.avatar_url
    }

    // If we have user data from username fetch
    if (userData?.avatar_image) {
      const avatarUrl = userData.avatar_image
      // If it's an external URL (e.g., from Google, Facebook, etc.), use it directly
      if (isExternalUrl(avatarUrl)) {
        return avatarUrl
      }
      // Otherwise, get the local avatar URL
      return getUserAvatarMediaDirectory(userData.user_uuid, avatarUrl)
    }

    // If user has an avatar in session
    if (session?.data?.user?.avatar_image) {
      const avatarUrl = session.data.user.avatar_image
      // If it's an external URL (e.g., from Google, Facebook, etc.), use it directly
      if (isExternalUrl(avatarUrl)) {
        return avatarUrl
      }
      // Otherwise, get the local avatar URL
      return getUserAvatarMediaDirectory(session.data.user.user_uuid, avatarUrl)
    }

    // Fallback to empty avatar
    return getUriWithOrg(params.orgslug, '/empty_avatar.png')
  }

  const avatarImage = (
    <img
      alt="User Avatar"
      width={props.width ?? 50}
      height={props.width ?? 50}
      src={getAvatarUrl()}
      className={`
        ${props.avatar_url && session?.data?.user?.avatar_image ? '' : 'bg-gray-700'}
        ${props.border ? `border ${props.border}` : ''}
        ${props.borderColor ?? 'border-white'}
        ${props.backgroundColor ?? 'bg-gray-100'}
        shadow-md shadow-gray-300/45
        aspect-square
        w-[${props.width ?? 50}px]
        h-[${props.width ?? 50}px]
        ${props.rounded ?? 'rounded-xl'}
      `}
    />
  )

  if (props.showProfilePopup && (props.userId || (userData?.id))) {
    return (
      <UserProfilePopup userId={props.userId || userData?.id}>
        {avatarImage}
      </UserProfilePopup>
    )
  }

  return avatarImage
}

export default UserAvatar
