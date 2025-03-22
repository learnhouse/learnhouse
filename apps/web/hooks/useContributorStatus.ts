import { useState, useEffect } from 'react';
import { getCourseContributors } from '@services/courses/courses';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import toast from 'react-hot-toast';

export type ContributorStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'INACTIVE';

export function useContributorStatus(courseUuid: string) {
  const session = useLHSession() as any;
  const [contributorStatus, setContributorStatus] = useState<ContributorStatus>('NONE');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkContributorStatus = async () => {
      if (!session.data?.user) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await getCourseContributors(
          'course_' + courseUuid,
          session.data?.tokens?.access_token
        );
        
        if (response && response.data) {
          const currentUser = response.data.find(
            (contributor: any) => contributor.user_id === session.data.user.id
          );
          
          if (currentUser) {
            setContributorStatus(currentUser.authorship_status as ContributorStatus);
          } else {
            setContributorStatus('NONE');
          }
        }
      } catch (error) {
        console.error('Failed to check contributor status:', error);
        toast.error('Failed to check contributor status');
      } finally {
        setIsLoading(false);
      }
    };

    if (session.data?.user) {
      checkContributorStatus();
    }
  }, [courseUuid, session.data?.tokens?.access_token, session.data?.user]);

  return { contributorStatus, isLoading };
} 