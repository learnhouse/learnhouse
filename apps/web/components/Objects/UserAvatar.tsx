import { useSession } from '@components/Contexts/SessionContext'
import React, { useEffect } from 'react'
import { getUriWithOrg } from '@services/config/config'
import { useParams } from 'next/navigation'
import { getUserAvatarMediaDirectory } from '@services/media/media'

type UserAvatarProps = {
  width?: number
  avatar_url?: string
  use_with_session?: boolean
  rounded?:
    | 'rounded-md'
    | 'rounded-xl'
    | 'rounded-lg'
    | 'rounded-full'
    | 'rounded'
  border?: 'border-2' | 'border-4' | 'border-8'
  borderColor?: string
  predefined_avatar?: 'ai' | 'empty' 
}

function UserAvatar(props: UserAvatarProps) {
  const session = useSession() as any
  const params = useParams() as any

  const predefinedAvatarFunc = () => {
    if (props.predefined_avatar === 'ai') {
      return getUriWithOrg(params.orgslug, '/ai_avatar.png')
    }
    if (props.predefined_avatar === 'empty') {
      return getUriWithOrg(params.orgslug, '/empty_avatar.png')
    }
    return null
  }

  const predefinedAvatar = predefinedAvatarFunc()
  const emptyAvatar = getUriWithOrg(params.orgslug, '/empty_avatar.png') as any
  const uploadedAvatar = getUserAvatarMediaDirectory(
    session.user.user_uuid,
    session.user.avatar_image
  ) as any

  const useAvatar = () => {
    if (props.predefined_avatar) {
      return predefinedAvatar
    } else {
      if (props.avatar_url) {
        return props.avatar_url
      } else {
        if (session.user.avatar_image) {
          return uploadedAvatar
        } else {
          return emptyAvatar
        }
      }
    }
  }

  useEffect(() => {
    
  }, [session])

  return (
    <img
      alt="User Avatar"
      width={props.width ? props.width : 50}
      height={props.width ? props.width : 50}
      src={useAvatar()}
      className={`${
        props.avatar_url && session.user.avatar_image ? '' : 'bg-gray-700'
      }  ${props.border ? 'border ' + props.border : ''} ${
        props.borderColor ? props.borderColor : 'border-white'
      } shadow-xl aspect-square w-[${props.width ? props.width : 50}px] h-[${
        props.width ? props.width : 50
      }px] ${props.rounded ? props.rounded : 'rounded-xl'}`}
    />
  )
}

export default UserAvatar
