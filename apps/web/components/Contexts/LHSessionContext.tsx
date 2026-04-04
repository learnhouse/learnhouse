'use client'
import PageLoading from '@components/Objects/Loaders/PageLoading';
import { useSession } from '@components/Contexts/AuthContext';
import React, { useContext, createContext } from 'react'

export const SessionContext = createContext({}) as any

/**
 * Provides session context to all children. Does NOT block rendering —
 * children receive session data (including loading state) and decide
 * how to handle it themselves.
 */
function LHSessionProvider({ children }: { children: React.ReactNode }) {
    const session = useSession();

    return (
        <SessionContext.Provider value={session}>
            {children}
        </SessionContext.Provider>
    )
}

/**
 * Blocks rendering with a loading spinner until the session is ready.
 * Wrap page layouts that need guaranteed session data before rendering.
 * Pages with custom skeletons (like the editor) should NOT use this.
 */
export function SessionGate({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
    const session = useContext(SessionContext) as any

    if (session && session.status === 'loading') {
        return fallback ? <>{fallback}</> : <PageLoading />
    }

    return <>{children}</>
}

export function useLHSession() {
    return useContext(SessionContext)
}

export default LHSessionProvider
