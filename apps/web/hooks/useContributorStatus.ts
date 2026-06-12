import { useMemo } from 'react';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getCourseContributors } from '@services/courses/courses';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';

export type ContributorStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'INACTIVE';

interface Contributor {
  user_id: string | number;
  authorship_status: ContributorStatus;
}

export function useContributorStatus(courseUuid: string) {
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const userId = session?.data?.user?.id;

  const prefixedUuid = courseUuid?.startsWith('course_') ? courseUuid : 'course_' + courseUuid;

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.courses.contributors(prefixedUuid),
    queryFn: () => getCourseContributors(prefixedUuid, access_token),
    select: (res: any) => (Array.isArray(res) ? res : res?.data ?? res),
    enabled: !!access_token && !!courseUuid,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const contributorStatus = useMemo<ContributorStatus>(() => {
    if (!userId || !data || !Array.isArray(data)) return 'NONE';
    const currentUser = data.find(
      (contributor: Contributor) => String(contributor.user_id) === String(userId)
    );
    return currentUser ? (currentUser.authorship_status as ContributorStatus) : 'NONE';
  }, [data, userId]);

  return { contributorStatus, isLoading, refetch };
}
