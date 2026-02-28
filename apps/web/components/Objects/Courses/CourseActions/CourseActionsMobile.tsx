import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getOffersByResource } from '@services/payments/offers'
import { LogIn, LogOut, ShoppingCart, Lock, UserPlus } from 'lucide-react'
import { removeCourse, startCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import UserAvatar from '../../UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import useSWR from 'swr'
import Link from 'next/link'

interface Author {
  user: {
    user_uuid: string
    avatar_image: string
    first_name: string
    last_name: string
    username: string
  }
  authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
  authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
}

interface CourseRun {
  status: string
  course_id: string
}

interface Course {
  id: string
  course_uuid: string
  authors: Author[]
  trail?: {
    runs: CourseRun[]
  }
  chapters?: Array<{
    name: string
    activities: Array<{
      activity_uuid: string
      name: string
      activity_type: string
    }>
  }>
}

interface CourseActionsMobileProps {
  courseuuid: string
  orgslug: string
  course: Course & {
    org_id: number
  }
  trailData?: any
}

// Component for displaying multiple authors
const MultipleAuthors = ({ authors }: { authors: Author[] }) => {
  if (!authors.length) return null
  const displayedAvatars = authors.slice(0, 3)
  const remainingCount = Math.max(0, authors.length - 3)
  
  // Avatar size for mobile
  const avatarSize = 36
  const borderSize = "border-2"

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-3 relative">
        {displayedAvatars.map((author, index) => (
          <div
            key={author.user.user_uuid}
            className="relative"
            style={{ zIndex: displayedAvatars.length - index }}
          >
            <UserAvatar
              border={borderSize}
              rounded='rounded-full'
              avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
              predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
              width={avatarSize}
            />
          </div>
        ))}
        {remainingCount > 0 && (
          <div 
            className="relative"
            style={{ zIndex: 0 }}
          >
            <div 
              className="flex items-center justify-center bg-neutral-100 text-neutral-600 font-medium rounded-full border-2 border-white shadow-sm"
              style={{ 
                width: `${avatarSize}px`, 
                height: `${avatarSize}px`,
                fontSize: '12px'
              }}
            >
              +{remainingCount}
            </div>
          </div>
        )}
      </div>
      
      <div className="flex flex-col">
        <span className="text-xs text-neutral-400 font-medium">
          {authors.length > 1 ? 'Authors' : 'Author'}
        </span>
        {authors.length === 1 ? (
          <span className="text-sm font-semibold text-neutral-800">
            {authors[0].user.first_name && authors[0].user.last_name 
              ? `${authors[0].user.first_name} ${authors[0].user.last_name}` 
              : `@${authors[0].user.username}`}
          </span>
        ) : (
          <span className="text-sm font-semibold text-neutral-800">
            {authors[0].user.first_name && authors[0].user.last_name
              ? `${authors[0].user.first_name} ${authors[0].user.last_name}`
              : `@${authors[0].user.username}`}
            {authors.length > 1 && ` & ${authors.length - 1} more`}
          </span>
        )}
      </div>
    </div>
  )
}

