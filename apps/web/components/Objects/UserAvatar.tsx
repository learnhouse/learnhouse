import { useSession } from '@components/Contexts/SessionContext';
import emptyAvatar from '@public/empty_avatar.png';
import aiAvatar from '@public/ai_avatar.png';
import Image from 'next/image';
import React, { use, useEffect } from 'react'
import { getUriWithOrg } from '@services/config/config';
import { useOrg } from '@components/Contexts/OrgContext';
import { useParams } from 'next/navigation';
import { getUserAvatarMediaDirectory } from '@services/media/media';

type UserAvatarProps = {
    width?: number
    avatar_url?: string
    use_with_session?: boolean
    rounded?: 'rounded-md' | 'rounded-xl' | 'rounded-lg' | 'rounded-full' | 'rounded'
    border?: 'border-2' | 'border-4' | 'border-8'
    predefined_avatar?: 'ai'
}

function UserAvatar(props: UserAvatarProps) {
    const session = useSession() as any;
    const params = useParams() as any;
    
    const predefinedAvatar = props.predefined_avatar === 'ai' ? getUriWithOrg(params.orgslug,'/ai_avatar.png') : null;
    const emptyAvatar = getUriWithOrg(params.orgslug,'/empty_avatar.png') as any;
    const uploadedAvatar = getUserAvatarMediaDirectory(session.user.user_uuid,session.user.avatar_image) as any;

    const useAvatar = () => {
        if (props.predefined_avatar) {
            return predefinedAvatar
        } else {
            if (props.avatar_url) {
                return props.avatar_url
            }
            else {
                if (session.user.avatar_image) {
                    return uploadedAvatar
                }
                else {
                    return emptyAvatar
                }
            }
        }
    }


    useEffect(() => {
        console.log('params', params)
    }
        , [session])

    return (
        <img
            alt='User Avatar'
            width={props.width ? props.width : 50}
            height={props.width ? props.width : 50}
            src={useAvatar()}
            className={`${props.avatar_url && session.user.avatar_image ? '' : 'bg-gray-700'}  ${props.border ? 'border ' + props.border : ''} border-white shadow-xl aspect-square w-[${props.width ? props.width : 50}px] h-[${props.width ? props.width : 50}px] ${props.rounded ? props.rounded : 'rounded-xl'}`}
        />
    )
}

export default UserAvatar