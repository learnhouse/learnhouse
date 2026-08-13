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
  // `null` is "not decided yet", distinct from a decided `false`. The decision
  // is made in an effect, which runs after the commit — so a `false` initial
  // state paints the denial page for a frame on every load, including for the
  // admins about to be let in. Only `false` means denied.
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

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
      // Left undecided on purpose: the /login navigation is in flight, and a
      // signed-out visitor should not be told they lack permission on the way
      // out. The loading state below covers the gap.
      //
      // org can still be null here (its fetch is client-side and may not have
      // landed); getUriWithOrg tolerates an empty slug, dereferencing does not.
      router.push(getUriWithOrg(org?.slug ?? '', '/login'));
      return;
    }

    if (authorizationMode === 'page') {
      if (isAdminPath) {
        // No redirect on denial: pushing to /dash raced the render below, so the
        // message only flashed and the user never learned why.
        setIsAuthorized(isAdmin === true);
      } else {
        setIsAuthorized(true);
      }
    } else if (authorizationMode === 'component') {
      setIsAuthorized(isAdmin === true);
    }
  }, [loading, isUserAuthenticated, isAdmin, isAdminPath, authorizationMode, router]);

  useEffect(() => {
    authorizeUser();
  }, [authorizeUser]);

  // Undecided counts as loading, but only in page mode — component mode renders
  // inline (the sidebar, the dashboard home), where a full-screen spinner in
  // place of the component would be worse than rendering nothing.
  if (loading || (authorizationMode === 'page' && isAuthorized === null)) {
    return (
      <div className="flex justify-center items-center h-screen">
        <PageLoading />
      </div>
    );
  }

  if (authorizationMode === 'page' && isAuthorized === false) {
    // 403 is what classifyError matches to the catalog's `permission` category,
    // which supplies the copy and the Home / sign out / report actions.
    return <ErrorUI error={{ status: 403, message: 'admin_only' }} />;
  }

  return <>{isAuthorized && children}</>;
};

export default AdminAuthorization;
