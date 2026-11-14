'use client'

import React from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import ProfileView, { type ProfileUser } from '@components/Objects/Profile/ProfileView'
import { normalizeDetails, normalizeProfile } from '@/lib/profile/profile'

interface UserProfileClientProps {
  userData: ProfileUser & { profile?: unknown; details?: unknown }
  orgslug: string
}

function UserProfileClient({ userData, orgslug }: UserProfileClientProps) {
  const session = useLHSession() as any
  const isSelf = session?.data?.user?.id === userData.id
  const doc = React.useMemo(() => normalizeProfile(userData.profile, userData.details), [userData.profile, userData.details])
  const details = React.useMemo(() => normalizeDetails(userData.details), [userData.details])

  return (
    <GeneralWrapperStyled>
      <div className="max-w-6xl mx-auto pt-1 sm:pt-3 pb-16 min-w-0">
        <ProfileView user={userData} doc={doc} details={details} isSelf={isSelf} orgslug={orgslug} />
      </div>
    </GeneralWrapperStyled>
  )
}

export default UserProfileClient
