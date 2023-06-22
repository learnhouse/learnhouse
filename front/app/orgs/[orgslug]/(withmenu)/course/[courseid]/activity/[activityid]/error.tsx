'use client'; // Error components must be Client Components

import ErrorUI from '@components/StyledElements/Error/Error';
import { useEffect } from 'react';
 
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);
 
  return (
    <div>
      <ErrorUI></ErrorUI>
    </div>
  );
}