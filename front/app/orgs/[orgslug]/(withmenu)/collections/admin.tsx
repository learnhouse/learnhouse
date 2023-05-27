'use client';

import { AuthContext } from '@components/Security/AuthProvider';
import { deleteCollection } from '@services/courses/collections';
import { revalidateTags } from '@services/utils/ts/requests';
import { Link, Trash } from 'lucide-react';
import React from 'react'

const CollectionAdminEditsArea = (props: any) => {
    const org_roles_values = ["admin", "owner"];
    const user_roles_values = ["role_admin"];
    console.log("props: ", props);

    const auth: any = React.useContext(AuthContext);
    console.log("auth: ", auth);


    // this is amazingly terrible code, but gotta release that MVP
    // TODO: fix this

    function isAuthorized() {
        const org_id = props.collection.org_id;
        const org_roles = auth.userInfo.user_object.orgs;
        const user_roles = auth.userInfo.user_object.roles;
        const org_role = org_roles.find((org: any) => org.org_id == org_id);
        const user_role = user_roles.find((role: any) => role.org_id == org_id);

        if (org_role && user_role) {
            if (org_roles_values.includes(org_role.org_role) && user_roles_values.includes(user_role.role_id)) {
                return true;
            }
            else {
                return false;
            }
        } else {
            return false;
        }
    }

    const deleteCollectionUI = async (collectionId: number) => {
        await deleteCollection(collectionId);
        revalidateTags(["collections"]);
        // reload the page
        window.location.reload();
    }

    // this is amazingly terrible code, but gotta release that MVP
    // TODO: fix this

    if (auth.isAuthenticated) {
        if (isAuthorized()) {
            return (
                <div className="flex space-x-2 py-2">
                    <button className="rounded-md text-sm px-3 font-bold text-red-800 bg-red-200 w-16 flex justify-center items-center" onClick={() => deleteCollectionUI(props.collection_id)}>
                        Delete <Trash size={10}></Trash>
                    </button>
                    
                </div>
            )
        } else {
            return (
                <div></div>
            )
        }
    }
    else {
        return (
            <div></div>
        )
    }
}

export default CollectionAdminEditsArea;