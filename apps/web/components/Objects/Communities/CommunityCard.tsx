'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCommunity, Community } from '@services/communities/communities'
import { getCommunityThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { MoreVertical, Users, Trash2, Edit, MessageCircle, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"

type PropsType = {
  community: Community
  orgslug: string
  org_id: string | number
  onEdit?: () => void
  variant?: 'dashboard' | 'public'
}

const removeCommunityPrefix = (communityid: string) => {
  return communityid.replace('community_', '')
}

function CommunityCard(props: PropsType) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const communityId = removeCommunityPrefix(props.community.community_uuid)
  const variant = props.variant || 'dashboard'

  // Different links based on variant
  const communityLink = variant === 'dashboard'
    ? getUriWithOrg(props.orgslug, `/dash/communities/${communityId}/general`)
    : getUriWithOrg(props.orgslug, `/community/${communityId}`)

  return (
    <div
      className="group relative flex flex-col bg-white rounded-xl nice-shadow overflow-hidden w-full transition-all duration-300 hover:scale-[1.01]"
    >
      {variant === 'dashboard' && (
        <CommunityAdminEditsArea
          orgslug={props.orgslug}
          org_id={props.org_id}
          community_uuid={props.community.community_uuid}
          community={props.community}
          onEdit={props.onEdit}
        />
      )}

      <Link
        href={communityLink}
        className="block relative aspect-video overflow-hidden bg-gray-50"
      >
        {props.community.thumbnail_image && org?.org_uuid ? (
          <img
            src={getCommunityThumbnailMediaDirectory(
              org.org_uuid,
              props.community.community_uuid,
              props.community.thumbnail_image
            )}
            alt={props.community.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full text-gray-300 gap-2">
            <Users size={40} strokeWidth={1.5} />
          </div>
        )}
      </Link>

      <div className="p-3 flex flex-col space-y-1.5">
        <Link
          href={communityLink}
          className="text-base font-bold text-gray-900 leading-tight hover:text-black transition-colors line-clamp-1"
        >
          {props.community.name}
        </Link>

        {props.community.description && (
          <p className="text-[11px] text-gray-500 line-clamp-2 min-h-[1.5rem]">
            {props.community.description}
          </p>
        )}

        <div className="pt-1.5 flex items-center justify-between border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-gray-500">
            <MessageCircle size={12} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {props.community.public ? t('courses.public') : t('courses.private')}
            </span>
          </div>

          {variant === 'dashboard' ? (
            <Link
              href={getUriWithOrg(props.orgslug, `/dash/communities/${communityId}/general`)}
              className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
            >
              {t('dashboard.courses.communities.card.open_settings')}
            </Link>
          ) : (
            <Link
              href={communityLink}
              className="text-[10px] font-bold text-gray-400 hover:text-gray-900 transition-colors uppercase tracking-wider"
            >
              {t('dashboard.courses.communities.card.view_community')}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

const CommunityAdminEditsArea = (props: any) => {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any

  const deleteCommunityUI = async () => {
    await deleteCommunity(props.community_uuid, session.data?.tokens?.access_token)
    await revalidateTags(['communities'], props.orgslug)
    router.refresh()
  }

  return (
    <AuthenticatedClientElement
      action="delete"
      ressourceType="communities"
      orgId={props.org_id}
      checkMethod="roles"
    >
      <div className="absolute top-2 right-2 z-20">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <MoreVertical size={18} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link
                href={getUriWithOrg(props.orgslug, `/dash/communities/${removeCommunityPrefix(props.community_uuid)}/general`)}
                className="flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <ExternalLink className="mr-2 h-4 w-4" /> {t('dashboard.courses.communities.card.open_settings')}
              </Link>
            </DropdownMenuItem>
            {props.onEdit && (
              <DropdownMenuItem asChild>
                <button
                  onClick={props.onEdit}
                  className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                >
                  <Edit className="mr-2 h-4 w-4" /> {t('dashboard.courses.communities.card.quick_edit')}
                </button>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationMessage={t('dashboard.courses.communities.modals.delete.message')}
                confirmationButtonText={t('dashboard.courses.communities.modals.delete.button')}
                dialogTitle={t('dashboard.courses.communities.modals.delete.title', { name: props.community.name })}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <Trash2 className="mr-2 h-4 w-4" /> {t('dashboard.courses.communities.modals.delete.button')}
                  </button>
                }
                functionToExecute={deleteCommunityUI}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </AuthenticatedClientElement>
  )
}

export default CommunityCard
