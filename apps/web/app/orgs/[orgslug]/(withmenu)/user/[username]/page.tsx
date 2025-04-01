import React from 'react'
import { getUserByUsername } from '@services/users/users'
import { getServerSession } from 'next-auth'
import { nextAuthOptions } from 'app/auth/options'
import { Metadata } from 'next'
import UserProfileClient from './UserProfileClient'

interface UserPageParams {
  username: string;
  orgslug: string;
}

interface UserPageProps {
  params: Promise<UserPageParams>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: UserPageProps): Promise<Metadata> {
  try {
    const resolvedParams = await params

    

    const userData = await getUserByUsername(resolvedParams.username)
    return {
      title: `${userData.first_name} ${userData.last_name} | Profile`,
      description: userData.bio || `Profile page of ${userData.first_name} ${userData.last_name}`,
    }
  } catch (error) {
    return {
      title: 'User Profile',
    }
  }
}

async function UserPage({ params }: UserPageProps) {
  const resolvedParams = await params;
  const { username } = resolvedParams;
  
  try {
    // Fetch user data by username
    const userData = await getUserByUsername(username);
    const profile = userData.profile ? (
      typeof userData.profile === 'string' ? JSON.parse(userData.profile) : userData.profile
    ) : { sections: [] };

    return (
      <div>
        <UserProfileClient
          userData={userData}
          profile={profile}
        />
      </div>
    )
  } catch (error) {
    console.error('Error fetching user data:', error)
    return (
      <div className="container mx-auto py-8">
        <div className="bg-white rounded-xl nice-shadow p-6">
          <p className="text-red-600">Error loading user profile</p>
        </div>
      </div>
    )
  }
}

export default UserPage