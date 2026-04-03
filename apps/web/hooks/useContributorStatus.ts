import { useMemo } from 'react';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getAPIUrl } from '@services/config/config';
import { swrFetcher } from '@services/utils/ts/requests';
import useSWR from 'swr';

export type ContributorStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'INACTIVE';

interface Contributor {
  user_id: string;
  authorship_status: ContributorStatus;
}

export function useContributorStatus(courseUuid: string) {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const userId = session?.data?.user?.id;

  const prefixedUuid = courseUuid?.startsWith('course_') ? courseUuid : 'course_' + courseUuid;
  const swrKey = access_token && courseUuid
    ? `${getAPIUrl()}courses/${prefixedUuid}/contributors`
    : null;

  const { data, isLoading, mutate } = useSWR(
    swrKey,
    (url) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  );

  const contributorStatus = useMemo<ContributorStatus>(() => {
    if (!userId || !data || !Array.isArray(data)) return 'NONE';
    const currentUser = data.find(
      (contributor: Contributor) => contributor.user_id === userId
    );
    return currentUser ? (currentUser.authorship_status as ContributorStatus) : 'NONE';
  }, [data, userId]);

  return { contributorStatus, isLoading, refetch: mutate };
}
