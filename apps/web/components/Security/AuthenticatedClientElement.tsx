'use client';
import React from "react";
import useSWR, { mutate } from "swr";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/ts/requests";
import { useSession } from "@components/Contexts/SessionContext";
import { useOrg } from "@components/Contexts/OrgContext";

interface AuthenticatedClientElementProps {
    children: React.ReactNode;
    checkMethod: 'authentication' | 'roles';
    orgId?: string;
    ressourceType?: 'collections' | 'courses' | 'activities' | 'users' | 'organizations';
    action?: 'create' | 'update' | 'delete' | 'read';
}



export const AuthenticatedClientElement = (props: AuthenticatedClientElementProps) => {
    const [isAllowed, setIsAllowed] = React.useState(false);
    const session = useSession() as any;
    const org = useOrg() as any;
    

    function isUserAllowed(roles: any[], action: string, resourceType: string, org_uuid: string): boolean {
        // Iterate over the user's roles
        for (const role of roles) {
           
            // Check if the role is for the right organization
            if (role.org.org_uuid === org_uuid) {
                // Check if the user has the role for the resource type
                if (role.role.rights && role.role.rights[resourceType]) {

                
                    // Check if the user is allowed to execute the action
                    const actionKey = `action_${action}`;
                    if (role.role.rights[resourceType][actionKey] === true) {
                        return true;
                    }
                }
            }
        }

        // If no role matches the organization, resource type, and action, return false
        return false;
    }

    function check() {

        if (props.checkMethod === 'authentication') {
            setIsAllowed(session.isAuthenticated);
        } else if (props.checkMethod === 'roles') {
            return setIsAllowed(isUserAllowed(session.roles, props.action!, props.ressourceType!, org.org_uuid));
        }

    }

    React.useEffect(() => {
        if (session.isLoading) {
            return;
        }

        check();
    }, [session, org])

    return (
        <>
            {isAllowed && props.children}
        </>
    )


}

export default AuthenticatedClientElement