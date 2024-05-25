import React, { useEffect, useState } from 'react'
import UserAvatar from '../UserAvatar'
import { useSession } from 'next-auth/react'
import { getUserAvatarMediaDirectory } from '@services/media/media';
import { getCollaborationServerUrl } from '@services/config/config';
import { useOrg } from '@components/Contexts/OrgContext';

type ActiveAvatarsProps = {
    mouseMovements: any;
    userRandomColor: string;
}

function ActiveAvatars(props: ActiveAvatarsProps) {
    const session = useSession() as any;
    const org = useOrg() as any;
    const [activeUsers, setActiveUsers] = useState({} as any);

    /*  Collaboration Features */
    const collab = getCollaborationServerUrl()
    const isCollabEnabledOnThisOrg = org?.config.config.GeneralConfig.collaboration && collab

    // Get users from the mouseMovements object
    useEffect(() => {
        const users: any = {};
        Object.keys(props.mouseMovements).forEach((key) => {
            users[props.mouseMovements[key].user.user_uuid] = props.mouseMovements[key].user;
        });

        // Remove the current user from the list
        delete users[session.data.user.user_uuid];

        setActiveUsers(users);
    }
        , [props.mouseMovements, session.data.user, org]);


    return (
        <div className=''>

            <div className='flex -space-x-2 transition-all ease-linear'>
                {isCollabEnabledOnThisOrg && Object.keys(activeUsers).map((key) => (
                    <div className='flex' style={{ position: 'relative' }} key={key}>
                        <UserAvatar
                            key={key}
                            width={40}
                            border="border-4"
                            rounded="rounded-full"
                            avatar_url={getUserAvatarMediaDirectory(activeUsers[key].user_uuid, activeUsers[key].avatar_image) as string}
                        />
                        <div className="h-2 w-2 rounded-full" style={{ position: 'absolute', bottom: -5, right: 16, backgroundColor: props.mouseMovements[key].color }} />
                    </div>
                ))}
                {session.status && (
                    <div className='z-50'>
                        <UserAvatar
                            width={40}
                            border="border-4"
                            rounded="rounded-full"
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

export default ActiveAvatars