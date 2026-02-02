import React from 'react'
import { getUserByUsername } from '@services/users/users'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { nextAuthOptions } from 'app/auth/options'
import UserProfileClient from './UserProfileClient'
import { redirect } from 'next/navigation'

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
    const session = await getServerSession(nextAuthOptions)
    const access_token = session?.tokens?.access_token

    // If no session, return basic metadata (SEO will show generic title)
    if (!access_token) {
      return {
        title: 'User Profile',
        description: 'View user profile',
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
  const { username, orgslug } = resolvedParams;

  // Get session for authentication
  const session = await getServerSession(nextAuthOptions)
  const access_token = session?.tokens?.access_token

  // Require authentication to view user profiles
  if (!access_token) {
    redirect(`/orgs/${orgslug}/login?redirect=/orgs/${orgslug}/user/${username}`)
  }

  try {
    // Fetch user data by username with authentication
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
          <p className="text-red-600">Error loading user profile. The user may not exist or you may not have permission to view this profile.</p>
        </div>
      </div>
    )
  }
}

export default UserPage