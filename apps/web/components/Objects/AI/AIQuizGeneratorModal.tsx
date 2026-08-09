import React, { useCallback, useEffect, useState } from 'react'
import { ArrowElbowDownLeft, Check, CircleNotch, ClockCounterClockwise, MagicWand, Sparkle, Trash } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  generateAIQuiz,
  fetchAIQuizHistory,
  deleteAIQuizHistory,
} from '@services/ai/generation'

// AI quiz generator for the editor's blockQuiz. Generates a schema-valid quiz,
// lets the author preview & edit, then inserts it into the Quiz block. Styled to
// match the QuizBlockComponent so the preview reads as the real thing.
interface BlockQuizAnswer {
  answer_id: string
  answer: string
  correct: boolean
}
interface BlockQuizQuestion {
  question_id: string
  question: string
  type: 'multiple_choice' | 'custom_answer'
  answers: BlockQuizAnswer[]
}
interface BlockQuiz {
  quizId: string
  questions: BlockQuizQuestion[]
}

interface AIQuizGeneratorModalProps {
  isOpen: boolean
  onClose: () => void
  onInsert: (_quiz: BlockQuiz) => void
  activityUuid?: string
}

interface QuizHistoryItem {
  ai_generation_uuid: string
  session_uuid?: string
  prompt: string
  quiz: BlockQuiz
  creation_date?: string
}

