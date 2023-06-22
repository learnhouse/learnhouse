'use client';
import React from "react";
import { AuthContext } from "./AuthProvider";

interface AuthenticatedClientElementProps {
    children: React.ReactNode;
    checkMethod: 'authentication' | 'roles';
    orgId?: string;

}

function AuthenticatedClientElement(props: AuthenticatedClientElementProps) {
    const auth: any = React.useContext(AuthContext);

    // Available roles 
    const org_roles_values = ["admin", "owner"];
    const user_roles_values = ["role_admin"];


    async function checkRoles() {
        const org_id = props.orgId;
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



    if ((props.checkMethod == 'authentication' && auth.isAuthenticated) || (auth.isAuthenticated && props.checkMethod == 'roles' && checkRoles())) {
        return <>{props.children}</>;
    }
    return <></>;


}

export default AuthenticatedClientElement