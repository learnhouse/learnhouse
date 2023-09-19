"use client";
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
    return (
        <div className='relative'>
            <CollectionAdminEditsArea orgslug={props.orgslug} org_id={props.org_id} collection_id={props.collection.collection_id} collection={props.collection} />
            <Link href={getUriWithOrg(props.orgslug, "/collection/" + removeCollectionPrefix(props.collection.collection_id))}>
                <div className="space-y-2 inset-0 ring-1 ring-inset my-auto ring-black/10 rounded-xl shadow-xl relative w-[249px] h-[180px] bg-cover flex flex-col items-center justify-center bg-indigo-600 font-bold text-zinc-50" >
                    <div className="flex -space-x-5">
                        {props.collection.courses.slice(0, 3).map((course: any) => (
                            <Link key={course.course_id} href={getUriWithOrg(props.orgslug, "/course/" + course.course_id.substring(7))}>

                                <div className="inset-0 rounded-xl shadow-xl bg-cover w-24 h-12 justify-center ring-indigo-800 ring-4" style={{ backgroundImage: `url(${getCourseThumbnailMediaDirectory(props.collection.org_id, course.course_id, course.thumbnail)})` }}>

                                </div>
                            </Link>
                        ))}
                    </div>
                    <h1 className="font-bold text-lg justify-center">{props.collection.name}</h1>
                </div>
            </Link>
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
        router.push(getUriWithOrg(props.orgslug, "/collections"));

        // refresh page (FIX for Next.js BUG)
        //window.location.reload();
    }

    return (
        <AuthenticatedClientElement orgId={props.org_id} checkMethod='roles'>
            <div className="flex space-x-1 absolute justify-center mx-auto z-20 bottom-4 left-1/2 transform -translate-x-1/2">
                <ConfirmationModal
                    confirmationMessage="Are you sure you want to delete this collection?"
                    confirmationButtonText="Delete Collection"
                    dialogTitle={"Delete " + props.collection.name + " ?"}
                    dialogTrigger={
                        <div
                            className="hover:cursor-pointer p-1 px-4 bg-red-600 rounded-xl items-center justify-center flex shadow-lg"
                            rel="noopener noreferrer">
                            <X size={15} className="text-rose-200 font-bold" />
                        </div>}
                    functionToExecute={() => deleteCollectionUI(props.collection_id)}
                    status='warning'
                ></ConfirmationModal>
            </div>
        </AuthenticatedClientElement>
    )
}

export default CollectionThumbnail