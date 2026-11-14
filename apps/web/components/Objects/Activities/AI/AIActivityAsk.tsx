import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  sendActivityAIChatMessageStream,
  startActivityAIChatSessionStream,
  StreamCallbacks,
} from '@services/ai/ai'
import { AlertTriangle, BadgeInfo, NotebookTabs, Maximize2, Minimize2, PanelRightOpen, PanelRightClose, PanelTop } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { FlaskConical, MessageCircle, X } from 'lucide-react'
import Image from 'next/image'
import learnhouseAI_logo_black from 'public/learnhouse_ai_black_logo.png'
import React, { useEffect, useRef } from 'react'
import {
  AIChatBotStateTypes,
  useAIChatBot,
  useAIChatBotDispatch,
} from '@components/Contexts/AI/AIChatBotContext'
import useGetAIFeatures from '../../../Hooks/useGetAIFeatures'
import UserAvatar from '@components/Objects/UserAvatar'
import { useTranslation } from 'react-i18next'
import AIMarkdownRenderer from './AIMarkdownRenderer'
import AIFollowUpSuggestions from './AIFollowUpSuggestions'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { AIButton, AIMark } from '@components/Objects/AI/AIBrand'

// Phones (<768px, the shell's breakpoint) can't spare a 380px column for the
// side panel, so it floats above the bottom bar instead.
const PHONE_QUERY = '(max-width: 767px)'
const subscribePhone = (onChange: () => void) => {
  const mql = window.matchMedia(PHONE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
function useIsPhone() {
  return React.useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  )
}

type AIActivityAskProps = {
  activity: any
}

function AIActivityAsk(props: AIActivityAskProps) {
  const { t } = useTranslation()
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'activity_ask' })
  const [isButtonAvailable, setIsButtonAvailable] = React.useState(false)
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const { mode } = useAIPanelMode()
  const { track } = useLHAnalytics('learner')

  useEffect(() => {
    if (is_ai_feature_enabled) {
      setIsButtonAvailable(true)
    }
  }, [is_ai_feature_enabled])

  const handleOpenAI = () => {
    track(AnalyticsEvent.AiAssistantOpened, { surface: 'activity' })
    if (mode === 'hover') {
      dispatchAIChatBot({ type: 'setIsModalOpen' })
    } else {
      dispatchAIChatBot({ type: 'setSidePanelOpen' })
    }
  }

  return (
    <>
      {isButtonAvailable && (
        <div>
          <ActivityChatMessageBox activity={props.activity} />
          {/* The Ask AI pill from the shared AI kit: one soft violet ramp,
              the bare AI mark, a 1px inner ring and a soft shadow. */}
          <AIButton onClick={handleOpenAI}>{t('ai.ask_ai')}</AIButton>
        </div>
      )}
    </>
  )
}

export type AIMessage = {
  sender: string
  message: any
  type: 'ai' | 'user'
}

type ActivityChatMessageBoxProps = {
  activity: any
}

