"use client";
import { useOrg } from '@components/Contexts/OrgContext';
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import { getUriWithOrg } from '@services/config/config'
import { deleteCollection } from '@services/courses/collections'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { revalidateTags } from '@services/utils/ts/requests'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

type PropsType = {
    collection: any,
    orgslug: string,
    org_id: string
}

const removeCollectionPrefix = (collectionid: string) => {
    return collectionid.replace("collection_", "")
}

function CollectionThumbnail(props: PropsType) {
    const org = useOrg() as any;
    return (
        <div className=''>
            <div className="flex flex-row space-x-4 inset-0 ring-1 ring-inset my-auto ring-black/10 rounded-xl shadow-xl relative w-[300px] h-[80px] bg-cover items-center justify-center bg-indigo-600 font-bold text-zinc-50" >
                <div className="flex -space-x-5">
                    {props.collection.courses.slice(0, 2).map((course: any) => (
                        <>
                            <Link href={getUriWithOrg(props.orgslug, "/collection/" + removeCollectionPrefix(props.collection.collection_uuid))}>
                                <div className="inset-0 rounded-full shadow-2xl bg-cover w-12 h-8 justify-center ring-indigo-800 ring-4" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)})` }}>
                                </div>
                            </Link>
                        </>
                    ))}
                </div>
                <Link href={getUriWithOrg(props.orgslug, "/collection/" + removeCollectionPrefix(props.collection.collection_uuid))}>
                    <h1 className="font-bold text-md justify-center">{props.collection.name}</h1>
                </Link>
                <CollectionAdminEditsArea orgslug={props.orgslug} org_id={props.org_id} collection_uuid={props.collection.collection_uuid} collection={props.collection} />
            </div>
        </div>
    )
}

const CollectionAdminEditsArea = (props: any) => {
    const router = useRouter();

    const deleteCollectionUI = async (collectionId: number) => {
        await deleteCollection(collectionId);
        await revalidateTags(["collections"], props.orgslug);
        // reload the page
        router.refresh();
    }

    return (
        <AuthenticatedClientElement 
        action="delete"
        ressourceType="collection"
        orgId={props.org_id} checkMethod='roles'>
            <div className="flex space-x-1  justify-center mx-auto z-20 ">
                <ConfirmationModal
                    confirmationMessage="Are you sure you want to delete this collection?"
                    confirmationButtonText="Delete Collection"
                    dialogTitle={"Delete " + props.collection.name + " ?"}
                    dialogTrigger={
                        <div
                            className="hover:cursor-pointer p-1 px-2 bg-red-600 rounded-xl items-center justify-center flex shadow-xl"
                            rel="noopener noreferrer">
                            <X size={10} className="text-rose-200 font-bold" />
                        </div>}
                    functionToExecute={() => deleteCollectionUI(props.collection_uuid)}
                    status='warning'
                ></ConfirmationModal>
            </div>
        </AuthenticatedClientElement>
    )
}

export default CollectionThumbnail