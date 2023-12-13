'use client';
import React from "react";
import { AuthContext } from "./AuthProviderDepreceated";
import useSWR, { mutate } from "swr";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/ts/requests";

interface AuthenticatedClientElementProps {
    children: React.ReactNode;
    checkMethod: 'authentication' | 'roles';
    orgId?: string;
    ressourceType?: 'collection' | 'course' | 'activity' | 'user' | 'organization';
    action?: 'create' | 'update' | 'delete' | 'read';
}

function generateRessourceId(ressourceType: string) {
    // for every type of ressource, we need to generate a ressource id, example for a collection: col_XXXXX 
    if (ressourceType == 'collection') {
        return `collection_xxxx`
    }
    else if (ressourceType == 'course') {
        return `course_xxxx`
    }
    else if (ressourceType == 'activity') {
        return `activity_xxxx`
    }
    else if (ressourceType == 'user') {
        return `user_xxxx`
    }
    else if (ressourceType == 'organization') {
        return `org_xxxx`
    }
    else if (ressourceType === null) {
        return `n/a`
    }
}

export const AuthenticatedClientElement = (props: AuthenticatedClientElementProps) => {
    const auth: any = React.useContext(AuthContext);
    const { data: authorization_status, error: error } = useSWR(props.checkMethod == 'roles' && props.ressourceType ? `${getAPIUrl()}users/authorize/ressource/${generateRessourceId(props.ressourceType)}/action/${props.action}` : null, swrFetcher);
    console.log(authorization_status);

    if ((props.checkMethod == 'authentication' && auth.isAuthenticated) || (auth.isAuthenticated && props.checkMethod == 'roles' && authorization_status)) {
        return <>{props.children}</>;
    }
    return <></>;


}

export default AuthenticatedClientElement