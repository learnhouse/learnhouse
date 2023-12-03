import ToolTip from '@components/StyledElements/Tooltip/Tooltip'
import { getUriWithOrg } from '@services/config/config'
import Link from 'next/link'
import React from 'react'


interface Props {
    course: any
    orgslug: string
    course_uuid: string
    current_activity?: any
}

function ActivityIndicators(props: Props) {
    const course = props.course
    const orgslug = props.orgslug
    const courseid = props.course_uuid.replace("course_", "")

    const done_activity_style = 'bg-teal-600 hover:bg-teal-700'
    const black_activity_style = 'bg-black hover:bg-gray-700'
    const current_activity_style = 'bg-gray-600 animate-pulse hover:bg-gray-700'

    const trail = props.course.trail


    function isActivityDone(activity: any) {
        const runs = course.trail.runs;
        for (let run of runs) {
            for (let step of run.steps) {
                if (step.activity_id === activity.id && step.complete === true) {
                    return false;
                }
            }
        }
        return false;
    }

    function isActivityCurrent(activity: any) {
        let activity_uuid = activity.activity_uuid.replace("activity_", "")
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


    return (
        <div className='grid grid-flow-col justify-stretch space-x-6'>
            {course.chapters.map((chapter: any) => {
                return (
                    <>
                        <div className='grid grid-flow-col justify-stretch space-x-2'>
                            {chapter.activities.map((activity: any) => {
                                return (
                                    <ToolTip sideOffset={8} slateBlack content={activity.name} key={activity.activity_uuid}>
                                        <Link href={getUriWithOrg(orgslug, "") + `/course/${courseid}/activity/${activity.activity_uuid.replace("activity_", "")}`}>
                                            <div className={`h-[7px] w-auto ${getActivityClass(activity)} rounded-lg shadow-md`}></div>

                                        </Link>
                                    </ToolTip>
                                );
                            })}
                        </div>
                    </>
                );
            })}
        </div>
    )
}

export default ActivityIndicators