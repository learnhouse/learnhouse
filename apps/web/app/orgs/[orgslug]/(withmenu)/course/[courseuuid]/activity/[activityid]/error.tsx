'use client' // Error components must be Client Components

import ErrorUI from '@components/Objects/StyledElements/Error/Error'
import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)

    // Check if it's a Server Action version mismatch error
    if (error.message.includes('Failed to find Server Action') || 
        error.message.includes('older or newer deployment')) {
      window.location.reload()
    }
  }, [error])

  return (
    <div>
      <ErrorUI></ErrorUI>
    </div>
  )
}
