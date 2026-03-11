import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { Books, SquaresFour, ChatsCircle, Headphones, Cube, ShoppingBag } from '@phosphor-icons/react'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'

function MenuLinks(props: { orgslug: string; primaryColor?: string }) {
  const org = useOrg() as any

  // Feature visibility: resolved_features from API is the source of truth
  const rf = org?.config?.config?.resolved_features
  const isEnabled = (feature: string) => rf?.[feature]?.enabled === true

  const isCoursesEnabled = isEnabled('courses')
  const isCollectionsEnabled = isEnabled('collections')
  const showCommunities = isEnabled('communities')
  const showPodcasts = isEnabled('podcasts')
  const showPlaygrounds = isEnabled('playgrounds')
  const showStore = isEnabled('payments')

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
