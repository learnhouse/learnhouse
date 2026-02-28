import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { planMeetsRequirement, PlanLevel } from '@services/plans/plans'
import { Books, Signpost, SquaresFour, ChatsCircle, Headphones, FileText, Cube, ShoppingBag } from '@phosphor-icons/react'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'

function MenuLinks(props: { orgslug: string; primaryColor?: string }) {
  const org = useOrg() as any
  const plan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  // Check if feature is enabled AND plan allows it
  const isCommunitiesEnabled = org?.config?.config?.features?.communities?.enabled !== false
  const canAccessCommunities = planMeetsRequirement(plan, 'standard')
  const showCommunities = isCommunitiesEnabled && canAccessCommunities

  const isCollectionsEnabled = org?.config?.config?.features?.collections?.enabled !== false

  // Courses feature flag (also controls trail/progress since it depends on courses)
  const isCoursesEnabled = org?.config?.config?.features?.courses?.enabled !== false

  // Podcasts requires standard+ plan AND feature enabled
  const isPodcastsFeatureEnabled = org?.config?.config?.features?.podcasts?.enabled === true
  const canAccessPodcasts = planMeetsRequirement(plan, 'standard')
  const showPodcasts = isPodcastsFeatureEnabled && canAccessPodcasts

  // Docs requires pro+ plan AND feature enabled
  const isDocsFeatureEnabled = org?.config?.config?.features?.docs?.enabled === true
  const canAccessDocs = planMeetsRequirement(plan, 'pro')
  const showDocs = isDocsFeatureEnabled && canAccessDocs

  // Playgrounds requires pro+ plan AND feature enabled
  const isPlaygroundsFeatureEnabled = org?.config?.config?.features?.playgrounds?.enabled !== false
  const canAccessPlaygrounds = planMeetsRequirement(plan, 'pro')
  const showPlaygrounds = isPlaygroundsFeatureEnabled && canAccessPlaygrounds

  // Store — shown when payments feature is enabled
  const isPaymentsEnabled = org?.config?.config?.features?.payments?.enabled === true
  const showStore = isPaymentsEnabled

  return (
    <div className='pl-1'>
      <ul className="flex space-x-5">
        {isCoursesEnabled && (
          <LinkItem
            link="/courses"
            type="courses"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {isCollectionsEnabled && (
          <LinkItem
            link="/collections"
            type="collections"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {showPodcasts && (
          <LinkItem
            link="/podcasts"
            type="podcasts"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {showDocs && (
          <LinkItem
            link="/docs"
            type="docs"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {showCommunities && (
          <LinkItem
            link="/communities"
            type="communities"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {showPlaygrounds && (
          <LinkItem
            link="/playgrounds"
            type="playgrounds"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {showStore && (
          <LinkItem
            link="/store"
            type="store"
            orgslug={props.orgslug}
            primaryColor={props.primaryColor}
          ></LinkItem>
        )}
        {isCoursesEnabled && (
          <AuthenticatedClientElement checkMethod="authentication">
            <LinkItem
              link="/trail"
              type="trail"
              orgslug={props.orgslug}
              primaryColor={props.primaryColor}
            ></LinkItem>
          </AuthenticatedClientElement>
        )}
      </ul>
    </div>
  )
}
const LinkItem = (props: any) => {
  const { t } = useTranslation()
  const link = props.link
  const orgslug = props.orgslug
  const colors = getMenuColorClasses(props.primaryColor || '')
  const textColorClass = colors.text
  return (
    <Link href={getUriWithOrg(orgslug, link)}>
      <li className={`flex space-x-2 items-center ${textColorClass} font-semibold`}>
        {props.type == 'courses' && (
          <>
            <Books size={20} weight="fill" />{' '}
            <span>{t('courses.courses')}</span>
          </>
        )}

        {props.type == 'collections' && (
          <>
            <SquaresFour size={20} weight="fill" />{' '}
            <span>{t('collections.collections')}</span>
          </>
        )}

        {props.type == 'trail' && (
          <>
            <Signpost size={20} weight="fill" />{' '}
            <span>{t('courses.progress')}</span>
          </>
        )}

        {props.type == 'podcasts' && (
          <>
            <Headphones size={20} weight="fill" />{' '}
            <span>{t('podcasts.podcasts')}</span>
          </>
        )}

        {props.type == 'communities' && (
          <>
            <ChatsCircle size={20} weight="fill" />{' '}
            <span>{t('communities.title')}</span>
          </>
        )}

        {props.type == 'docs' && (
          <>
            <FileText size={20} weight="fill" />{' '}
            <span>{t('docs.docs')}</span>
          </>
        )}

        {props.type == 'playgrounds' && (
          <>
            <Cube size={20} weight="fill" />{' '}
            <span>Playgrounds</span>
          </>
        )}

        {props.type == 'store' && (
          <>
            <ShoppingBag size={20} weight="fill" />{' '}
            <span>Store</span>
          </>
        )}

      </li>
    </Link>
  )
}
export default MenuLinks
