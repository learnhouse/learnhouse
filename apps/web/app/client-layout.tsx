'use client'
import '../styles/globals.css'
import StyledComponentsRegistry from '../components/Utils/libs/styled-registry'
import { motion } from 'framer-motion'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import { SessionProvider } from 'next-auth/react'


import { ReactNode } from 'react';

interface ClientLayoutProps {
  children: ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  const variants = {
    hidden: { opacity: 0, x: 0, y: 0 },
    enter: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: 0, y: 0 },
  }

  return (
    <>
    <SessionProvider>
      <LHSessionProvider>
        <StyledComponentsRegistry>
          <motion.main
            variants={variants} // Pass the variant object into Framer Motion
            initial="hidden" // Set the initial state to variants.hidden
            animate="enter" // Animated state to variants.enter
            exit="exit" // Exit state (used later) to variants.exit
            transition={{ type: 'linear' }} // Set the transition to linear
            className=""
          >
            {children}
          </motion.main>
        </StyledComponentsRegistry>
      </LHSessionProvider>
      </SessionProvider>
    </>
  )
}
