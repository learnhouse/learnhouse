import React from 'react'
import { getUriWithOrg } from '@services/config/config'
import { useParams } from 'next/navigation'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'

type UserAvatarProps = {
  width?: number
  avatar_url?: string
  use_with_session?: boolean
  rounded?: 'rounded-md' | 'rounded-xl' | 'rounded-lg' | 'rounded-full' | 'rounded'
  border?: 'border-2' | 'border-4' | 'border-8'
  borderColor?: string
  predefined_avatar?: 'ai' | 'empty'
}

function UserAvatar(props: UserAvatarProps) {
  const session = useLHSession() as any
  const params = useParams() as any

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  const getAvatarUrl = (): string => {
    // If avatar_url prop is provided and is a valid URL, use it directly
    if (props.avatar_url && isValidUrl(props.avatar_url)) {
      return props.avatar_url
    }

    // If user has an avatar in session and it's a valid URL, use it directly
    if (session?.data?.user?.avatar_image && isValidUrl(session.data.user.avatar_image)) {
      return session.data.user.avatar_image
    }

    // If predefined avatar is specified
    if (props.predefined_avatar) {
      const avatarType = props.predefined_avatar === 'ai' ? 'ai_avatar.png' : 'empty_avatar.png'
      return getUriWithOrg(params.orgslug, `/${avatarType}`)
    }

    // If avatar_url prop is provided but not a URL, process it
    if (props.avatar_url) {
      return props.avatar_url
    }

    // If user has an avatar in session but not a URL, process it
    if (session?.data?.user?.avatar_image) {
      return getUserAvatarMediaDirectory(session.data.user.user_uuid, session.data.user.avatar_image)
    }

    // Fallback to empty avatar
    return getUriWithOrg(params.orgslug, '/empty_avatar.png')
  }

  return (
    <img
      alt="User Avatar"
      width={props.width ?? 50}
      height={props.width ?? 50}
      src={getAvatarUrl()}
      className={`
        ${props.avatar_url && session?.data?.user?.avatar_image ? '' : 'bg-gray-700'}
        ${props.border ? `border ${props.border}` : ''}
        ${props.borderColor ?? 'border-white'}
        shadow-xl
        aspect-square
        w-[${props.width ?? 50}px]
        h-[${props.width ?? 50}px]
        ${props.rounded ?? 'rounded-xl'}
      `}
    />
  )
}

export default UserAvatar
