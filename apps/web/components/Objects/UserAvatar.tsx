import React, { useEffect, useState } from 'react'
import { getUriWithOrg } from '@services/config/config'
import { useParams } from 'next/navigation'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserProfilePopup from './UserProfilePopup'
import { getUserByUsername, getUser } from '@services/users/users'

type UserAvatarProps = {
  width?: number
  avatar_url?: string
  use_with_session?: boolean
  rounded?: 'rounded-md' | 'rounded-xl' | 'rounded-lg' | 'rounded-full' | 'rounded'
  border?: 'border' | 'border-2' | 'border-4' | 'border-8'
  borderColor?: string
  predefined_avatar?: 'ai' | 'empty'
  backgroundColor?: 'bg-white' | 'bg-gray-100'
  showProfilePopup?: boolean
  userId?: string
  username?: string
  shadow?: string
}

function UserAvatar(props: UserAvatarProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const params = useParams() as any
  const [userData, setUserData] = useState<any>(null)
  const [erroredUrl, setErroredUrl] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserData = async () => {
      if (!access_token) return
      if (props.avatar_url || props.predefined_avatar) return

      if (props.username) {
        try {
          const data = await getUserByUsername(props.username, access_token)
          setUserData(data)
        } catch (error) {
          console.error('Error fetching user by username:', error)
        }
      } else if (props.userId) {
        try {
          const data = await getUser(props.userId, access_token)
          setUserData(data)
        } catch (error) {
          console.error('Error fetching user by ID:', error)
        }
      }
    }

    fetchUserData()
  }, [props.username, props.userId, access_token, props.avatar_url, props.predefined_avatar])

  const isExternalUrl = (url: string): boolean => {
    return url.startsWith('http://') || url.startsWith('https://')
  }

  const extractExternalUrl = (url: string): string | null => {
    const matches = url.match(/avatars\/(https?:\/\/[^/]+.*$)/)
    if (matches && matches[1]) {
      return matches[1]
    }
    return null
  }

  const getAvatarUrl = (): string => {
    if (props.predefined_avatar) {
      const avatarType = props.predefined_avatar === 'ai' ? 'ai_avatar.png' : 'empty_avatar.png'
      return getUriWithOrg(params.orgslug, `/${avatarType}`)
    }

    if (props.avatar_url) {
      const extractedUrl = extractExternalUrl(props.avatar_url)
      if (extractedUrl) {
        return extractedUrl
      }
      if (isExternalUrl(props.avatar_url)) {
        return props.avatar_url
      }
      return props.avatar_url
    }

    if (userData?.avatar_image) {
      const avatarUrl = userData.avatar_image
      if (isExternalUrl(avatarUrl)) {
        return avatarUrl
      }
      return getUserAvatarMediaDirectory(userData.user_uuid, avatarUrl)
    }

    if (props.userId || props.username) {
      return getUriWithOrg(params.orgslug, '/empty_avatar.png')
    }

    if (session?.data?.user?.avatar_image) {
      const avatarUrl = session.data.user.avatar_image
      if (isExternalUrl(avatarUrl)) {
        return avatarUrl
      }
      return getUserAvatarMediaDirectory(session.data.user.user_uuid, avatarUrl)
    }

    return getUriWithOrg(params.orgslug, '/empty_avatar.png')
  }

  const emptyAvatarUrl = getUriWithOrg(params.orgslug, '/empty_avatar.png')
  const resolvedAvatarUrl = getAvatarUrl()
  const hasError = erroredUrl === resolvedAvatarUrl

  const avatarImage = (
    <img
      alt="User Avatar"
      width={props.width ?? 50}
      height={props.width ?? 50}
      src={hasError ? emptyAvatarUrl : resolvedAvatarUrl}
      onError={() => {
        if (resolvedAvatarUrl !== emptyAvatarUrl) {
          setErroredUrl(resolvedAvatarUrl)
        }
      }}
      className={`
        ${props.avatar_url && session?.data?.user?.avatar_image ? '' : 'bg-gray-700'}
        ${props.border ? `border ${props.border}` : ''}
        ${props.borderColor ?? 'border-white'}
        ${props.backgroundColor ?? 'bg-gray-100'}
        ${props.shadow ?? 'shadow-md shadow-gray-300/45'}
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