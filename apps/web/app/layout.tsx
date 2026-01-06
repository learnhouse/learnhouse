'use client'
import '../styles/globals.css'
import StyledComponentsRegistry from '../components/Utils/libs/styled-registry'
import { motion } from 'framer-motion'
import { SessionProvider } from 'next-auth/react'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import { isDevEnv } from './auth/options'
import Script from 'next/script'
import '../lib/i18n'
import I18nProvider from '@components/Contexts/I18nContext'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const variants = {
    hidden: { opacity: 0, x: 0, y: 0 },
    enter: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: 0, y: 0 },
  }

  return (
    <html className="" lang="en">
      <head />
      <body>
        {/* Inject runtime configuration for client-side access */}
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
        {isDevEnv ? '' : <Script data-website-id="a1af6d7a-9286-4a1f-8385-ddad2a29fcbb" src="/umami/script.js" />}
        <SessionProvider key="session-provider" refetchInterval={60000}>
          <LHSessionProvider>
            <I18nProvider>
              <StyledComponentsRegistry>
                <motion.main
                  variants={variants} // Pass the variant object into Framer Motion
                  initial="hidden" // Set the initial state to variants.hidden
                  animate="enter" // Animated state to variants.enter
                  exit="exit" // Exit state (used later) to variants.exit
                  transition={{ type: 'tween' }} // Set the transition to tween
                >
                  {children}
                </motion.main>
              </StyledComponentsRegistry>
            </I18nProvider>
          </LHSessionProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
