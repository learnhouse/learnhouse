import {
  type AIEditorStateTypes,
  useAIEditor,
  useAIEditorDispatch,
} from '@components/Contexts/AI/AIEditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useGetAIFeatures from '@components/Hooks/useGetAIFeatures'
import {
  sendActivityAIChatMessage,
  startActivityAIChatSession,
} from '@services/ai/ai'
import type { Editor } from '@tiptap/react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BetweenHorizontalStart,
  FastForward,
  Feather,
  FileStack,
  HelpCircle,
  Languages,
  MoreVertical,
  X,
} from 'lucide-react'
import Image from 'next/image'
import learnhouseAI_icon from 'public/learnhouse_ai_simple.png'
import React from 'react'

type AIEditorToolkitProps = {
  editor: Editor
  activity: any
}

type AIPromptsLabels = {
  label:
    | 'Writer'
    | 'ContinueWriting'
    | 'MakeLonger'
    | 'GenerateQuiz'
    | 'Translate'
  selection: string
}

function AIEditorToolkit(props: AIEditorToolkitProps) {
  const dispatchAIEditor = useAIEditorDispatch() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'editor' })
  const [isToolkitAvailable, setIsToolkitAvailable] = React.useState(true)

  React.useEffect(() => {
    if (is_ai_feature_enabled) {
      setIsToolkitAvailable(true)
    }
  }, [is_ai_feature_enabled])

  return (
    <>
      {isToolkitAvailable && (
        <div className="flex space-x-2">
          <AnimatePresence>
            {aiEditorState.isModalOpen && (
              <motion.div
                initial={{ y: 20, opacity: 0.3, filter: 'blur(5px)' }}
                animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                exit={{ y: 50, opacity: 0, filter: 'blur(3px)' }}
                transition={{
                  type: 'spring',
                  bounce: 0.35,
                  duration: 1.7,
                  mass: 0.2,
                  velocity: 2,
                }}
                className="fixed top-0 left-0 z-50 flex h-full w-full items-center justify-center"
                style={{ pointerEvents: 'none' }}
              >
                <>
                  {aiEditorState.isFeedbackModalOpen && (
                    <UserFeedbackModal
                      activity={props.activity}
                      editor={props.editor}
                    />
                  )}
                  <div
                    style={{
                      pointerEvents: 'auto',
                      background:
                        'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 98%)',
                    }}
                    className="fixed bottom-0 left-1/2 z-50 mx-auto my-10 w-fit max-w-(--breakpoint-2xl) -translate-x-1/2 transform flex-col-reverse rounded-2xl p-3 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md ring-inset"
                  >
                    <div className="flex space-x-2">
                      <div className="pr-1">
                        <div className="flex w-full items-center space-x-2 font-bold text-white/80">
                          <Image
                            className="rounded-lg outline outline-1 outline-neutral-200/20"
                            width={24}
                            src={learnhouseAI_icon}
                            alt=""
                          />
                          <div className="flex items-center">
                            AI Editor{' '}
                            <span className="ml-3 rounded-3xl bg-white/10 px-2 py-1 text-[10px] uppercase">
                              PRE-ALPHA
                            </span>
                          </div>
                          <MoreVertical className="text-white/50" size={12} />
                        </div>
                      </div>
                      <div className="tools flex space-x-2">
                        <AiEditorToolButton label="Writer" />
                        <AiEditorToolButton label="ContinueWriting" />
                        <AiEditorToolButton label="MakeLonger" />

                        <AiEditorToolButton label="Translate" />
                      </div>
                      <div className="flex items-center space-x-2">
                        <X
                          onClick={() =>
                            Promise.all([
                              dispatchAIEditor({ type: 'setIsModalClose' }),
                              dispatchAIEditor({
                                type: 'setIsFeedbackModalClose',
                              }),
                            ])
                          }
                          size={20}
                          className="items-center rounded-full bg-white/10 p-1 text-white/50 hover:cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                </>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  )
}

const UserFeedbackModal = (props: AIEditorToolkitProps) => {
  const dispatchAIEditor = useAIEditorDispatch() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await dispatchAIEditor({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  const sendReqWithMessage = async (message: string) => {
    if (aiEditorState.aichat_uuid) {
      await dispatchAIEditor({
        type: 'addMessage',
        payload: { sender: 'user', message: message, type: 'user' },
      })
      await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
      const response = await sendActivityAIChatMessage(
        message,
        aiEditorState.aichat_uuid,
        props.activity.activity_uuid,
        access_token
      )
      if (response.success === false) {
        await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
        await dispatchAIEditor({ type: 'setIsModalClose' })
        // wait for 200ms before opening the modal again
        await new Promise((resolve) => setTimeout(resolve, 200))
        await dispatchAIEditor({
          type: 'setError',
          payload: {
            isError: true,
            status: response.status,
            error_message: response.data.detail,
          },
        })
        await dispatchAIEditor({ type: 'setIsModalOpen' })
        return ''
      }
      await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
      await dispatchAIEditor({ type: 'setChatInputValue', payload: '' })
      await dispatchAIEditor({
        type: 'addMessage',
        payload: { sender: 'ai', message: response.data.message, type: 'ai' },
      })
      return response.data.message
    } else {
      await dispatchAIEditor({
        type: 'addMessage',
        payload: { sender: 'user', message: message, type: 'user' },
      })
      await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
      const response = await startActivityAIChatSession(
        message,
        access_token,
        props.activity.activity_uuid
      )
      if (response.success === false) {
        await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
        await dispatchAIEditor({ type: 'setIsModalClose' })
        // wait for 200ms before opening the modal again
        await new Promise((resolve) => setTimeout(resolve, 200))
        await dispatchAIEditor({
          type: 'setError',
          payload: {
            isError: true,
            status: response.status,
            error_message: response.data.detail,
          },
        })
        await dispatchAIEditor({ type: 'setIsModalOpen' })
        return ''
      }
      await dispatchAIEditor({
        type: 'setAichat_uuid',
        payload: response.data.aichat_uuid,
      })
      await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
      await dispatchAIEditor({ type: 'setChatInputValue', payload: '' })
      await dispatchAIEditor({
        type: 'addMessage',
        payload: { sender: 'ai', message: response.data.message, type: 'ai' },
      })
      return response.data.message
    }
  }

  const handleKeyPress = async (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Enter') {
      await handleOperation(
        aiEditorState.selectedTool,
        aiEditorState.chatInputValue
      )
    }
  }

  const handleOperation = async (
    label:
      | 'Writer'
      | 'ContinueWriting'
      | 'MakeLonger'
      | 'GenerateQuiz'
      | 'Translate',
    message: string
  ) => {
    // Set selected tool
    await dispatchAIEditor({ type: 'setSelectedTool', payload: label })

    // Check what operation that was
    if (label === 'Writer') {
      let ai_message = ''
      const prompt = getPrompt({ label: label, selection: message })
      await dispatchAIEditor({ type: 'setIsUserInputEnabled', payload: true })
      if (prompt) {
        await dispatchAIEditor({
          type: 'setIsUserInputEnabled',
          payload: false,
        })
        await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
        ai_message = await sendReqWithMessage(prompt)
        await fillEditorWithText(ai_message)
        await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
        await dispatchAIEditor({
          type: 'setIsUserInputEnabled',
          payload: true,
        })
      }
    } else if (label === 'ContinueWriting') {
      let ai_message = ''
      const text_selection = getTipTapEditorSelectedTextGlobal()
      const prompt = getPrompt({ label: label, selection: text_selection })
      if (prompt) {
        await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
        ai_message = await sendReqWithMessage(prompt)
        const message_without_original_text = await removeSentences(
          text_selection,
          ai_message
        )
        await fillEditorWithText(message_without_original_text)
        await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
      }
    } else if (label === 'MakeLonger') {
      let ai_message = ''
      const text_selection = getTipTapEditorSelectedText()
      const prompt = getPrompt({ label: label, selection: text_selection })
      if (prompt) {
        await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
        ai_message = await sendReqWithMessage(prompt)
        await replaceSelectedTextWithText(ai_message)
        await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
      }
    } else if (label === 'GenerateQuiz') {
      // will be implemented in future stages
    } else if (label === 'Translate') {
      let ai_message = ''
      const text_selection = getTipTapEditorSelectedText()
      const prompt = getPrompt({ label: label, selection: text_selection })
      if (prompt) {
        await dispatchAIEditor({ type: 'setIsWaitingForResponse' })
        ai_message = await sendReqWithMessage(prompt)
        await replaceSelectedTextWithText(ai_message)
        await dispatchAIEditor({ type: 'setIsNoLongerWaitingForResponse' })
      }
    }
  }

  const removeSentences = async (
    textToRemove: string,
    originalText: string
  ) => {
    const phrase = textToRemove.toLowerCase()
    const original = originalText.toLowerCase()

    if (original.includes(phrase)) {
      const regex = new RegExp(phrase, 'g')
      const newText = original.replace(regex, '')
      return newText
    } else {
      return originalText
    }
  }

  async function fillEditorWithText(text: string) {
    const words = text.split(' ')

    for (let i = 0; i < words.length; i++) {
      const textNode = {
        type: 'text',
        text: words[i],
      }

      props.editor.chain().focus().insertContent(textNode).run()

      // Add a space after each word except the last one
      if (i < words.length - 1) {
        const spaceNode = {
          type: 'text',
          text: ' ',
        }

        props.editor.chain().focus().insertContent(spaceNode).run()
      }

      // Wait for 0.3 seconds before adding the next word
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }

  async function replaceSelectedTextWithText(text: string) {
    const words = text.split(' ')

    // Delete the selected text
    props.editor.chain().focus().deleteSelection().run()

    for (let i = 0; i < words.length; i++) {
      const textNode = {
        type: 'text',
        text: words[i],
      }

      props.editor.chain().focus().insertContent(textNode).run()

      // Add a space after each word except the last one
      if (i < words.length - 1) {
        const spaceNode = {
          type: 'text',
          text: ' ',
        }

        props.editor.chain().focus().insertContent(spaceNode).run()
      }

      // Wait for 0.3 seconds before adding the next word
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }

  const getPrompt = (args: AIPromptsLabels) => {
    const { label, selection } = args

    if (label === 'Writer') {
      return `Write 3 sentences about ${selection}`
    } else if (label === 'ContinueWriting') {
      return `Continue writing 3 more sentences based on "${selection}"`
    } else if (label === 'MakeLonger') {
      return `Make longer this text longer : "${selection}"`
    } else if (label === 'GenerateQuiz') {
      return `Generate a quiz about "${selection}", only return an array of objects, every object should respect the following interface:
            interface Answer {
                answer_id: string;
                answer: string;
                correct: boolean;
              }
              interface Question {
                question_id: string;
                question: string;
                type: "multiple_choice" 
                answers: Answer[];
              }
            " `
    } else if (label === 'Translate') {
      return (
        `Translate "${selection}" to the ` +
        aiEditorState.chatInputValue +
        ` language`
      )
    }
  }

  const getTipTapEditorSelectedTextGlobal = () => {
    // Get the entire node/paragraph that the user is in
    const pos = props.editor.state.selection.$from.pos // get the cursor position
    const resolvedPos = props.editor.state.doc.resolve(pos) // resolve the position in the document
    const start = resolvedPos.before(1) // get the start position of the node
    const end = resolvedPos.after(1) // get the end position of the node
    const paragraph = props.editor.state.doc.textBetween(start, end, '\n', '\n') // get the text of the node
    return paragraph
  }

  const getTipTapEditorSelectedText = () => {
    const selection = props.editor.state.selection
    const from = selection.from
    const to = selection.to
    const text = props.editor.state.doc.textBetween(from, to)
    return text
  }

  return (
    <motion.div
      initial={{ y: 20, opacity: 0.3, filter: 'blur(5px)' }}
      animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
      exit={{ y: 50, opacity: 0, filter: 'blur(3px)' }}
      transition={{
        type: 'spring',
        bounce: 0.35,
        duration: 1.7,
        mass: 0.2,
        velocity: 2,
      }}
      className="fixed top-0 left-0 z-50 flex h-full w-full items-center justify-center backdrop-blur-md"
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          background:
            'linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.2) 100%), radial-gradient(105.16% 105.16% at 50% -5.16%, rgba(255, 255, 255, 0.18) 0%, rgba(0, 0, 0, 0) 100%), rgb(2 1 25 / 95%)',
        }}
        className="fixed bottom-16 left-1/2 z-50 mx-auto my-10 h-[200px] w-[500px] max-w-(--breakpoint-2xl) -translate-x-1/2 transform flex-col-reverse rounded-2xl p-3 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md ring-inset"
      >
        <div className="flex justify-center space-x-2">
          <Image
            className="rounded-lg outline outline-1 outline-neutral-200/20"
            width={24}
            src={learnhouseAI_icon}
            alt=""
          />
        </div>
        <div className="mx-auto flex h-[115px] justify-center antialiased">
          <div className="flex items-center justify-center">
            <AiEditorActionScreen handleOperation={handleOperation} />
          </div>
        </div>
        {aiEditorState.isUserInputEnabled && !aiEditorState.error.isError && (
          <div className="flex cursor-pointer items-center space-x-2">
            <input
              onKeyDown={handleKeyPress}
              value={aiEditorState.chatInputValue}
              onChange={handleChange}
              placeholder="Ask AI"
              className="w-full rounded-lg bg-gray-950/20 px-4 py-2 text-sm text-white ring-1 ring-white/20 outline-hidden ring-inset placeholder:text-white/30"
            ></input>
            <div
              onClick={() =>
                handleOperation(
                  aiEditorState.selectedTool,
                  aiEditorState.chatInputValue
                )
              }
              className="rounded-md bg-white/10 px-3 py-2 outline outline-1 outline-neutral-200/20 transition-all delay-75 ease-linear hover:bg-white/20 hover:outline-neutral-200/40"
            >
              <BetweenHorizontalStart
                size={20}
                className="text-white/50 hover:cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

const AiEditorToolButton = (props: any) => {
  const dispatchAIEditor = useAIEditorDispatch() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes

  const handleToolButtonClick = async (
    label:
      | 'Writer'
      | 'ContinueWriting'
      | 'MakeLonger'
      | 'GenerateQuiz'
      | 'Translate'
  ) => {
    if (label === 'Writer') {
      await dispatchAIEditor({ type: 'setSelectedTool', payload: label })
      await dispatchAIEditor({ type: 'setIsUserInputEnabled', payload: true })
      await dispatchAIEditor({ type: 'setIsFeedbackModalOpen' })
    }
    if (label === 'ContinueWriting') {
      await dispatchAIEditor({ type: 'setSelectedTool', payload: label })
      await dispatchAIEditor({ type: 'setIsUserInputEnabled', payload: false })
      await dispatchAIEditor({ type: 'setIsFeedbackModalOpen' })
    }
    if (label === 'MakeLonger') {
      await dispatchAIEditor({ type: 'setSelectedTool', payload: label })
      await dispatchAIEditor({ type: 'setIsUserInputEnabled', payload: false })
      await dispatchAIEditor({ type: 'setIsFeedbackModalOpen' })
    }
    if (label === 'GenerateQuiz') {
      await dispatchAIEditor({ type: 'setSelectedTool', payload: label })
      await dispatchAIEditor({ type: 'setIsUserInputEnabled', payload: false })
      await dispatchAIEditor({ type: 'setIsFeedbackModalOpen' })
    }
    if (label === 'Translate') {
      await dispatchAIEditor({ type: 'setSelectedTool', payload: label })
      await dispatchAIEditor({ type: 'setIsUserInputEnabled', payload: false })
      await dispatchAIEditor({ type: 'setIsFeedbackModalOpen' })
    }
  }

  return (
    <button
      onClick={() => handleToolButtonClick(props.label)}
      className="flex items-center space-x-1.5 rounded-md bg-white/10 px-2 py-0.5 text-sm font-semibold text-white/70 outline outline-1 outline-neutral-200/20 transition-all delay-75 ease-linear hover:bg-white/20 hover:outline-neutral-200/40"
    >
      {props.label === 'Writer' && <Feather size={14} />}
      {props.label === 'ContinueWriting' && <FastForward size={14} />}
      {props.label === 'MakeLonger' && <FileStack size={14} />}
      {props.label === 'GenerateQuiz' && <HelpCircle size={14} />}
      {props.label === 'Translate' && <Languages size={14} />}
      <span>{props.label}</span>
    </button>
  )
}

const AiEditorActionScreen = ({
  handleOperation,
}: {
  handleOperation: any
}) => {
  const dispatchAIEditor = useAIEditorDispatch() as any
  const aiEditorState = useAIEditor() as AIEditorStateTypes

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await dispatchAIEditor({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  return (
    <div>
      {aiEditorState.selectedTool === 'Writer' &&
        !aiEditorState.isWaitingForResponse &&
        !aiEditorState.error.isError && (
          <div className="space-x-2 text-xl font-extrabold text-white/90">
            <span>Write about...</span>
          </div>
        )}
      {aiEditorState.selectedTool === 'ContinueWriting' &&
        !aiEditorState.isWaitingForResponse &&
        !aiEditorState.error.isError && (
          <div className="mx-auto flex flex-col items-center justify-center align-middle">
            <p className="mx-auto mt-4 flex justify-center p-2 align-middle text-sm font-bold text-white/80">
              Place your cursor at the end of a sentence to continue
              writing{' '}
            </p>
            <div
              onClick={() => {
                handleOperation(
                  aiEditorState.selectedTool,
                  aiEditorState.chatInputValue
                )
              }}
              className="mt-4 flex cursor-pointer items-center space-x-1.5 rounded-md bg-white/10 p-4 text-2xl font-semibold text-white/70 outline outline-1 outline-neutral-200/20 transition-all delay-75 ease-linear hover:bg-white/20 hover:outline-neutral-200/40"
            >
              <FastForward size={24} />
            </div>
          </div>
        )}
      {aiEditorState.selectedTool === 'MakeLonger' &&
        !aiEditorState.isWaitingForResponse &&
        !aiEditorState.error.isError && (
          <div className="mx-auto flex flex-col items-center justify-center align-middle">
            <p className="mx-auto mt-4 flex justify-center p-2 align-middle text-sm font-bold text-white/80">
              Select text to make longer{' '}
            </p>
            <div
              onClick={() => {
                handleOperation(
                  aiEditorState.selectedTool,
                  aiEditorState.chatInputValue
                )
              }}
              className="mt-4 flex cursor-pointer items-center space-x-1.5 rounded-md bg-white/10 p-4 text-2xl font-semibold text-white/70 outline outline-1 outline-neutral-200/20 transition-all delay-75 ease-linear hover:bg-white/20 hover:outline-neutral-200/40"
            >
              <FileStack size={24} />
            </div>
          </div>
        )}
      {aiEditorState.selectedTool === 'Translate' &&
        !aiEditorState.isWaitingForResponse &&
        !aiEditorState.error.isError && (
          <div className="mx-auto flex flex-col items-center justify-center align-middle">
            <div className="mx-auto mt-4 flex justify-center space-x-6 p-2 align-middle text-sm font-bold text-white/80">
              <p>Translate selected text to </p>
              <input
                value={aiEditorState.chatInputValue}
                onChange={handleChange}
                placeholder="Japanese, Arabic, German, etc. "
                className="py- w-full rounded-lg bg-gray-950/20 px-4 text-sm text-white ring-1 ring-white/20 outline-hidden ring-inset placeholder:text-white/30"
              ></input>
            </div>
            <div
              onClick={() => {
                handleOperation(
                  aiEditorState.selectedTool,
                  aiEditorState.chatInputValue
                )
              }}
              className="mt-4 flex cursor-pointer items-center space-x-1.5 rounded-md bg-white/10 p-4 text-2xl font-semibold text-white/70 outline outline-1 outline-neutral-200/20 transition-all delay-75 ease-linear hover:bg-white/20 hover:outline-neutral-200/40"
            >
              <Languages size={24} />
            </div>
          </div>
        )}
      {aiEditorState.isWaitingForResponse && !aiEditorState.error.isError && (
        <div className="mx-auto flex flex-col items-center justify-center align-middle">
          <svg
            className="mt-10 h-10 w-10 animate-spin text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="mt-4 font-bold text-white/90">Thinking...</p>
        </div>
      )}

      {aiEditorState.error.isError && (
        <div className="flex h-auto items-center pt-7">
          <div className="mx-auto flex w-full flex-col space-y-2 rounded-lg bg-red-500/20 p-5 outline outline-1 outline-red-500">
            <AlertTriangle size={20} className="text-red-500" />
            <div className="flex flex-col">
              <h3 className="font-semibold text-red-200">
                Something wrong happened
              </h3>
              <span className="text-sm text-red-100">
                {aiEditorState.error.error_message}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AIEditorToolkit
