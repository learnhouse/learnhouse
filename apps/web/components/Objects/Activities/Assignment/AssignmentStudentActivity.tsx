import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentSubmission, useAssignmentTaskSubmissions } from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useCourse } from '@components/Contexts/CourseContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getTaskRefFileDir } from '@services/media/media';
import TaskFileObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskFileObject';
import TaskQuizObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskQuizObject'
import TaskFormObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskFormObject'
import TaskCodeObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskCodeObject'
import TaskShortAnswerObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskShortAnswerObject'
import TaskNumberAnswerObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskNumberAnswerObject'
import toast from 'react-hot-toast';
import { Backpack, Calendar, CheckCircle2, Download, EllipsisVertical, Info, MessageSquare, XCircle } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next';

function AssignmentStudentActivity() {
  const { t } = useTranslation()
  const assignments = useAssignments() as any;
  const course = useCourse() as any;
  const org = useOrg() as any;
  const submission = useAssignmentSubmission() as any;
  const taskSubmissionsMap = useAssignmentTaskSubmissions() as Record<string, any> | null;

  // Per-task grading is rendered inline only after the whole assignment has
  // been graded — that's when raw task grades are guaranteed to reflect the
  // server-verified value (auto-grade or teacher override). Before that,
  // task.grade is the placeholder 0 from save-progress.
  const isGraded = Array.isArray(submission) && submission.length > 0 && submission[0].submission_status === 'GRADED';

  useEffect(() => {
  }, [assignments, org])


  return (
    <div className='flex flex-col space-y-4 md:space-y-6'>
      <div className='flex flex-col md:flex-row justify-center md:space-x-3 space-y-3 md:space-y-0 items-center'>
        <div className='text-xs h-fit flex space-x-3 items-center'>
          <div className='flex gap-2 py-2 px-4 md:px-5 h-fit text-sm text-slate-700 bg-slate-100/5 rounded-full nice-shadow items-center'>
            <Backpack size={14} className="md:size-[14px]" />
            <p className='font-semibold'>{t('activities.assignment')}</p>
          </div>
        </div>
        <div>
          <div className='flex gap-2 items-center'>
            <EllipsisVertical className='text-slate-400 hidden md:block' size={18} />
            <div className='flex gap-2 items-center'>
              <div className='flex gap-1 md:space-x-2 text-xs items-center text-slate-400'>
                <Calendar size={14} />
                <p className='font-semibold'>{t('assignments.due_date')}</p>
                <p className='font-semibold'>{assignments?.assignment_object?.due_date}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      
      
      {assignments?.assignment_object?.description && (
        <div className='flex flex-col space-y-2 p-4 md:p-6 bg-slate-100/30 rounded-md nice-shadow'>
          <div className='flex flex-col space-y-3'>
            <div className='flex items-center gap-2 text-slate-700'>
              <Info size={16} className="text-slate-500" />
              <h3 className='text-sm font-semibold'>{t('assignments.assignment_description')}</h3>
            </div>
            <div className='ps-6'>
              <p className='text-sm leading-relaxed text-slate-600'>{assignments.assignment_object.description}</p>
            </div>
          </div>
        </div>
      )}
      
      
      {assignments && assignments?.assignment_tasks?.sort((a: any, b: any) => a.id - b.id).map((task: any, index: number) => {
        const taskSubmission = taskSubmissionsMap ? taskSubmissionsMap[task.assignment_task_uuid] : null;
        const taskGrade = taskSubmission?.grade ?? 0;
        const taskMax = task.max_grade_value || 0;
        const taskFeedback = (taskSubmission?.task_submission_grade_feedback || '').trim();
        const taskPercentage = taskMax > 0 ? Math.round((taskGrade / taskMax) * 100) : 0;
        const taskPassed = taskPercentage >= 60;

        return (
          <div className='flex flex-col space-y-2' key={task.assignment_task_uuid}>
            <div className='flex flex-col md:flex-row md:justify-between py-2 space-y-2 md:space-y-0'>
              <div className='flex flex-wrap space-x-2 font-semibold text-slate-800'>
                <p>{t('assignments.task')} {index + 1} : </p>
                <p className='text-slate-500 break-words'>{task.description}</p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <div
                  onClick={() => toast(task.hint, { icon: 'ℹ️' })}
                  className='px-3 py-1 flex items-center nice-shadow bg-amber-50/40 text-amber-900 rounded-full space-x-2 cursor-pointer'>
                  <Info size={13} />
                  <p className='text-xs font-semibold'>{t('assignments.hint')}</p>
                </div>
                <Link
                  href={getTaskRefFileDir(
                    org?.org_uuid,
                    assignments?.course_object.course_uuid,
                    assignments?.activity_object.activity_uuid,
                    assignments?.assignment_object.assignment_uuid,
                    task.assignment_task_uuid,
                    task.reference_file
                  )}
                  target='_blank'
                  download={true}
                  className='px-3 py-1 flex items-center nice-shadow bg-cyan-50/40 text-cyan-900 rounded-full space-x-1 md:space-x-2 cursor-pointer'>
                  <Download size={13} />
                  <div className='flex items-center space-x-1 md:space-x-2'>
                    {task.reference_file && (
                      <span className='relative'>
                        <span className='absolute end-0 top-0 block h-2 w-2 rounded-full ring-2 ring-white bg-green-400'></span>
                      </span>
                    )}
                    <p className='text-xs font-semibold'>{t('assignments.reference_document')}</p>
                  </div>
                </Link>
              </div>
            </div>
            {isGraded && taskSubmission && (
              <div className={`relative overflow-hidden rounded-xl nice-shadow border ${
                taskPassed
                  ? 'bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-emerald-200/60'
                  : 'bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 border-rose-200/60'
              }`}>
                <div className={`absolute -top-10 -end-10 w-32 h-32 rounded-full blur-3xl opacity-40 ${
                  taskPassed ? 'bg-emerald-300' : 'bg-rose-300'
                }`} />
                <div className='relative p-4 flex flex-col gap-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <div className='flex items-center gap-2.5'>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center bg-white nice-shadow ${
                        taskPassed ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {taskPassed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                      </div>
                      <div className='flex flex-col leading-tight'>
                        <span className={`text-[10px] font-bold uppercase tracking-[0.15em] ${
                          taskPassed ? 'text-emerald-700' : 'text-rose-700'
                        }`}>
                          {taskPassed ? t('assignments.task_passed') : t('assignments.task_not_passed')}
                        </span>
                        <span className='text-[11px] text-slate-500 font-medium'>
                          {taskPercentage}% {t('assignments.score')}
                        </span>
                      </div>
                    </div>
                    <div className='flex items-baseline gap-1 px-3 py-1.5 rounded-lg bg-white nice-shadow'>
                      <span className='text-xl font-black text-slate-900 leading-none tabular-nums'>{taskGrade}</span>
                      <span className='text-xs font-semibold text-slate-400 leading-none'>/ {taskMax}</span>
                    </div>
                  </div>
                  {/* Progress fill */}
                  <div className='h-1.5 w-full rounded-full bg-white/70 overflow-hidden'>
                    <div
                      className={`h-full rounded-full ${taskPassed ? 'bg-emerald-500' : 'bg-rose-500'}`}
                      style={{ width: `${Math.max(0, Math.min(100, taskPercentage))}%` }}
                    />
                  </div>
                  {taskFeedback && (
                    <div className='flex items-start gap-2 p-3 rounded-lg bg-white/70 border border-white'>
                      <MessageSquare size={13} className='shrink-0 mt-0.5 text-slate-400' />
                      <p className='text-xs text-slate-700 leading-relaxed whitespace-pre-wrap'>{taskFeedback}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className='w-full'>
              {task.assignment_type === 'QUIZ' && <TaskQuizObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'FORM' && <TaskFormObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'CODE' && <TaskCodeObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'SHORT_ANSWER' && <TaskShortAnswerObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'NUMBER_ANSWER' && <TaskNumberAnswerObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default AssignmentStudentActivity