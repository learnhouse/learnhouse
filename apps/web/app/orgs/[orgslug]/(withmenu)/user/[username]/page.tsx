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
    const session = await getServerSession(nextAuthOptions)
    const access_token = session?.tokens?.access_token
    const resolvedParams = await params

    if (!access_token) {
      return {
        title: 'User Profile',
      }
    }

    const userData = await getUserByUsername(resolvedParams.username, access_token)
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
    // Get access token from server session
    const session = await getServerSession(nextAuthOptions)
    const access_token = session?.tokens?.access_token

    if (!access_token) {
      throw new Error('No access token available')
    }

    // Fetch user data by username
    const userData = await getUserByUsername(username, access_token);
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