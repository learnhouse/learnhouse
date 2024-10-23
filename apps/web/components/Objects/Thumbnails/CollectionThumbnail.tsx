'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCollection } from '@services/courses/collections'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

type PropsType = {
  collection: any
  orgslug: string
  org_id: string
}

const removeCollectionPrefix = (collectionid: string) => {
  return collectionid.replace('collection_', '')
}

function CollectionThumbnail(props: PropsType) {
  const org = useOrg() as any
  return (
    <div className="group relative overflow-hidden rounded-xl shadow-lg transition-all duration-300 hover:shadow-xl">
      <div className="flex h-full w-full items-center justify-between bg-indigo-600 p-4">
        <div className="flex items-center space-x-5">
          <div className="flex -space-x-3">
            {props.collection.courses.slice(0, 3).map((course: any, index: number) => (
              <div
                key={course.course_uuid}
                className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-white shadow-md transition-all duration-300 hover:z-10 hover:scale-110"
                style={{
                  backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                    org?.org_uuid,
                    course.course_uuid,
                    course.thumbnail_image
                  )})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  zIndex: 3 - index,
                }}
              ></div>
            ))}
          </div>
          <div className="flex flex-col">
            <Link
              href={getUriWithOrg(
                props.orgslug,
                '/collection/' + removeCollectionPrefix(props.collection.collection_uuid)
              )}
              className="text-2xl font-bold text-white hover:underline"
            >
              {props.collection.name}
            </Link>
            <span className="mt-1 text-sm font-medium text-indigo-200">
              {props.collection.courses.length} course{props.collection.courses.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <CollectionAdminEditsArea
          orgslug={props.orgslug}
          org_id={props.org_id}
          collection_uuid={props.collection.collection_uuid}
          collection={props.collection}
        />
      </div>
    </div>
  )
}

const CollectionAdminEditsArea = (props: any) => {
  const router = useRouter()
  const session = useLHSession() as any;

  const deleteCollectionUI = async (collectionId: number) => {
    await deleteCollection(collectionId, session.data?.tokens?.access_token)
    await revalidateTags(['collections'], props.orgslug)
    // reload the page
    router.refresh()
  }

  return (
    <AuthenticatedClientElement
      action="delete"
      ressourceType="collections"
      orgId={props.org_id}
      checkMethod="roles"
    >
      <div className="z-20">
        <ConfirmationModal
          confirmationMessage="Are you sure you want to delete this collection?"
          confirmationButtonText="Delete Collection"
          dialogTitle={'Delete ' + props.collection.name + '?'}
          dialogTrigger={
            <button
              className="absolute right-2 top-2 rounded-full bg-red-500 p-2 text-white transition-colors duration-300 hover:bg-red-600"
              rel="noopener noreferrer"
            >
              <X size={18} />
            </button>
          }
          functionToExecute={() => deleteCollectionUI(props.collection_uuid)}
          status="warning"
        ></ConfirmationModal>
      </div>
    </AuthenticatedClientElement>
  )
}

export default CollectionThumbnail
