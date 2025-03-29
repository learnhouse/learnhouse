import React, { useEffect, useState } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { MapPin, Building2, Globe, Briefcase, GraduationCap, Link, Users, Calendar, Lightbulb, Loader2, ExternalLink } from 'lucide-react'
import { getUser } from '@services/users/users'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRouter } from 'next/navigation'

type UserProfilePopupProps = {
  children: React.ReactNode
  userId: string
}

type UserData = {
  first_name: string
  last_name: string
  username: string
  bio?: string
  avatar_image?: string
  details?: {
    [key: string]: {
      id: string
      label: string
      icon: string
      text: string
    }
  }
}

const ICON_MAP = {
  'briefcase': Briefcase,
  'graduation-cap': GraduationCap,
  'map-pin': MapPin,
  'building-2': Building2,
  'speciality': Lightbulb,
  'globe': Globe,
  'link': Link,
  'users': Users,
  'calendar': Calendar,
} as const

const UserProfilePopup = ({ children, userId }: UserProfilePopupProps) => {
  const session = useLHSession() as any
  const router = useRouter()
  const [userData, setUserData] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserData = async () => {
      if (!userId) return
      
      setIsLoading(true)
      setError(null)
      
      try {
        const data = await getUser(userId, session?.data?.tokens?.access_token)
        setUserData(data)
      } catch (err) {
        setError('Failed to load user data')
        console.error('Error fetching user data:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchUserData()
  }, [userId, session?.data?.tokens?.access_token])

  const IconComponent = ({ iconName }: { iconName: string }) => {
    const IconElement = ICON_MAP[iconName as keyof typeof ICON_MAP]
    if (!IconElement) return null
    return <IconElement className="w-4 h-4 text-gray-500" />
  }

  return (
    <HoverCard openDelay={100} closeDelay={150}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent className="w-96 bg-white/95 backdrop-blur-md p-0 nice-shadow">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-500 p-4">{error}</div>
        ) : userData ? (
          <div>
            {/* Header with Avatar and Name */}
            <div className="relative">
              {/* Background gradient */}
              <div className="absolute inset-0 bg-gradient-to-b from-gray-100/30 to-transparent h-28 rounded-t-lg" />
              
              {/* Content */}
              <div className="relative px-5 pt-5 pb-4">
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    <div className="rounded-full">
                      {children}
                    </div>
                  </div>

                  {/* Name, Bio, and Button */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <h4 className="font-semibold text-gray-900 truncate">
                          {userData.first_name} {userData.last_name}
                        </h4>
                        {userData.username && (
                          <Badge variant="outline" className="text-xs font-normal text-gray-500 px-2 truncate">
                            @{userData.username}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-gray-600 hover:text-gray-900 flex-shrink-0"
                        onClick={() => router.push(`/profile/${userId}`)}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                    {userData.bio && (
                      <p className="text-sm text-gray-500 mt-1.5 line-clamp-4 leading-normal">
                        {userData.bio}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Details */}
            {userData.details && Object.values(userData.details).length > 0 && (
              <div className="px-5 pb-4 space-y-2.5 border-t border-gray-100 pt-3.5">
                {Object.values(userData.details).map((detail) => (
                  <div key={detail.id} className="flex items-center gap-2.5">
                    <IconComponent iconName={detail.icon} />
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-500">{detail.label}</span>
                      <span className="text-sm text-gray-700">{detail.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

export default UserProfilePopup 