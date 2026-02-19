'use client'

import React, { useEffect, useState } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'

interface PresenceAvatarsProps {
  provider: HocuspocusProvider | null
}

interface AwarenessUser {
  clientId: number
  name: string
  color: string
}

export default function PresenceAvatars({ provider }: PresenceAvatarsProps) {
  const [users, setUsers] = useState<AwarenessUser[]>([])

  useEffect(() => {
    if (!provider) return

    const updateUsers = () => {
      const states = provider.awareness?.getStates()
      if (!states) return

      const connected: AwarenessUser[] = []
      states.forEach((state, clientId) => {
        if (state.user && clientId !== provider.awareness?.clientID) {
          connected.push({
            clientId,
            name: state.user.name || 'Unknown',
            color: state.user.color || '#958DF1',
          })
        }
      })
      setUsers(connected)
    }

    provider.on('awarenessUpdate', updateUsers)
    updateUsers()

    return () => {
      provider.off('awarenessUpdate', updateUsers)
    }
  }, [provider])

  if (users.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      {users.slice(0, 5).map((user) => (
        <div
          key={user.clientId}
          title={user.name}
          className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-white"
          style={{ backgroundColor: user.color }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {users.length > 5 && (
        <div className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-medium bg-gray-200 text-gray-600 ring-2 ring-white">
          +{users.length - 5}
        </div>
      )}
    </div>
  )
}