function ActivityChatMessageBox(props: ActivityChatMessageBoxProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const { mode, setMode } = useAIPanelMode()

  const isInputDisabled = aiChatBotState.isWaitingForResponse || aiChatBotState.isStreaming
  // Composer field: a soft pill on the dark panel, violet focus ring.
  const inputClass = `w-full h-10 rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/10 ps-4 pe-12 text-sm text-white placeholder:text-white/35 outline-hidden transition-shadow focus:ring-violet-400/50 focus:bg-white/[0.08] ${isInputDisabled ? 'opacity-40' : ''}`

  useEffect(() => {
    if (aiChatBotState.isModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
  }, [aiChatBotState.isModalOpen])

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Perform the sending action here
      sendMessage(event.currentTarget.value)
    }
  }

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await dispatchAIChatBot({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  // Ref to track accumulated content during streaming (avoids closure issues)
  const accumulatedContentRef = useRef('')

  const sendMessage = async (message: string) => {
    if (!message.trim()) return

    // Clear previous follow-up suggestions and reset accumulated content
    await dispatchAIChatBot({ type: 'clearFollowUpSuggestions' })
    accumulatedContentRef.current = ''

    // Add user message
    await dispatchAIChatBot({
      type: 'addMessage',
      payload: { sender: 'user', message: message, type: 'user' },
    })

    // Set loading states
    await dispatchAIChatBot({ type: 'setIsWaitingForResponse' })
    await dispatchAIChatBot({ type: 'setIsStreaming' })
    await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })

    // Streaming callbacks
    const callbacks: StreamCallbacks = {
      onStart: (data) => {
        // Set the chat UUID immediately when we get the start event
        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }
      },
      onChunk: (chunk) => {
        accumulatedContentRef.current += chunk
        dispatchAIChatBot({ type: 'appendStreamingContent', payload: chunk })
      },
      onComplete: (data) => {
        // Add the complete AI message to the messages array
        const finalContent = accumulatedContentRef.current
        dispatchAIChatBot({
          type: 'addMessage',
          payload: { sender: 'ai', message: finalContent, type: 'ai' },
        })

        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })

        // Set the chat UUID if not already set
        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }

        // Start loading follow-ups indicator
        dispatchAIChatBot({ type: 'setIsLoadingFollowUps' })

        // Reset accumulated content
        accumulatedContentRef.current = ''
      },
      onFollowUps: (data) => {
        // Set follow-up suggestions when they arrive
        if (data.follow_up_suggestions && data.follow_up_suggestions.length > 0) {
          dispatchAIChatBot({
            type: 'setFollowUpSuggestions',
            payload: data.follow_up_suggestions,
          })
        } else {
          dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        }
      },
      onError: (error) => {
        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        accumulatedContentRef.current = ''
        dispatchAIChatBot({
          type: 'setError',
          payload: {
            isError: true,
            status: 500,
            error_message: error,
          },
        })
      },
    }

    // Call appropriate streaming function
    if (aiChatBotState.aichat_uuid) {
      await sendActivityAIChatMessageStream(
        message,
        aiChatBotState.aichat_uuid,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    } else {
      await startActivityAIChatSessionStream(
        message,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    }
  }

  function closeModal() {
    dispatchAIChatBot({ type: 'setIsModalClose' })
    dispatchAIChatBot({ type: 'setFullscreen', payload: false })
  }

  function toggleFullscreen() {
    dispatchAIChatBot({ type: 'toggleFullscreen' })
  }

  function openSidePanel() {
    dispatchAIChatBot({ type: 'setSidePanelOpen' })
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Smooth scroll to bottom with easing
  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const targetScroll = container.scrollHeight - container.clientHeight
      const currentScroll = container.scrollTop
      const distance = targetScroll - currentScroll

      if (Math.abs(distance) < 1) return

      // Smooth scroll with easing
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      })
    }
  }

  useEffect(() => {
    // Small delay to ensure content is rendered
    const timer = setTimeout(scrollToBottom, 50)
    return () => clearTimeout(timer)
  }, [aiChatBotState.messages, aiChatBotState.streamingContent])

  return (
    <AnimatePresence>
      {aiChatBotState.isModalOpen && (
        <>
          <motion.div
            initial={{ y: 20, opacity: 0.3, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: 50, opacity: 0, filter: 'blur(25px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
            }}
            className="fixed top-0 start-0 w-full h-full z-[9999] flex justify-center items-center "
            style={{ pointerEvents: 'none' }}
          >
            <div
              style={{
                pointerEvents: 'auto',
                background:
                  'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
              }}
              className={`bg-black z-[10000] shadow-lg ring-1 ring-inset ring-white/10 text-white p-4 backdrop-blur-md transition-all duration-300 flex flex-col rounded-2xl max-w-(--breakpoint-2xl) w-10/12 max-md:w-[calc(100%-16px)] mx-auto fixed bottom-4 max-md:bottom-[calc(var(--lh-mobile-nav-h)+8px)] left-1/2 transform -translate-x-1/2 ${
                aiChatBotState.isFullscreen
                  ? 'h-[80vh]'
                  : 'h-[350px]'
              }`}
            >
              <div className="flex flex-row-reverse pb-3 mb-3 border-b border-white/[0.06] justify-between items-center">
                <div className="flex gap-1 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('side')
                      dispatchAIChatBot({ type: 'switchToSideMode' })
                    }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                    title={t('ai.switch_to_side_mode')}
                    aria-label={t('ai.switch_to_side_mode')}
                  >
                    <PanelRightOpen size={18} />
                  </button>
                  <button
                    onClick={toggleFullscreen}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                    title={aiChatBotState.isFullscreen ? t('ai.exit_fullscreen') : t('ai.fullscreen')}
                    aria-label={aiChatBotState.isFullscreen ? t('ai.exit_fullscreen') : t('ai.fullscreen')}
                  >
                    {aiChatBotState.isFullscreen ? (
                      <Minimize2 size={18} />
                    ) : (
                      <Maximize2 size={18} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label={t('common.close')}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div
                  className={`flex space-x-2 items-center -ms-[100px] ${isInputDisabled ? 'animate-pulse' : ''
                    }`}
                >
                  <AIMark size={24} alt="" pulse={isInputDisabled} />
                  <span className="text-sm font-semibold text-white/85">{t('ai.ask_ai')}</span>
                </div>
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-violet-400/10 text-violet-200/70 text-[10px] font-semibold uppercase tracking-wide">
                  <FlaskConical size={11} />
                  {t('ai.experimental')}
                </span>
              </div>
              {aiChatBotState.messages.length > 0 &&
                !aiChatBotState.error.isError ? (
                <div
                  ref={messagesContainerRef}
                  className={`flex flex-col w-full space-y-3 overflow-y-auto scroll-smooth pe-2 ${
                    aiChatBotState.isFullscreen ? 'flex-1' : 'h-[237px]'
                  }`}
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,255,255,0.1) transparent'
                  }}
                >
                  <AnimatePresence mode="popLayout">
                    {aiChatBotState.messages.map(
                      (message: AIMessage, index: number) => {
                        return (
                          <motion.div
                            key={`msg-${index}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.3,
                              ease: [0.25, 0.46, 0.45, 0.94]
                            }}
                          >
                            <AIMessageComponent
                              message={message}
                              isAI={message.sender === 'ai'}
                            />
                          </motion.div>
                        )
                      }
                    )}
                  </AnimatePresence>

                  {/* Show "thinking" indicator when waiting for first chunk */}
                  <AnimatePresence>
                    {aiChatBotState.isStreaming && !aiChatBotState.streamingContent && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex space-x-3 w-full antialiased font-medium"
                      >
                        <div className="shrink-0">
                          <UserAvatar
                            rounded="rounded-lg"
                            border="border-2"
                            predefined_avatar="ai"
                            width={35}
                            shadow="shadow-none"
                          />
                        </div>
                        <div className="flex items-center space-x-1.5 px-2 py-2">
                          <motion.span
                            className="w-2 h-2 bg-purple-400/80 rounded-full"
                            animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                          />
                          <motion.span
                            className="w-2 h-2 bg-purple-400/80 rounded-full"
                            animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                          />
                          <motion.span
                            className="w-2 h-2 bg-purple-400/80 rounded-full"
                            animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Show streaming content */}
                  <AnimatePresence>
                    {aiChatBotState.isStreaming && aiChatBotState.streamingContent && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                      >
                        <AIMessageComponent
                          message={{
                            sender: 'ai',
                            message: aiChatBotState.streamingContent,
                            type: 'ai',
                          }}
                          isAI={true}
                          isStreaming={true}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Show follow-up suggestions loading or actual suggestions */}
                  <AnimatePresence>
                    {!aiChatBotState.isStreaming && (
                      <>
                        {aiChatBotState.isLoadingFollowUps && aiChatBotState.followUpSuggestions.length === 0 && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="flex justify-center items-center gap-1.5 text-white/30 text-xs py-2"
                          >
                            <motion.span
                              className="w-1 h-1 bg-white/40 rounded-full"
                              animate={{ opacity: [0.3, 0.8, 0.3] }}
                              transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                            />
                            <motion.span
                              className="w-1 h-1 bg-white/40 rounded-full"
                              animate={{ opacity: [0.3, 0.8, 0.3] }}
                              transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
                            />
                            <motion.span
                              className="w-1 h-1 bg-white/40 rounded-full"
                              animate={{ opacity: [0.3, 0.8, 0.3] }}
                              transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                            />
                          </motion.div>
                        )}
                        {aiChatBotState.followUpSuggestions.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                          >
                            <AIFollowUpSuggestions
                              suggestions={aiChatBotState.followUpSuggestions}
                              onSuggestionClick={sendMessage}
                              disabled={isInputDisabled}
                            />
                          </motion.div>
                        )}
                      </>
                    )}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                <AIMessagePlaceHolder
                  sendMessage={sendMessage}
                  activity_uuid={props.activity.activity_uuid}
                  isFullscreen={aiChatBotState.isFullscreen}
                />
              )}
              {aiChatBotState.error.isError && (
                <div className={`flex items-center justify-center ${aiChatBotState.isFullscreen ? 'flex-1' : 'h-[237px]'}`}>
                  <div className="flex flex-col mx-auto w-full max-w-[600px] space-y-2 p-5 rounded-lg bg-red-500/20 outline outline-1 outline-red-500">
                    <AlertTriangle size={20} className="text-red-500" />
                    <div className="flex flex-col">
                      <h3 className="font-semibold text-red-200">
                        {t('common.something_wrong_happened')}
                      </h3>
                      <span className="text-red-100 text-sm ">
                        {aiChatBotState.error.error_message}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {/* Composer */}
              <div className="relative">
                <input
                  onKeyDown={handleKeyDown}
                  onChange={handleChange}
                  disabled={isInputDisabled}
                  value={aiChatBotState.chatInputValue}
                  aria-label={t('ai.ask_ai_placeholder')}
                  placeholder={t('ai.ask_ai_placeholder')}
                  type="text"
                  className={inputClass}
                />
                <SendButton
                  disabled={isInputDisabled || !aiChatBotState.chatInputValue?.trim()}
                  onClick={() => sendMessage(aiChatBotState.chatInputValue)}
                  label={t('ai.ask_ai')}
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

type AIMessageComponentProps = {
  message: AIMessage
  isAI: boolean
  isStreaming?: boolean
}

function AIMessageComponent({ message, isAI, isStreaming = false }: AIMessageComponentProps) {
  // The learner's messages sit on the end side in a violet bubble; the AI
  // answers in the open, next to its mark.
  if (!isAI) {
    return (
      <div className="flex justify-end w-full antialiased">
        <div className="max-w-[85%] rounded-2xl rounded-se-md bg-gradient-to-b from-violet-500/25 to-violet-600/20 ring-1 ring-inset ring-violet-300/15 px-3.5 py-2">
          <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap break-words">{message.message}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5 w-full antialiased items-start">
      <div className="shrink-0 pt-0.5">
        <AIMark size={24} alt="" />
      </div>
      <div className="flex-1 min-w-0">
        <AIMarkdownRenderer content={message.message} isStreaming={isStreaming} />
      </div>
    </div>
  )
}

const AIMessagePlaceHolder = (props: {
  activity_uuid: string
  sendMessage: any
  isFullscreen?: boolean
}) => {
  const session = useLHSession() as any
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const { t } = useTranslation()

  if (!aiChatBotState.error.isError) {
    return (
      <div className={`w-full ${props.isFullscreen ? 'flex-1 flex items-center justify-center' : 'h-[237px]'}`}>
        <div className="flex flex-col text-center justify-center pt-6">
          <motion.div
            initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: 50, opacity: 0 }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
              delay: 0.17,
            }}
          >
            <Image
              width={100}
              className="mx-auto"
              src={learnhouseAI_logo_black}
              alt=""
            />
            <p className="pt-3 text-2xl font-semibold text-white/70 flex justify-center space-x-2 items-center">
              <span className="items-center">{t('common.hello')}</span>
              <span className="capitalize flex space-x-2 items-center">
                <UserAvatar rounded="rounded-lg" border="border-2" width={35} shadow="shadow-none" />
                <span>{session.data.user.username},</span>
              </span>
              <span>{t('ai.how_can_we_help')}</span>
            </p>
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: 50, opacity: 0 }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
              delay: 0.27,
            }}
            className="questions flex space-x-3 mx-auto pt-6 flex-wrap justify-center"
          >
            <AIChatPredefinedQuestion
              sendMessage={props.sendMessage}
              label="about"
            />
            <AIChatPredefinedQuestion
              sendMessage={props.sendMessage}
              label="flashcards"
            />
            <AIChatPredefinedQuestion
              sendMessage={props.sendMessage}
              label="examples"
            />
          </motion.div>
        </div>
      </div>
    )
  }
}

const AIChatPredefinedQuestion = (props: {
  sendMessage: any
  label: string
}) => {
  const { t } = useTranslation()
  function getQuestion(label: string) {
    if (label === 'about') {
      return t('ai.about_question')
    } else if (label === 'flashcards') {
      return t('ai.flashcards_question')
    } else if (label === 'examples') {
      return t('ai.examples_question')
    }
  }

  return (
    <button
      type="button"
      onClick={() => props.sendMessage(getQuestion(props.label))}
      className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/10 text-xs font-semibold text-white/60 hover:text-white hover:bg-violet-400/15 hover:ring-violet-300/30 transition-colors"
    >
      {props.label === 'about' && <BadgeInfo size={14} className="text-violet-300/80" />}
      {props.label === 'flashcards' && <NotebookTabs size={14} className="text-violet-300/80" />}
      {props.label === 'examples' && <span className="text-[11px] font-bold text-violet-300/80">Ex</span>}
      <span>{getQuestion(props.label)}</span>
    </button>
  )
}

// Round gradient send button inside the composer pill.
function SendButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="absolute end-1 bottom-1 h-8 w-8 inline-flex items-center justify-center rounded-full text-white bg-gradient-to-b from-violet-500 to-purple-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_-2px_rgba(139,92,246,0.6)] transition-[opacity,transform] hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:shadow-none"
    >
      <MessageCircle size={15} />
    </button>
  )
}

type AISidePanelProps = {
  activity: any
}

// Inline sticky side panel that sits next to content
function AISidePanelInline(props: AISidePanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const { mode, setMode } = useAIPanelMode()
  const isInitialRender = useRef(true)
  const accumulatedContentRef = useRef('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [isSecondaryBarVisible, setIsSecondaryBarVisible] = React.useState(false)
  const isPhone = useIsPhone()

  const isInputDisabled = aiChatBotState?.isWaitingForResponse || aiChatBotState?.isStreaming
  const inputClass = isInputDisabled
    ? 'ring-1 ring-inset ring-white/10 bg-gray-950/40 w-full rounded-lg outline-hidden px-4 py-2 text-white text-sm placeholder:text-white/30 opacity-30'
    : 'ring-1 ring-inset ring-white/10 bg-gray-950/40 w-full rounded-lg outline-hidden px-4 py-2 text-white text-sm placeholder:text-white/30'

  // Mark initial render complete after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialRender.current = false
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Track when the secondary bar becomes visible (when activity-info-section scrolls out of view)
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSecondaryBarVisible(!entry.isIntersecting)
      },
      {
        threshold: [0, 0.1, 1],
        rootMargin: '-80px 0px 0px 0px'
      }
    )

    const mainActivityInfo = document.querySelector('.activity-info-section')
    if (mainActivityInfo) {
      observer.observe(mainActivityInfo)
    }

    return () => {
      if (mainActivityInfo) {
        observer.unobserve(mainActivityInfo)
      }
    }
  }, [])

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const targetScroll = container.scrollHeight - container.clientHeight
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      })
    }
  }

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 50)
    return () => clearTimeout(timer)
  }, [aiChatBotState?.messages, aiChatBotState?.streamingContent])

  // Don't render if side panel is not open
  if (!aiChatBotState?.isSidePanelOpen) {
    return null
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      sendMessage(event.currentTarget.value)
    }
  }

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await dispatchAIChatBot({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  const sendMessage = async (message: string) => {
    if (!message.trim()) return

    await dispatchAIChatBot({ type: 'clearFollowUpSuggestions' })
    accumulatedContentRef.current = ''

    await dispatchAIChatBot({
      type: 'addMessage',
      payload: { sender: 'user', message: message, type: 'user' },
    })

    await dispatchAIChatBot({ type: 'setIsWaitingForResponse' })
    await dispatchAIChatBot({ type: 'setIsStreaming' })
    await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })

    const callbacks: StreamCallbacks = {
      onStart: (data) => {
        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }
      },
      onChunk: (chunk) => {
        accumulatedContentRef.current += chunk
        dispatchAIChatBot({ type: 'appendStreamingContent', payload: chunk })
      },
      onComplete: (data) => {
        const finalContent = accumulatedContentRef.current
        dispatchAIChatBot({
          type: 'addMessage',
          payload: { sender: 'ai', message: finalContent, type: 'ai' },
        })

        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })

        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }

        dispatchAIChatBot({ type: 'setIsLoadingFollowUps' })
        accumulatedContentRef.current = ''
      },
      onFollowUps: (data) => {
        if (data.follow_up_suggestions && data.follow_up_suggestions.length > 0) {
          dispatchAIChatBot({
            type: 'setFollowUpSuggestions',
            payload: data.follow_up_suggestions,
          })
        } else {
          dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        }
      },
      onError: (error) => {
        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        accumulatedContentRef.current = ''
        dispatchAIChatBot({
          type: 'setError',
          payload: {
            isError: true,
            status: 500,
            error_message: error,
          },
        })
      },
    }

    if (aiChatBotState.aichat_uuid) {
      await sendActivityAIChatMessageStream(
        message,
        aiChatBotState.aichat_uuid,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    } else {
      await startActivityAIChatSessionStream(
        message,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    }
  }

  function closeSidePanel() {
    dispatchAIChatBot({ type: 'setSidePanelClose' })
  }

  function openModal() {
    dispatchAIChatBot({ type: 'setSidePanelClose' })
    dispatchAIChatBot({ type: 'setIsModalOpen' })
  }

  // Adjust top position based on secondary bar visibility
  const topPosition = isSecondaryBarVisible ? '144px' : '80px'
  const panelHeight = isSecondaryBarVisible ? 'calc(100vh - 220px)' : 'calc(100vh - 160px)'

  return (
    <motion.div
      initial={isInitialRender.current ? false : { opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={isInitialRender.current ? { duration: 0 } : {
        type: 'spring',
        bounce: 0.2,
        duration: 0.4,
      }}
      style={{
        background:
          'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
        ...(isPhone
          ? { height: 'min(70dvh, 560px)' }
          : { height: panelHeight, top: topPosition }),
      }}
      className={`${
        isPhone
          ? 'fixed inset-x-2 bottom-[calc(var(--lh-mobile-nav-h)+8px)] z-[9998] rounded-2xl'
          : 'sticky w-[380px] shrink-0 rounded-2xl'
      } shadow-[0_12px_40px_-12px_rgba(46,16,101,0.45)] ring-1 ring-inset ring-white/10 text-white p-4 backdrop-blur-md flex flex-col transition-all duration-300`}
    >
          {/* Header: the AI mark, an experimental chip, mode + close. */}
          <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-white/[0.06]">
            <div className={`flex items-center gap-2 ${isInputDisabled ? 'animate-pulse' : ''}`}>
              <AIMark size={24} alt="" />
              <span className="text-sm font-semibold text-white/85">{t('ai.ask_ai')}</span>
              <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-violet-400/10 text-violet-200/70 text-[10px] font-semibold uppercase tracking-wide">
                <FlaskConical size={11} />
                {t('ai.experimental')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setMode('hover')
                  dispatchAIChatBot({ type: 'switchToHoverMode' })
                }}
                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                title={t('ai.switch_to_hover_mode')}
                aria-label={t('ai.switch_to_hover_mode')}
              >
                <PanelTop size={15} />
              </button>
              <button
                type="button"
                onClick={closeSidePanel}
                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={t('common.close')}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          {aiChatBotState.messages.length > 0 && !aiChatBotState.error.isError ? (
            <div
              ref={messagesContainerRef}
              className="flex flex-col flex-1 w-full space-y-3 overflow-y-auto scroll-smooth pe-2"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.1) transparent'
              }}
            >
              <AnimatePresence mode="popLayout">
                {aiChatBotState.messages.map((message: AIMessage, index: number) => (
                  <motion.div
                    key={`side-msg-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.3,
                      ease: [0.25, 0.46, 0.45, 0.94]
                    }}
                  >
                    <AIMessageComponent
                      message={message}
                      isAI={message.sender === 'ai'}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Thinking indicator */}
              <AnimatePresence>
                {aiChatBotState.isStreaming && !aiChatBotState.streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex space-x-3 w-full antialiased font-medium"
                  >
                    <div className="shrink-0">
                      <UserAvatar
                        rounded="rounded-lg"
                        border="border-2"
                        predefined_avatar="ai"
                        width={35}
                        shadow="shadow-none"
                      />
                    </div>
                    <div className="flex items-center space-x-1.5 px-2 py-2">
                      <motion.span
                        className="w-2 h-2 bg-purple-400/80 rounded-full"
                        animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                      />
                      <motion.span
                        className="w-2 h-2 bg-purple-400/80 rounded-full"
                        animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                      />
                      <motion.span
                        className="w-2 h-2 bg-purple-400/80 rounded-full"
                        animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Streaming content */}
              <AnimatePresence>
                {aiChatBotState.isStreaming && aiChatBotState.streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <AIMessageComponent
                      message={{
                        sender: 'ai',
                        message: aiChatBotState.streamingContent,
                        type: 'ai',
                      }}
                      isAI={true}
                      isStreaming={true}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Follow-up suggestions */}
              <AnimatePresence>
                {!aiChatBotState.isStreaming && (
                  <>
                    {aiChatBotState.isLoadingFollowUps && aiChatBotState.followUpSuggestions.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex justify-center items-center gap-1.5 text-white/30 text-xs py-2"
                      >
                        <motion.span
                          className="w-1 h-1 bg-white/40 rounded-full"
                          animate={{ opacity: [0.3, 0.8, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <motion.span
                          className="w-1 h-1 bg-white/40 rounded-full"
                          animate={{ opacity: [0.3, 0.8, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
                        />
                        <motion.span
                          className="w-1 h-1 bg-white/40 rounded-full"
                          animate={{ opacity: [0.3, 0.8, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
                        />
                      </motion.div>
                    )}
                    {aiChatBotState.followUpSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      >
                        <AIFollowUpSuggestions
                          suggestions={aiChatBotState.followUpSuggestions}
                          onSuggestionClick={sendMessage}
                          disabled={isInputDisabled}
                        />
                      </motion.div>
                    )}
                  </>
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <AISidePanelPlaceholder
              sendMessage={sendMessage}
              activity_uuid={props.activity.activity_uuid}
            />
          )}

          {/* Error state */}
          {aiChatBotState.error.isError && (
            <div className="flex items-center justify-center flex-1">
              <div className="flex flex-col mx-auto w-full space-y-2 p-4 rounded-2xl bg-rose-500/10 ring-1 ring-inset ring-rose-400/30">
                <AlertTriangle size={20} className="text-red-500" />
                <div className="flex flex-col">
                  <h3 className="font-semibold text-red-200">
                    {t('common.something_wrong_happened')}
                  </h3>
                  <span className="text-red-100 text-sm">
                    {aiChatBotState.error.error_message}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="relative pt-3">
            <input
              onKeyDown={handleKeyDown}
              onChange={handleChange}
              disabled={isInputDisabled}
              value={aiChatBotState.chatInputValue}
              aria-label={t('ai.ask_ai_placeholder')}
              placeholder={t('ai.ask_ai_placeholder')}
              type="text"
              className={inputClass}
            />
            <SendButton
              disabled={isInputDisabled || !aiChatBotState.chatInputValue?.trim()}
              onClick={() => sendMessage(aiChatBotState.chatInputValue)}
              label={t('ai.ask_ai')}
            />
          </div>
        </motion.div>
  )
}

const AISidePanelPlaceholder = (props: {
  activity_uuid: string
  sendMessage: any
}) => {
  const session = useLHSession() as any
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const { t } = useTranslation()

  if (!aiChatBotState.error.isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col text-center justify-center">
          <motion.div
            initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
              delay: 0.17,
            }}
          >
            <Image
              width={80}
              className="mx-auto"
              src={learnhouseAI_logo_black}
              alt=""
            />
            <p className="pt-4 text-lg font-semibold text-white/80 flex flex-col justify-center items-center gap-0.5">
              <span className="flex items-center space-x-2">
                <span>{t('common.hello')}</span>
                <UserAvatar rounded="rounded-lg" border="border-2" width={28} shadow="shadow-none" />
                <span className="capitalize">{session?.data?.user?.username},</span>
              </span>
              <span>{t('ai.how_can_we_help')}</span>
            </p>
          </motion.div>
          <motion.div
            initial={{ y: 20, opacity: 0, filter: 'blur(5px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            transition={{
              type: 'spring',
              bounce: 0.35,
              duration: 1.7,
              mass: 0.2,
              velocity: 2,
              delay: 0.27,
            }}
            className="questions flex flex-col items-center gap-2 mx-auto pt-5"
          >
            <AIChatPredefinedQuestion
              sendMessage={props.sendMessage}
              label="about"
            />
            <AIChatPredefinedQuestion
              sendMessage={props.sendMessage}
              label="flashcards"
            />
            <AIChatPredefinedQuestion
              sendMessage={props.sendMessage}
              label="examples"
            />
          </motion.div>
        </div>
      </div>
    )
  }
}

// Type for AI panel display mode
export type AIPanelMode = 'side' | 'hover'

// Context for AI panel mode
const AIPanelModeContext = React.createContext<{
  mode: AIPanelMode
  setMode: (mode: AIPanelMode) => void
}>({
  mode: 'side',
  setMode: () => {},
})

export function useAIPanelMode() {
  return React.useContext(AIPanelModeContext)
}

// Hook to manage side panel localStorage persistence
export function useAISidePanelPersistence() {
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const isInitialMount = useRef(true)
  const [mode, setModeState] = React.useState<AIPanelMode>('side')

  // Restore state from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && isInitialMount.current) {
      // Restore mode preference first
      const savedMode = localStorage.getItem('aiPanelMode') as AIPanelMode
      const restoredMode = (savedMode === 'side' || savedMode === 'hover') ? savedMode : 'side'
      setModeState(restoredMode)

      // Only restore panel open state if mode is 'side'
      if (restoredMode === 'side') {
        const savedState = localStorage.getItem('aiSidePanelOpen')
        if (savedState === 'true') {
          dispatchAIChatBot({ type: 'setSidePanelOpen' })
        }
      }
      isInitialMount.current = false
    }
  }, [dispatchAIChatBot])

  // Save side panel state to localStorage when it changes (only in side mode)
  useEffect(() => {
    if (typeof window !== 'undefined' && !isInitialMount.current && mode === 'side') {
      localStorage.setItem('aiSidePanelOpen', aiChatBotState?.isSidePanelOpen?.toString() || 'false')
    }
  }, [aiChatBotState?.isSidePanelOpen, mode])

  const setMode = (newMode: AIPanelMode) => {
    setModeState(newMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('aiPanelMode', newMode)
    }
  }

  return { mode, setMode }
}

// Wrapper component - provides mode context and handles persistence
export function AISidePanelContentWrapper({ children }: { children: React.ReactNode }) {
  const { mode, setMode } = useAISidePanelPersistence()
  return (
    <AIPanelModeContext.Provider value={{ mode, setMode }}>
      {children}
    </AIPanelModeContext.Provider>
  )
}

// Export the inline panel for use in activity.tsx
export { AISidePanelInline }

export default AIActivityAsk