const AIQuizGeneratorModal: React.FC<AIQuizGeneratorModalProps> = ({
  isOpen,
  onClose,
  onInsert,
  activityUuid,
}) => {
  const org = useOrg() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [tab, setTab] = useState<'generate' | 'history'>('generate')
  const [prompt, setPrompt] = useState('')
  const [numQuestions, setNumQuestions] = useState(5)
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<BlockQuiz | null>(null)
  const [sessionUuid, setSessionUuid] = useState<string | undefined>(undefined)

  const [history, setHistory] = useState<QuizHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!org?.id || !access_token) return
    setHistoryLoading(true)
    const res = await fetchAIQuizHistory(org.id, access_token)
    if (res.success && Array.isArray(res.data)) setHistory(res.data)
    setHistoryLoading(false)
  }, [org?.id, access_token])

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab, loadHistory])

  const handleGenerate = async () => {
    if (!prompt.trim() || generating || !org?.id) return
    setGenerating(true)
    setError(null)
    try {
      const res = await generateAIQuiz(
        {
          org_id: org.id,
          prompt: prompt.trim(),
          activity_uuid: activityUuid,
          session_uuid: sessionUuid,
          num_questions: numQuestions,
          difficulty,
        },
        access_token
      )
      if (!res.success) {
        setError(res.data?.detail || 'Quiz generation failed. Please try again.')
        return
      }
      setQuiz(res.data.quiz)
      setSessionUuid(res.data.session_uuid)
    } catch {
      setError('Quiz generation failed. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  // --- Editable preview helpers ---
  const updateQuestionText = (qid: string, value: string) => {
    if (!quiz) return
    setQuiz({
      ...quiz,
      questions: quiz.questions.map((q) =>
        q.question_id === qid ? { ...q, question: value } : q
      ),
    })
  }
  const updateAnswerText = (qid: string, aid: string, value: string) => {
    if (!quiz) return
    setQuiz({
      ...quiz,
      questions: quiz.questions.map((q) =>
        q.question_id === qid
          ? {
              ...q,
              answers: q.answers.map((a) =>
                a.answer_id === aid ? { ...a, answer: value } : a
              ),
            }
          : q
      ),
    })
  }
  const toggleCorrect = (qid: string, aid: string) => {
    if (!quiz) return
    setQuiz({
      ...quiz,
      questions: quiz.questions.map((q) =>
        q.question_id === qid
          ? {
              ...q,
              answers: q.answers.map((a) =>
                a.answer_id === aid ? { ...a, correct: !a.correct } : a
              ),
            }
          : q
      ),
    })
  }

  const handleInsert = () => {
    if (!quiz) return
    onInsert(quiz)
    onClose()
  }

  const handleDeleteHistory = async (uuid: string) => {
    if (!access_token) return
    await deleteAIQuizHistory(uuid, access_token)
    setHistory((prev) => prev.filter((h) => h.ai_generation_uuid !== uuid))
  }

  const modalContent = (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <button
          onClick={() => setTab('generate')}
          className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
            tab === 'generate' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'
          }`}
        >
          <MagicWand weight="duotone" size={15} /> Generate
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
            tab === 'history' ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100'
          }`}
        >
          <ClockCounterClockwise weight="duotone" size={15} /> History
        </button>
      </div>

      {tab === 'generate' ? (
        <>
          {/* Composer */}
          <div className="p-4 space-y-3 border-b border-neutral-100">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder={
                activityUuid
                  ? 'What should the quiz cover? (grounded on this activity)'
                  : 'What should the quiz cover?'
              }
              className="w-full p-3 border border-neutral-200 rounded-xl resize-none focus:outline-hidden focus:ring-2 focus:ring-neutral-900/10 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                Questions
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(Number(e.target.value))}
                  className="w-16 p-1.5 border border-neutral-200 rounded-lg text-sm"
                />
              </label>
              <div className="flex items-center gap-1">
                {(['easy', 'medium', 'hard'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`px-2.5 py-1 rounded-lg text-xs capitalize transition-colors ${
                      difficulty === d ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="grow" />
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="px-3 py-2 rounded-lg bg-neutral-900 text-white text-sm flex items-center gap-1.5 nice-shadow disabled:opacity-40 transition-opacity"
              >
                {generating ? <CircleNotch weight="duotone" size={15} className="animate-spin" /> : <Sparkle weight="duotone" size={15} />}
                {quiz ? 'Regenerate' : generating ? 'Generating' : 'Generate'}
              </button>
            </div>
            {error && <p className="text-xs text-rose-500">{error}</p>}
            <p className="text-[11px] text-neutral-400">Generating a quiz uses AI credits.</p>
          </div>

          {/* Editable preview */}
          <div className="flex-1 overflow-y-auto p-4 bg-neutral-50/50">
            {!quiz && !generating && (
              <p className="text-center text-sm text-neutral-400 mt-6">
                Your generated quiz will appear here to review before inserting.
              </p>
            )}
            {generating && <div className="w-full h-24 rounded-xl bg-neutral-100 animate-pulse" />}
            {quiz && (
              <div className="space-y-4">
                {quiz.questions.map((q, qi) => (
                  <div key={q.question_id} className="bg-white rounded-lg p-4 nice-shadow">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-neutral-400">Q{qi + 1}</span>
                    </div>
                    <input
                      value={q.question}
                      onChange={(e) => updateQuestionText(q.question_id, e.target.value)}
                      className="text-neutral-800 bg-transparent border-2 border-dashed border-neutral-200 rounded-lg text-base font-semibold w-full p-2 focus:border-neutral-300 outline-none transition-colors mb-2"
                    />
                    <div className="space-y-2">
                      {q.answers.map((a) => (
                        <div
                          key={a.answer_id}
                          className={`flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 transition-colors ${
                            a.correct ? 'border-emerald-400 bg-emerald-50' : 'border-neutral-200 bg-neutral-50'
                          }`}
                        >
                          <button
                            onClick={() => toggleCorrect(q.question_id, a.answer_id)}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                              a.correct ? 'bg-emerald-400 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                            }`}
                            title={a.correct ? 'Marked correct' : 'Mark correct'}
                          >
                            <Check weight="duotone" size={14} />
                          </button>
                          <input
                            value={a.answer}
                            onChange={(e) => updateAnswerText(q.question_id, a.answer_id, e.target.value)}
                            className="flex-1 text-neutral-700 bg-transparent border-0 text-sm font-medium outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {quiz && (
            <div className="border-t border-neutral-100 p-3 flex justify-end">
              <button
                onClick={handleInsert}
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm flex items-center gap-1.5 nice-shadow"
              >
                <ArrowElbowDownLeft weight="duotone" size={15} data-dir-flip /> Insert into editor
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {historyLoading ? (
            <p className="text-center text-sm text-neutral-400 mt-6">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-center text-sm text-neutral-400 mt-6">No generated quizzes yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.ai_generation_uuid}
                  className="flex items-center gap-3 bg-white rounded-lg p-3 nice-shadow"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-700 truncate">{h.prompt}</p>
                    <p className="text-[11px] text-neutral-400">
                      {h.quiz?.questions?.length || 0} question(s)
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setQuiz(h.quiz)
                      setSessionUuid(h.session_uuid)
                      setTab('generate')
                    }}
                    className="px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-sm text-neutral-700"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => handleDeleteHistory(h.ai_generation_uuid)}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400"
                    title="Delete"
                  >
                    <Trash weight="duotone" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <Modal
      dialogTitle="Generate a quiz with AI"
      dialogContent={modalContent}
      onOpenChange={onClose}
      isDialogOpen={isOpen}
      minWidth="lg"
      minHeight="lg"
      customHeight="h-[80vh]"
      noPadding
    />
  )
}

export default AIQuizGeneratorModal
