import { NodeViewWrapper } from '@tiptap/react'
import React, { useEffect, useState } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUserByUsername, getUser } from '@services/users/users'
import { Input } from "@components/ui/input"
import { Button } from "@components/ui/button"
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
import { useRouter } from 'next/navigation'
import UserAvatar from '@components/Objects/UserAvatar'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useTranslation } from 'react-i18next'

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
  if (!IconElement) return <User className="w-4 h-4 text-neutral-500" />
  return <IconElement className="w-4 h-4 text-neutral-500" />
}

function UserBlockComponent(props: any) {
  const { t } = useTranslation()
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
    if (!access_token) {
      setError('Authentication required')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = await getUser(userId, access_token)
      if (!data) {
        throw new Error('User not found')
      }
      setUserData(data)
      setUsername(data.username)
    } catch (err: any) {
      console.error('Error fetching user by ID:', err)
      setError(err.detail || 'User not found')
      props.updateAttributes({
        user_id: null
      })
    } finally {
      setIsLoading(false)
    }
  }

  const fetchUserByUsername = async (username: string) => {
    if (!access_token) {
      setError('Authentication required')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const data = await getUserByUsername(username, access_token)
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

  // Edit mode - no user selected
  if (isEditable && !userData) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <User className="text-neutral-400" size={16} />
            <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
              {t('editor.blocks.user')}
            </span>
          </div>

          {/* Username Input */}
          <div className="bg-white rounded-lg p-4 nice-shadow">
            <form onSubmit={handleUsernameSubmit} className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('editor.blocks.user_block.enter_username')}
                  className="flex-1 border-neutral-200 focus:border-neutral-300"
                />
                <Button type="submit" disabled={isLoading} className="bg-neutral-700 hover:bg-neutral-800">
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    t('editor.blocks.user_block.load_user')
                  )}
                </Button>
              </div>
              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}
            </form>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // Error state
  if (error) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow">
          <div className="bg-red-50 text-red-500 p-4 rounded-lg text-sm">
            {error}
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // No user selected (view mode)
  if (!userData) {
    if (!isEditable) return null
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow">
          <div className="flex items-center justify-center gap-3 py-8 bg-white rounded-lg nice-shadow">
            <User className="text-neutral-300" size={32} />
            <span className="text-neutral-500">{t('editor.blocks.user_block.no_user')}</span>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // Activity view mode - show only the user card with subtle styling
  if (!isEditable) {
    return (
      <NodeViewWrapper className="block-user">
        <div className="bg-neutral-50 rounded-xl nice-shadow overflow-hidden">
          {/* User Info */}
          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="flex-shrink-0">
                <UserAvatar
                  width={72}
                  avatar_url={userData.avatar_image ? getUserAvatarMediaDirectory(userData.user_uuid, userData.avatar_image) : ''}
                  predefined_avatar={userData.avatar_image ? undefined : 'empty'}
                  userId={userData.id}
                  showProfilePopup
                  rounded="rounded-full"
                />
              </div>

              {/* Name and Bio */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="font-semibold text-neutral-900 truncate">
                      {userData.first_name} {userData.last_name}
                    </h4>
                    {userData.username && (
                      <Badge variant="outline" className="text-xs font-normal text-neutral-500 px-2 truncate border-neutral-200">
                        @{userData.username}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-neutral-500 hover:text-neutral-700 flex-shrink-0"
                    onClick={() => userData.username && router.push(`/user/${userData.username}`)}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
                {userData.bio && (
                  <p className="text-sm text-neutral-600 mt-2 line-clamp-3 leading-relaxed">
                    {userData.bio}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Details */}
          {userData.details && Object.values(userData.details).length > 0 && (
            <div className="px-5 pb-4 pt-3 border-t border-neutral-100 space-y-2.5">
              {Object.values(userData.details).map((detail) => (
                <div key={detail.id} className="flex items-center gap-2.5">
                  <IconComponent iconName={detail.icon} />
                  <div className="flex flex-col">
                    <span className="text-xs text-neutral-500">{detail.label}</span>
                    <span className="text-sm text-neutral-700">{detail.text}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    )
  }

  // Editor mode - User display with block wrapper
  return (
    <NodeViewWrapper className="block-user">
      <div className="bg-neutral-50 rounded-xl px-5 py-4 nice-shadow transition-all ease-linear">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <User className="text-neutral-400" size={16} />
          <span className="uppercase tracking-widest text-xs font-bold text-neutral-400">
            User Profile
          </span>
        </div>

        {/* User Card */}
        <div className="bg-white rounded-lg nice-shadow overflow-hidden">
          {/* User Info */}
          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="flex-shrink-0">
                <UserAvatar
                  width={72}
                  avatar_url={userData.avatar_image ? getUserAvatarMediaDirectory(userData.user_uuid, userData.avatar_image) : ''}
                  predefined_avatar={userData.avatar_image ? undefined : 'empty'}
                  userId={userData.id}
                  showProfilePopup
                  rounded="rounded-full"
                />
              </div>

              {/* Name and Bio */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="font-semibold text-neutral-900 truncate">
                      {userData.first_name} {userData.last_name}
                    </h4>
                    {userData.username && (
                      <Badge variant="outline" className="text-xs font-normal text-neutral-500 px-2 truncate border-neutral-200">
                        @{userData.username}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-neutral-500 hover:text-neutral-700 flex-shrink-0"
                    onClick={() => userData.username && router.push(`/user/${userData.username}`)}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
                {userData.bio && (
                  <p className="text-sm text-neutral-600 mt-2 line-clamp-3 leading-relaxed">
                    {userData.bio}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Details */}
          {userData.details && Object.values(userData.details).length > 0 && (
            <div className="px-5 pb-4 pt-3 border-t border-neutral-100 space-y-2.5">
              {Object.values(userData.details).map((detail) => (
                <div key={detail.id} className="flex items-center gap-2.5">
                  <IconComponent iconName={detail.icon} />
                  <div className="flex flex-col">
                    <span className="text-xs text-neutral-500">{detail.label}</span>
                    <span className="text-sm text-neutral-700">{detail.text}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default UserBlockComponent
