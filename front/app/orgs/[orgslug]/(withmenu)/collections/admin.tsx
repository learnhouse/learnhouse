'use client';

import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement';
import { AuthContext } from '@components/Security/AuthProvider';
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal';
import { getUriWithOrg } from '@services/config/config';
import { deleteCollection } from '@services/courses/collections';
import { revalidateTags } from '@services/utils/ts/requests';
import { Link, Trash, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React from 'react'

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
            <div className="flex space-x-2 relative top-8 z-20 left-2">
                <ConfirmationModal
                    confirmationMessage="Are you sure you want to delete this collection?"
                    confirmationButtonText="Delete Collection"
                    dialogTitle={"Delete " + props.collection.name + " ?"}
                    dialogTrigger={
                        <div
                            className=" hover:cursor-pointer p-1 px-4 bg-red-600 rounded-md"
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

export default CollectionAdminEditsArea;