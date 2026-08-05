'use client';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import useAdminStatus from '@components/Hooks/useAdminStatus';
import { usePathname, useRouter } from 'next/navigation';
import PageLoading from '@components/Objects/Loaders/PageLoading';
import { getUriWithOrg } from '@services/config/config';
import { useOrg } from '@components/Contexts/OrgContext';
import ErrorUI from '@components/Objects/StyledElements/Error/Error';

type AuthorizationProps = {
  children: React.ReactNode;
  authorizationMode: 'component' | 'page';
};

// This component wraps the whole dashboard layout, so gate all of it: the old
// allow-list named 3 sections and left /dash plus 10 others open to any member.
const ADMIN_PATH_PREFIX = '/dash';

const AdminAuthorization: React.FC<AuthorizationProps> = ({ children, authorizationMode }) => {
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, loading } = useAdminStatus() as any
  const [isAuthorized, setIsAuthorized] = useState(false);

  const isUserAuthenticated = useMemo(() => session.status === 'authenticated', [session.status]);

  const isAdminPath = useMemo(() => {
    if (typeof pathname !== 'string') return false;
    // The trailing check keeps a hypothetical sibling like /dashboard out.
    return pathname === ADMIN_PATH_PREFIX || pathname.startsWith(`${ADMIN_PATH_PREFIX}/`);
  }, [pathname]);

  const authorizeUser = useCallback(() => {
    if (loading) {
      return; // Wait until the admin status is determined
    }

    if (!isUserAuthenticated) {
      // org can still be null here (its fetch is client-side and may not have
      // landed); getUriWithOrg tolerates an empty slug, dereferencing does not.
      router.push(getUriWithOrg(org?.slug ?? '', '/login'));
      return;
    }

    if (authorizationMode === 'page') {
      if (isAdminPath) {
        // No redirect on denial: pushing to /dash raced the render below, so the
        // message only flashed and the user never learned why.
        setIsAuthorized(isAdmin);
      } else {
        setIsAuthorized(true);
      }
    } else if (authorizationMode === 'component') {
      setIsAuthorized(isAdmin);
    }
  }, [loading, isUserAuthenticated, isAdmin, isAdminPath, authorizationMode, router]);

  useEffect(() => {
    authorizeUser();
  }, [authorizeUser]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <PageLoading />
      </div>
    );
  }

  if (authorizationMode === 'page' && !isAuthorized) {
    // 403 is what classifyError matches to the catalog's `permission` category,
    // which supplies the copy and the Home / sign out / report actions.
    return <ErrorUI error={{ status: 403, message: 'admin_only' }} />;
  }

  return <>{isAuthorized && children}</>;
};

export default AdminAuthorization;
