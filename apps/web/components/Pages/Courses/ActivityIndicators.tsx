import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'
import React from 'react'
import { Video, FileText, Layers, BookOpenCheck, Check } from 'lucide-react'

interface Props {
  course: any
  orgslug: string
  course_uuid: string
  current_activity?: any
}

function ActivityIndicators(props: Props) {
  const course = props.course
  const orgslug = props.orgslug
  const courseid = props.course_uuid.replace('course_', '')

  const done_activity_style = 'bg-teal-600 hover:bg-teal-700'
  const black_activity_style = 'bg-zinc-300 hover:bg-zinc-400'
  const current_activity_style = 'bg-gray-600 animate-pulse hover:bg-gray-700'

  const trail = props.course.trail

  function isActivityDone(activity: any) {
    let run = props.course.trail?.runs.find(
      (run: any) => run.course_id == props.course.id
    )
    if (run) {
      return run.steps.find((step: any) => step.activity_id == activity.id)
    } else {
      return false
    }
  }

  function isActivityCurrent(activity: any) {
    let activity_uuid = activity.activity_uuid.replace('activity_', '')
    if (props.current_activity && props.current_activity == activity_uuid) {
      return true
    }
    return false
  }

  function getActivityClass(activity: any) {
    if (isActivityDone(activity)) {
      return done_activity_style
    }
    if (isActivityCurrent(activity)) {
      return current_activity_style
    }
    return black_activity_style
  }

  const getActivityTypeIcon = (activityType: string) => {
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
  }

  const getActivityTypeLabel = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return 'Video'
      case 'TYPE_DOCUMENT':
        return 'Document'
      case 'TYPE_DYNAMIC':
        return 'Page'
      case 'TYPE_ASSIGNMENT':
        return 'Assignment'
      default:
        return 'Learning Material'
    }
  }

  const getActivityTypeBadgeColor = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return 'bg-blue-50 text-blue-600 font-bold'
      case 'TYPE_DOCUMENT':
        return 'bg-orange-50 text-orange-600 font-bold'
      case 'TYPE_DYNAMIC':
        return 'bg-purple-50 text-purple-600 font-bold'
      case 'TYPE_ASSIGNMENT':
        return 'bg-green-50 text-green-600 font-bold'
      default:
        return 'bg-gray-50 text-gray-600 font-bold'
    }
  }

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
                      <div className="bg-white rounded-lg nice-shadow py-3 px-4 min-w-[200px] animate-in fade-in duration-200">
                        <div className="flex items-center gap-2">
                          {getActivityTypeIcon(activity.activity_type)}
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
                        className={`h-[7px] w-auto ${getActivityClass(
                          activity
                        )} rounded-lg`}
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

export default ActivityIndicators
