import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { planMeetsRequirement, PlanLevel } from '@services/plans/plans'
import { Books, Signpost, SquaresFour, ChatsCircle } from '@phosphor-icons/react'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'

function MenuLinks(props: { orgslug: string }) {
  const org = useOrg() as any
  const plan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  // Check if feature is enabled AND plan allows it
  const isCommunitiesEnabled = org?.config?.config?.features?.communities?.enabled !== false
  const canAccessCommunities = planMeetsRequirement(plan, 'standard')
  const showCommunities = isCommunitiesEnabled && canAccessCommunities

  const isCollectionsEnabled = org?.config?.config?.features?.collections?.enabled !== false

  return (
    <div className='pl-1'>
      <ul className="flex space-x-5">
        <LinkItem
          link="/courses"
          type="courses"
          orgslug={props.orgslug}
        ></LinkItem>
        {isCollectionsEnabled && (
          <LinkItem
            link="/collections"
            type="collections"
            orgslug={props.orgslug}
          ></LinkItem>
        )}
        {showCommunities && (
          <LinkItem
            link="/communities"
            type="communities"
            orgslug={props.orgslug}
          ></LinkItem>
        )}
        <AuthenticatedClientElement checkMethod="authentication">
          <LinkItem
            link="/trail"
            type="trail"
            orgslug={props.orgslug}
          ></LinkItem>
        </AuthenticatedClientElement>
      </ul>
    </div>
  )
}
const LinkItem = (props: any) => {
  const { t } = useTranslation()
  const link = props.link
  const orgslug = props.orgslug
  return (
    <Link href={getUriWithOrg(orgslug, link)}>
      <li className="flex space-x-2 items-center text-gray-700 font-semibold">
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

        {props.type == 'communities' && (
          <>
            <ChatsCircle size={20} weight="fill" />{' '}
            <span>Communities</span>
          </>
        )}
      </li>
    </Link>
  )
}
export default MenuLinks
