import React, { cache } from 'react'
import { getUserByUsername } from '@services/users/users'
import { Metadata } from 'next'
import { getServerSession } from '@/lib/auth/server'
import UserProfileClient from './UserProfileClient'
import { notFound, redirect } from 'next/navigation'
import { getSeoContext } from '@/lib/seo/context.server'
import { buildPageTitle } from '@/lib/seo/utils'
import { clipDescription, robotsMetadata } from '@/lib/seo/meta'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { normalizeProfile, richTextToPlain } from '@/lib/profile/profile'

interface UserPageParams {
  username: string;
  orgslug: string;
}

interface UserPageProps {
  params: Promise<UserPageParams>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// One profile read per request, shared by the metadata and the page.
const loadUser = cache(async (username: string, accessToken: string) => getUserByUsername(username, accessToken))

// Profiles need a signed-in viewer, so crawlers only ever reach the login
// redirect: mark them members-only (never indexed, like other private pages)
// and give signed-in shares a proper title, description, canonical URL and
// the avatar as the image.

export async function generateMetadata({ params }: UserPageProps): Promise<Metadata> {
  const { username, orgslug } = await params
  let ctx: Awaited<ReturnType<typeof getSeoContext>> | null = null
  try {
    ctx = await getSeoContext(orgslug)
  } catch {
    ctx = null
  }
  const orgName = ctx?.org?.name || ''
  const titled = (name: string) => (ctx ? buildPageTitle(name, orgName, ctx.seo) : name)
  const ROBOTS = robotsMetadata({ orgSeo: ctx?.seo, indexable: false })
  const fallback: Metadata = { title: titled('Profile'), robots: ROBOTS }
  try {
    const session = await getServerSession()
    const access_token = session?.tokens?.access_token
    if (!access_token) return fallback

    const userData = await loadUser(username, access_token)
    const name = [userData.first_name, userData.last_name].filter(Boolean).join(' ') || userData.username
    const doc = normalizeProfile(userData.profile, userData.details)
    const description = clipDescription(
      [doc.headline, userData.bio || richTextToPlain(doc.about)].filter((s) => s && s.trim()).join(' · ') ||
        `Profile of ${name}${orgName ? ` on ${orgName}` : ''}`
    )
    const canonical = ctx ? await ctx.url(`/user/${userData.username}`) : undefined
    const avatar =
      userData.avatar_image && !/^https?:\/\//.test(userData.avatar_image)
        ? getUserAvatarMediaDirectory(userData.user_uuid, userData.avatar_image)
        : userData.avatar_image || undefined
    const title = titled(name)
    return {
      title,
      description,
      robots: ROBOTS,
      ...(canonical ? { alternates: { canonical } } : {}),
      openGraph: {
        title,
        description,
        type: 'profile',
        username: userData.username,
        ...(canonical ? { url: canonical } : {}),
        ...(orgName ? { siteName: orgName } : {}),
        ...(avatar ? { images: [{ url: avatar, alt: name }] } : {}),
      },
      twitter: { card: 'summary', title, description, ...(avatar ? { images: [avatar] } : {}) },
    }
  } catch {
    return fallback
  }
}

async function UserPage({ params }: UserPageProps) {
  const { username, orgslug } = await params

  // Get session for authentication
  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  // Require authentication to view user profiles. Browser-relative path only;
  // the proxy adds /orgs/{slug} and rewrites /login → /auth/login; an
  // org-prefixed path would be double-prefixed → 404.
  if (!access_token) {
    redirect(`/login?redirect=/user/${username}`)
  }

  let userData: any
  try {
    userData = await loadUser(username, access_token)
  } catch (error: any) {
    // Unknown (or not visible) users: the API answers a generic 404.
    if (error?.status === 404) notFound()
    console.error('Error fetching user data:', error)
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl nice-shadow p-6">
          <p className="text-sm text-rose-600">
            Error loading user profile. The user may not exist or you may not have permission to view this profile.
          </p>
        </div>
      </div>
    )
  }

  return <UserProfileClient userData={userData} orgslug={orgslug} />
}

export default UserPage