const CourseActionsMobile = ({ courseuuid, orgslug, course, trailData }: CourseActionsMobileProps) => {
  const router = useRouter()
  const session = useLHSession() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const org = useOrg() as any
  const [isActionLoading, setIsActionLoading] = useState(false)
  // Clean up course UUID by removing 'course_' prefix if it exists
  const cleanCourseUuid = course.course_uuid?.replace('course_', '');
  const resourceUuid = cleanCourseUuid ? `course_${cleanCourseUuid}` : null;

  const isStarted = trailData?.runs?.find(
    (run: any) => {
      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
      return cleanRunCourseUuid === cleanCourseUuid;
    }
  ) ?? false;

  // Public endpoint — no auth needed, works for unauthenticated visitors too
  const { data: offersResult, isLoading } = useSWR(
    org && resourceUuid ? [`/offers/by-resource`, org.id, resourceUuid] : null,
    ([, orgId, uuid]) => getOffersByResource(orgId, uuid)
  );
  const linkedOffers: any[] = offersResult?.data ?? [];

  const handleCourseAction = async () => {
    if (!session.data?.user) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    // Check if user is part of the organization
    if (!isUserPartOfTheOrg) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    setIsActionLoading(true)
    try {
      if (isStarted) {
        await removeCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        await revalidateTags(['courses'], orgslug)
        router.refresh()
      } else {
        await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        await revalidateTags(['courses'], orgslug)
        
        // Get the first activity from the first chapter
        const firstChapter = course.chapters?.[0]
        const firstActivity = firstChapter?.activities?.[0]
        
        if (firstActivity) {
          // Redirect to the first activity
          await revalidateTags(['activities'], orgslug)
          router.push(
            getUriWithOrg(orgslug, '') +
            `/course/${courseuuid}/activity/${firstActivity.activity_uuid.replace('activity_', '')}`
          )
        } else {
          router.refresh()
        }
      }
    } catch (error) {
      console.error('Failed to perform course action:', error)
    } finally {
      setIsActionLoading(false)
      await revalidateTags(['courses'], orgslug)
    }
  }

  if (isLoading) {
    return <div className="animate-pulse h-16 bg-gray-100 rounded-lg mt-4 mb-8" />
  }

  // Show join organization prompt for authenticated users who are not part of the org
  if (session.data?.user && !isUserPartOfTheOrg) {
    return (
      <div className="bg-white/90 backdrop-blur-sm shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4 my-6 mx-2">
        <div className="flex flex-col space-y-3">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-800" />
              <span className="text-amber-800 text-sm font-semibold">Organization Membership Required</span>
            </div>
            <p className="text-amber-700 text-xs mt-1">
              You need to join this organization to enroll in courses.
            </p>
          </div>
          <a
            href={getUriWithOrg(orgslug, '/signup')}
            className="w-full py-2 px-4 rounded-lg bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Join Organization
          </a>
        </div>
      </div>
    )
  }

  // Filter active authors and sort by role priority
  const sortedAuthors = [...course.authors]
    .filter(author => author.authorship_status === 'ACTIVE')
    .sort((a, b) => {
      const rolePriority: Record<string, number> = {
        'CREATOR': 0,
        'MAINTAINER': 1,
        'CONTRIBUTOR': 2,
        'REPORTER': 3
      };
      return rolePriority[a.authorship] - rolePriority[b.authorship];
    });

  return (
    <div className="bg-white/90 backdrop-blur-sm shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4 my-6 mx-2">
      <div className="flex flex-col space-y-4">
        <MultipleAuthors authors={sortedAuthors} />
        
        {linkedOffers.length > 0 ? (() => {
          const offer = linkedOffers[0];
          const formattedPrice = offer?.amount != null
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency ?? 'USD' }).format(offer.amount)
            : null;
          const storeHref = org?.slug ? getUriWithOrg(org.slug, `/store/offers/${offer.offer_id}`) : '#';

          return (
            <div className="space-y-3">
              {!!isStarted ? (
                <>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-green-800 text-sm font-semibold">You Own This Course</span>
                    </div>
                  </div>
                  <button
                    onClick={handleCourseAction}
                    disabled={isActionLoading}
                    className="w-full py-2 px-4 rounded-lg bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:bg-red-400"
                  >
                    {isActionLoading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <LogOut className="w-4 h-4" />
                        Leave Course
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-gray-600" />
                      <div>
                        <span className="text-gray-900 text-sm font-semibold">{offer.offer_name}</span>
                        {formattedPrice && (
                          <p className="text-gray-500 text-xs">{formattedPrice}{offer.offer_type === 'subscription' ? ' / month' : ' one-time'}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <Link href={storeHref}>
                    <button className="w-full py-2 px-4 rounded-lg bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2">
                      <ShoppingCart className="w-4 h-4" />
                      {formattedPrice ? `Get Access — ${formattedPrice}` : 'Purchase Course'}
                    </button>
                  </Link>
                </>
              )}
            </div>
          );
        })() : (
          <button
            onClick={handleCourseAction}
            disabled={isActionLoading}
            className={`w-full py-2 px-4 rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
              isStarted
                ? 'bg-red-500 text-white hover:bg-red-600 disabled:bg-red-400'
                : 'bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-700'
            }`}
          >
            {isActionLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : !session.data?.user ? (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            ) : isStarted ? (
              <>
                <LogOut className="w-4 h-4" />
                Leave Course
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Start Course
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export default CourseActionsMobile 