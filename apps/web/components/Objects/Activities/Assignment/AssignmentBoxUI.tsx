import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  BookPlus,
  BookUser,
  EllipsisVertical,
  FileUp,
  Forward,
  InfoIcon,
  ListTodo,
  Save,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'

type AssignmentBoxProps = {
  type: 'quiz' | 'file'
  view?: 'teacher' | 'student' | 'grading' | 'custom-grading'
  maxPoints?: number
  currentPoints?: number
  saveFC?: () => void
  submitFC?: () => void
  gradeFC?: () => void
  gradeCustomFC?: (grade: number) => void
  showSavingDisclaimer?: boolean
  children: ReactNode
}

function AssignmentBoxUI({
  type,
  view,
  currentPoints,
  maxPoints,
  saveFC,
  submitFC,
  gradeFC,
  gradeCustomFC,
  showSavingDisclaimer,
  children,
}: AssignmentBoxProps) {
  const [customGrade, setCustomGrade] = useState<number>(0)
  const submission = useAssignmentSubmission() as any
  const session = useLHSession() as any

  useEffect(() => {
    console.log(submission)
  }, [submission])

  // Check if user is authenticated
  const isAuthenticated = session?.status === 'authenticated'

  return (
    <div className="nice-shadow flex flex-col rounded-md bg-slate-100/30 px-3 py-4 sm:px-6">
      <div className="flex flex-col pb-2 text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:space-x-2">
        {/* Left side with type and badges */}
        <div className="mb-2 flex flex-wrap items-center gap-2 sm:mb-0">
          <div className="text-lg font-semibold">
            {type === 'quiz' && (
              <div className="flex items-center space-x-1.5">
                <ListTodo size={17} />
                <p>Quiz</p>
              </div>
            )}
            {type === 'file' && (
              <div className="flex items-center space-x-1.5">
                <FileUp size={17} />
                <p>File Submission</p>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-1">
            <EllipsisVertical size={15} />
          </div>
          {view === 'teacher' && (
            <div className="flex items-center space-x-1 rounded-full bg-amber-200/20 px-2 py-0.5 text-xs font-bold text-amber-600 outline outline-1 outline-amber-300/40">
              <BookUser size={12} />
              <p>Teacher view</p>
            </div>
          )}
          {maxPoints && (
            <div className="flex items-center space-x-1 rounded-full bg-emerald-200/20 px-2 py-0.5 text-xs font-bold text-emerald-600 outline outline-1 outline-emerald-300/40">
              <BookPlus size={12} />
              <p>{maxPoints} points</p>
            </div>
          )}
        </div>

        {/* Right side with buttons and actions */}
        <div className="flex flex-wrap items-center gap-2">
          {showSavingDisclaimer && (
            <div className="mb-2 flex w-full items-center space-x-2 rounded-full px-3 py-1 font-semibold text-red-400 outline-red-200 outline-dashed sm:mr-5 sm:mb-0 sm:w-auto">
              <InfoIcon size={14} />
              <p className="text-xs">Don't forget to save your progress</p>
            </div>
          )}

          {/* Teacher button */}
          {view === 'teacher' && (
            <div
              onClick={() => saveFC && saveFC()}
              className="linear flex cursor-pointer items-center space-x-2 rounded-md bg-emerald-300/20 bg-linear-to-bl px-2 py-1 text-emerald-700 outline-offset-2 outline-emerald-500/60 transition-all outline-dashed hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1"
            >
              <Save size={14} />
              <p className="text-xs font-semibold">Save</p>
            </div>
          )}

          {/* Student button - only show if authenticated */}
          {view === 'student' &&
            isAuthenticated &&
            submission &&
            submission.length <= 0 && (
              <div
                onClick={() => submitFC && submitFC()}
                className="linear mx-auto flex w-full cursor-pointer items-center justify-center space-x-2 rounded-md bg-emerald-300/20 bg-linear-to-bl px-2 py-1 text-emerald-700 outline-offset-2 outline-emerald-500/60 transition-all outline-dashed hover:bg-emerald-300/10 hover:outline-offset-4 active:outline-offset-1 sm:w-auto"
              >
                <Forward size={14} />
                <p className="text-xs font-semibold">Save your progress</p>
              </div>
            )}

          {/* Grading button */}
          {view === 'grading' && (
            <div className="linear flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-md bg-linear-to-bl px-0.5 py-0.5 outline-offset-2 outline-orange-500/60 transition-all outline-dashed hover:outline-offset-4 active:outline-offset-1 sm:w-auto sm:flex-nowrap sm:space-x-2">
              <p className="px-2 text-xs font-semibold text-orange-700">
                Current points: {currentPoints}
              </p>
              <div
                onClick={() => gradeFC && gradeFC()}
                className="ml-auto flex items-center space-x-2 rounded-md bg-orange-300/20 bg-linear-to-bl px-2 py-1 text-orange-700 hover:bg-orange-300/10"
              >
                <BookPlus size={14} />
                <p className="text-xs font-semibold">Grade</p>
              </div>
            </div>
          )}

          {/* CustomGrading button */}
          {view === 'custom-grading' && maxPoints && (
            <div className="linear flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-md bg-linear-to-bl px-0.5 py-0.5 outline-offset-2 outline-orange-500/60 transition-all outline-dashed hover:outline-offset-4 active:outline-offset-1 sm:w-auto sm:flex-nowrap sm:space-x-2">
              <p className="w-full px-2 text-xs font-semibold text-orange-700 sm:w-auto">
                Current points: {currentPoints}
              </p>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <input
                  onChange={(e) =>
                    setCustomGrade(Number.parseInt(e.target.value))
                  }
                  placeholder={maxPoints.toString()}
                  className="light-shadow w-full rounded-lg px-2 py-0.5 text-sm outline outline-gray-200 sm:w-[100px]"
                  type="number"
                />
                <div
                  onClick={() => gradeCustomFC && gradeCustomFC(customGrade)}
                  className="flex items-center space-x-2 rounded-md bg-orange-300/20 bg-linear-to-bl px-2 py-1 whitespace-nowrap text-orange-700 hover:bg-orange-300/10"
                >
                  <BookPlus size={14} />
                  <p className="text-xs font-semibold">Grade</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

export default AssignmentBoxUI
