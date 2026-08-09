'use client'
import React from 'react'
import { Toaster } from 'react-hot-toast'

function Toast() {
  return (
    <>
      {/* Toast content is mixed: translated UI copy in the active language, but
          also error text passed straight through from the API, which is English
          whatever the user's language. The lh-toast class applies
          unicode-bidi: plaintext, so each toast resolves direction from its own
          text — an English backend message stays left-to-right inside an Arabic
          UI instead of bidi-scrambling. */}
      <Toaster toastOptions={{ className: 'lh-toast' }} />
    </>
  )
}

export default Toast
