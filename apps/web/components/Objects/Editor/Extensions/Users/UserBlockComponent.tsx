import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect, useState } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUserByUsername, getUser } from '@services/users/users'
import { Input } from "@components/ui/input"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { 
  Loader2, 
  User, 
  ExternalLink,
  Briefcase,
  GraduationCap,
  MapPin,
  Building2,
  Globe,
  Laptop2,
  Award,
  BookOpen,
  Link,
  Users,
  Calendar,
  Lightbulb
} from 'lucide-react'
import { Badge } from "@components/ui/badge"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@components/ui/hover-card"
import { useRouter } from 'next/navigation'
import UserAvatar from '@components/Objects/UserAvatar'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { getUserAvatarMediaDirectory } from '@services/media/media'

type UserData = {
  id: string
  user_uuid: string
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

const AVAILABLE_ICONS = {
  'briefcase': Briefcase,
  'graduation-cap': GraduationCap,
  'map-pin': MapPin,
  'building-2': Building2,
  'speciality': Lightbulb,
  'globe': Globe,
  'laptop-2': Laptop2,
  'award': Award,
  'book-open': BookOpen,
  'link': Link,
  'users': Users,
  'calendar': Calendar,
} as const;

const IconComponent = ({ iconName }: { iconName: string }) => {
  const IconElement = AVAILABLE_ICONS[iconName as keyof typeof AVAILABLE_ICONS]
  if (!IconElement) return <User className="w-4 h-4 text-gray-600" />
  return <IconElement className="w-4 h-4 text-gray-600" />
}

function UserBlockComponent(props: any) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const editorState = useEditorProvider() as any
  const isEditable = editorState.isEditable
  const router = useRouter()

  const [username, setUsername] = useState('')
  const [userData, setUserData] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.node.attrs.user_id) {
      fetchUserById(props.node.attrs.user_id)
    }
  }, [props.node.attrs.user_id])

  const fetchUserById = async (userId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getUser(userId)
      if (!data) {
        throw new Error('User not found')
      }
      setUserData(data)
      setUsername(data.username)
    } catch (err: any) {
      console.error('Error fetching user by ID:', err)
      setError(err.detail || 'User not found')
      // Clear the invalid user_id from the node attributes
      props.updateAttributes({
        user_id: null
      })
    } finally {
      setIsLoading(false)
    }
  }

  const fetchUserByUsername = async (username: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getUserByUsername(username)
      if (!data) {
        throw new Error('User not found')
      }
      setUserData(data)
      props.updateAttributes({
        user_id: data.id
      })
    } catch (err: any) {
      console.error('Error fetching user by username:', err)
      setError(err.detail || 'User not found')
    } finally {
      setIsLoading(false)
    }
  }

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return
    await fetchUserByUsername(username)
  }

  if (isEditable && !userData) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-gray-50 rounded-lg p-6 border border-dashed border-gray-200">
          <form onSubmit={handleUsernameSubmit} className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="flex-1"
                />
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Load User'
                  )}
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-500 mt-2">{error}</p>
              )}
            </div>
          </form>
        </div>
      </NodeViewWrapper>
    )
  }

  if (isLoading) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </NodeViewWrapper>
    )
  }

  if (error) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-red-50 text-red-500 p-4 rounded-lg">
          {error}
        </div>
      </NodeViewWrapper>
    )
  }

  if (!userData) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-gray-50 rounded-lg p-6 border border-dashed border-gray-200">
          <div className="flex items-center gap-2 text-gray-500">
            <User className="w-5 h-5" />
            <span>No user selected</span>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="block-user">
      <div className="bg-white rounded-lg nice-shadow overflow-hidden">
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
                  <UserAvatar
                    width={80}
                    avatar_url={userData.avatar_image ? getUserAvatarMediaDirectory(userData.user_uuid, userData.avatar_image) : ''}
                    predefined_avatar={userData.avatar_image ? undefined : 'empty'}
                    userId={userData.id}
                    showProfilePopup
                    rounded="rounded-full"
                  />
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
                    onClick={() => userData.username && router.push(`/user/${userData.username}`)}
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
    </NodeViewWrapper>
  )
}

export default UserBlockComponent