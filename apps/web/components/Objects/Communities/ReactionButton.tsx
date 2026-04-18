'use client'
import React, { useState, useEffect } from 'react'
import { SmilePlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  getReactions,
  toggleReaction,
  ReactionSummary,
} from '@services/communities/discussions'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'

// Common emojis for reactions
const REACTION_EMOJIS = ['👍', '❤️', '🎉', '🚀', '👀', '💯', '🔥', '💡', '👏', '🙌']

interface ReactionButtonProps {
  discussionUuid: string
  compact?: boolean
}

export function ReactionButton({ discussionUuid, compact = false }: ReactionButtonProps) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'

  const [reactions, setReactions] = useState<ReactionSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const fetchReactions = async () => {
    try {
      const result = await getReactions(discussionUuid, accessToken)
      setReactions(result)
    } catch (_error) {
      // silent — reactions list failure is not user-actionable
    }
  }

  useEffect(() => {
    fetchReactions()
  }, [discussionUuid])

  const handleToggleReaction = async (emoji: string) => {
    if (!isAuthenticated || !accessToken || isLoading) return

    setIsLoading(true)
    try {
      await toggleReaction(discussionUuid, emoji, accessToken)
      await fetchReactions()
    } catch (error: any) {
      const message =
        (error?.detail && typeof error.detail === 'object' && error.detail.message) ||
        error?.message ||
        'Failed to react to this discussion.'
      toast.error(message)
    } finally {
      setIsLoading(false)
      setIsPickerOpen(false)
    }
  }

  const getUserNames = (users: ReactionSummary['users']) => {
    if (users.length === 0) return ''
    if (users.length <= 3) {
      return users.map(u => u.first_name || u.username).join(', ')
    }
    const firstThree = users.slice(0, 3).map(u => u.first_name || u.username).join(', ')
    return `${firstThree} and ${users.length - 3} more`
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Existing reactions */}
      <TooltipProvider delayDuration={200}>
        {reactions.map((reaction) => (
          <Tooltip key={reaction.emoji}>
            <TooltipTrigger asChild>
              <button
                onClick={() => isAuthenticated && handleToggleReaction(reaction.emoji)}
                disabled={isLoading || !isAuthenticated}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all ${
                  reaction.has_reacted
                    ? 'bg-indigo-100 border border-indigo-300 text-indigo-700'
                    : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200'
                } ${!isAuthenticated ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className="text-sm">{reaction.emoji}</span>
                <span className="font-medium">{reaction.count}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">{getUserNames(reaction.users)}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>

      {/* Add reaction button */}
      {isAuthenticated && (
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <button
              className={`inline-flex items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 hover:bg-gray-50 transition-colors ${
                compact ? 'w-7 h-7' : 'w-8 h-8'
              }`}
              title="Add reaction"
            >
              <SmilePlus size={compact ? 14 : 16} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-2"
            align="start"
            side="top"
            style={{ zIndex: 9999 }}
          >
            <div className="grid grid-cols-5 gap-1">
              {REACTION_EMOJIS.map((emoji) => {
                const existing = reactions.find(r => r.emoji === emoji)
                return (
                  <button
                    key={emoji}
                    onClick={() => handleToggleReaction(emoji)}
                    disabled={isLoading}
                    className={`w-9 h-9 flex items-center justify-center text-xl rounded-lg transition-colors ${
                      existing?.has_reacted
                        ? 'bg-indigo-100'
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    {emoji}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

export default ReactionButton
