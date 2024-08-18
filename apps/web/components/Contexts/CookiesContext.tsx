'use client'
import Cookies from 'js-cookie';

import React, { useContext, createContext, useEffect } from 'react'

export const CookiesContext = createContext({}) as any

function CookiesProvider({ children }: { children: React.ReactNode }) {
    const cookies = Cookies.get();

    useEffect(() => {
    }, [cookies])

    if (cookies) {
        return (
            <CookiesContext.Provider value={cookies}>
                {children}
            </CookiesContext.Provider>
        )
    }
}

export function useCookies() {
    return useContext(CookiesContext)
}

export default CookiesProvider