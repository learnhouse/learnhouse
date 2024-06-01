'use client'
import React, { useEffect } from 'react'
import styled from 'styled-components'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import UserAvatar from '@components/Objects/UserAvatar'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export const HeaderProfileBox = () => {
  const session = useLHSession() as any
  const isUserAdmin = useAdminStatus() as any

  useEffect(() => {}
  , [session])

  return (
    <ProfileArea>
      {session.status == 'unauthenticated' && (
        <UnidentifiedArea className="flex text-sm text-gray-700 font-bold p-1.5 px-2 rounded-lg">
          <ul className="flex space-x-3 items-center">
            <li>
              <Link href="/login">Login</Link>
            </li>
            <li className="bg-black rounded-lg shadow-md p-2 px-3 text-white">
              <Link href="/signup">Sign up</Link>
            </li>
          </ul>
        </UnidentifiedArea>
      )}
      {session.status == 'authenticated' && (
        <AccountArea className="space-x-0">
          <div className="flex items-center space-x-2">
            <div className='flex items-center space-x-2' >
              <p className='text-sm'>{session.data.user.username}</p>
              {isUserAdmin && <div className="text-[10px] bg-rose-300 px-2 font-bold rounded-md shadow-inner py-1">ADMIN</div>}
            </div>
            <div className="py-4">
              <UserAvatar border="border-4" rounded="rounded-lg" width={30} />
            </div>
            <Link className="text-gray-600" href={'/dash'}>
              <Settings size={14} />
            </Link>
          </div>
        </AccountArea>
      )}
    </ProfileArea>
  )
}

const AccountArea = styled.div`
  display: flex;
  place-items: center;

  img {
    width: 29px;
  }
`

const ProfileArea = styled.div`
  display: flex;
  place-items: stretch;
  place-items: center;
`

const UnidentifiedArea = styled.div`
  display: flex;
  place-items: stretch;
  flex-grow: 1;
`
