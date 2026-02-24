'use client'
import React, { useState, useEffect } from 'react'
import { SmilePlus } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  getPlaygroundReactions,
  togglePlaygroundReaction,
  PlaygroundReactionSummary,
} from '@services/playgrounds/playgrounds'
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

// 4 always-visible quick reactions + more available via picker
const QUICK_REACTIONS = ['🔥', '❤️', '🎉', '🚀']
const ALL_REACTION_EMOJIS = [
  '👍', '👎', '❤️', '🔥', '🎉', '🚀', '👀', '💯',
  '🤔', '😮', '😂', '🥳', '💡', '👏', '🙌', '⭐',
  '🧠', '✨', '💪', '🎯', '🤩', '😍', '🙏', '💎',
]

interface PlaygroundReactionButtonProps {
  playgroundUuid: string
}

export function PlaygroundReactionButton({ playgroundUuid }: PlaygroundReactionButtonProps) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'

  const [reactions, setReactions] = useState<PlaygroundReactionSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const fetchReactions = async () => {
    try {
      const result = await getPlaygroundReactions(playgroundUuid, accessToken)
      setReactions(result)
    } catch {
      // silent — public playground anonymous fetch may fail
    }
  }

  useEffect(() => {
    fetchReactions()
  }, [playgroundUuid])

  const handleToggle = async (emoji: string) => {
    if (!isAuthenticated || !accessToken || isLoading) return
    setIsLoading(true)
    try {
      await togglePlaygroundReaction(playgroundUuid, emoji, accessToken)
      await fetchReactions()
    } catch {
      // ignore
    } finally {
      setIsLoading(false)
      setIsPickerOpen(false)
    }
  }

  const getUserNames = (users: PlaygroundReactionSummary['users']) => {
    if (users.length === 0) return ''
    if (users.length <= 3) return users.map((u) => u.first_name || u.username).join(', ')
    const first3 = users.slice(0, 3).map((u) => u.first_name || u.username).join(', ')
    return `${first3} and ${users.length - 3} more`
  }

  // Existing reactions that are NOT in the quick row (show after the quick row)
  const extraReactions = reactions.filter((r) => !QUICK_REACTIONS.includes(r.emoji))

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-2">
        {/* Quick reaction row — always visible */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_REACTIONS.map((emoji) => {
            const existing = reactions.find((r) => r.emoji === emoji)
            return (
              <Tooltip key={emoji}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleToggle(emoji)}
                    disabled={isLoading || !isAuthenticated}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      existing?.has_reacted
                        ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    } ${!isAuthenticated ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span className="text-base leading-none">{emoji}</span>
                    {existing && existing.count > 0 && (
                      <span className="font-semibold">{existing.count}</span>
                    )}
                  </button>
                </TooltipTrigger>
                {existing && existing.users.length > 0 && (
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">{getUserNames(existing.users)}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}

          {/* More emoji picker */}
          {isAuthenticated && (
            <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 hover:bg-gray-50 transition-colors"
                  title="More reactions"
                >
                  <SmilePlus size={15} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto p-2"
                align="start"
                side="top"
                style={{ zIndex: 9999 }}
              >
                <div className="grid grid-cols-6 gap-1">
                  {ALL_REACTION_EMOJIS.map((emoji) => {
                    const existing = reactions.find((r) => r.emoji === emoji)
                    return (
                      <button
                        key={emoji}
                        onClick={() => handleToggle(emoji)}
                        disabled={isLoading}
                        className={`w-9 h-9 flex items-center justify-center text-xl rounded-lg transition-colors ${
                          existing?.has_reacted ? 'bg-indigo-100' : 'hover:bg-gray-100'
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

        {/* Extra reactions row — reactions outside the quick set that users have added */}
        {extraReactions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {extraReactions.map((reaction) => (
              <Tooltip key={reaction.emoji}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => isAuthenticated && handleToggle(reaction.emoji)}
                    disabled={isLoading || !isAuthenticated}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      reaction.has_reacted
                        ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    } ${!isAuthenticated ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span className="text-base leading-none">{reaction.emoji}</span>
                    <span className="font-semibold">{reaction.count}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs">{getUserNames(reaction.users)}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

export default PlaygroundReactionButton
