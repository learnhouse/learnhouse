'use client';

import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement';
import { AuthContext } from '@components/Security/AuthProvider';
import { getUriWithOrg } from '@services/config/config';
import { deleteCollection } from '@services/courses/collections';
import { revalidateTags } from '@services/utils/ts/requests';
import { Link, Trash } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React from 'react'

const CollectionAdminEditsArea = (props: any) => {
    const router = useRouter();

    const deleteCollectionUI = async (collectionId: number) => {
        await deleteCollection(collectionId);
        revalidateTags(["collections"]);
        // reload the page
        router.refresh();
        router.push(getUriWithOrg(props.orgslug, "/collections"));

        // refresh page (FIX for Next.js BUG)
        window.location.reload();
    }

    return (
        <AuthenticatedClientElement orgId={props.org_id} checkMethod='roles'>
            <div className="flex space-x-2 py-2">
                <button className="rounded-md text-sm px-3 font-bold text-red-800 bg-red-200 w-16 flex justify-center items-center" onClick={() => deleteCollectionUI(props.collection_id)}>
                    Delete <Trash size={10}></Trash>
                </button>
            </div>
        </AuthenticatedClientElement>
    )
}

export default CollectionAdminEditsArea;