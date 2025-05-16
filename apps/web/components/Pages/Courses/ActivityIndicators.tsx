'use client'
import { BookOpenCheck, Check, FileText, Layers, Video } from 'lucide-react'
import React, { useMemo, memo } from 'react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'

interface Props {
  course: any
  orgslug: string
  course_uuid: string
  current_activity?: string
}

// Helper functions
function getActivityTypeLabel(activityType: string): string {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return 'Video'
    case 'TYPE_DOCUMENT':
      return 'Document'
    case 'TYPE_DYNAMIC':
      return 'Interactive'
    case 'TYPE_ASSIGNMENT':
      return 'Assignment'
    default:
      return 'Unknown'
  }
}

function getActivityTypeBadgeColor(activityType: string): string {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return 'bg-blue-100 text-blue-700'
    case 'TYPE_DOCUMENT':
      return 'bg-purple-100 text-purple-700'
    case 'TYPE_DYNAMIC':
      return 'bg-green-100 text-green-700'
    case 'TYPE_ASSIGNMENT':
      return 'bg-orange-100 text-orange-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

// Memoized activity type icon component
const ActivityTypeIcon = memo(({ activityType }: { activityType: string }) => {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return <Video size={16} className="text-gray-400" />
    case 'TYPE_DOCUMENT':
      return <FileText size={16} className="text-gray-400" />
    case 'TYPE_DYNAMIC':
      return <Layers size={16} className="text-gray-400" />
    case 'TYPE_ASSIGNMENT':
      return <BookOpenCheck size={16} className="text-gray-400" />
    default:
      return <FileText size={16} className="text-gray-400" />
  }
});

ActivityTypeIcon.displayName = 'ActivityTypeIcon';

// Memoized activity tooltip content
const ActivityTooltipContent = memo(({ 
  activity, 
  isDone, 
  isCurrent 
}: { 
  activity: any, 
  isDone: boolean, 
  isCurrent: boolean 
}) => (
  <div className="bg-white rounded-lg nice-shadow py-3 px-4 min-w-[200px] animate-in fade-in duration-200">
    <div className="flex items-center gap-2">
      <ActivityTypeIcon activityType={activity.activity_type} />
      <span className="text-sm text-gray-700">{activity.name}</span>
      {isDone && (
        <span className="ml-auto text-gray-400">
          <Check size={14} />
        </span>
      )}
    </div>
    <div className="flex items-center gap-2 mt-2">
      <span className={`text-xs px-2 py-0.5 rounded-full ${getActivityTypeBadgeColor(activity.activity_type)}`}>
        {getActivityTypeLabel(activity.activity_type)}
      </span>
      <span className="text-xs text-gray-400">
        {isCurrent ? 'Current Activity' : isDone ? 'Completed' : 'Not Started'}
      </span>
    </div>
  </div>
));

ActivityTooltipContent.displayName = 'ActivityTooltipContent';

function ActivityIndicators(props: Props) {
  const course = props.course
  const orgslug = props.orgslug
  const courseid = props.course_uuid.replace('course_', '')

  const done_activity_style = 'bg-teal-600 hover:bg-teal-700'
  const black_activity_style = 'bg-zinc-300 hover:bg-zinc-400'
  const current_activity_style = 'bg-gray-600 animate-pulse hover:bg-gray-700'

  const trail = props.course.trail

  // Memoize activity status checks
  const isActivityDone = useMemo(() => (activity: any) => {
    let run = props.course.trail?.runs.find(
      (run: any) => run.course_id == props.course.id
    )
    if (run) {
      return run.steps.find((step: any) => step.activity_id == activity.id)
    }
    return false
  }, [props.course]);

  const isActivityCurrent = useMemo(() => (activity: any) => {
    let activity_uuid = activity.activity_uuid.replace('activity_', '')
    if (props.current_activity && props.current_activity == activity_uuid) {
      return true
    }
    return false
  }, [props.current_activity]);

  const getActivityClass = useMemo(() => (activity: any) => {
    if (isActivityDone(activity)) {
      return done_activity_style
    }
    if (isActivityCurrent(activity)) {
      return current_activity_style
    }
    return black_activity_style
  }, [isActivityDone, isActivityCurrent]);

  return (
    <div className="grid grid-flow-col justify-stretch space-x-6">
      {course.chapters.map((chapter: any) => {
        return (
          <React.Fragment key={chapter.id || `chapter-${chapter.name}`}>
            <div className="grid grid-flow-col justify-stretch space-x-2">
              {chapter.activities.map((activity: any) => {
                const isDone = isActivityDone(activity)
                const isCurrent = isActivityCurrent(activity)
                return (
                  <ToolTip
                    sideOffset={8}
                    unstyled
                    content={
                      <ActivityTooltipContent 
                        activity={activity}
                        isDone={isDone}
                        isCurrent={isCurrent}
                      />
                    }
                    key={activity.activity_uuid}
                  >
                    <Link
                      prefetch={false}
                      href={
                        getUriWithOrg(orgslug, '') +
                        `/course/${courseid}/activity/${activity.activity_uuid.replace(
                          'activity_',
                          ''
                        )}`
                      }
                    >
                      <div
                        className={`h-[7px] w-auto ${getActivityClass(activity)} rounded-lg`}
                      ></div>
                    </Link>
                  </ToolTip>
                )
              })}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default memo(ActivityIndicators)
