'use client'
import EditCourseStructure from '../../../../../../../../components/Dashboard/Course/EditCourseStructure/EditCourseStructure'
import { getUriWithOrg } from '@services/config/config'
import React from 'react'
import { CourseProvider } from '../../../../../../../../components/Contexts/CourseContext'
import Link from 'next/link'
import { CourseOverviewTop } from '@components/Dashboard/UI/CourseOverviewTop'
import { motion } from 'framer-motion'
import EditCourseGeneral from '@components/Dashboard/Course/EditCourseGeneral/EditCourseGeneral'
import { GalleryVerticalEnd, Info, UserRoundCog } from 'lucide-react'
import EditCourseAccess from '@components/Dashboard/Course/EditCourseAccess/EditCourseAccess'

export type CourseOverviewParams = {
  orgslug: string
  courseuuid: string
  subpage: string
}

function CourseOverviewPage({ params }: { params: CourseOverviewParams }) {
  function getEntireCourseUUID(courseuuid: string) {
    // add course_ to uuid
    return `course_${courseuuid}`
  }

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto,1fr]">
      <CourseProvider courseuuid={getEntireCourseUUID(params.courseuuid)}>
        <div className="pl-10 pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 shadow-[0px_4px_16px_rgba(0,0,0,0.06)]">
          <CourseOverviewTop params={params} />
          <div className="flex space-x-3 font-black text-sm">
            <Link
              href={
                getUriWithOrg(params.orgslug, '') +
                `/dash/courses/course/${params.courseuuid}/general`
              }
            >
              <div
                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'general'
                  ? 'border-b-4'
                  : 'opacity-50'
                  } cursor-pointer`}
              >
                <div className="flex items-center space-x-2.5 mx-2">
                  <Info size={16} />
                  <div>General</div>
                </div>
              </div>
            </Link>
            <Link
              href={
                getUriWithOrg(params.orgslug, '') +
                `/dash/courses/course/${params.courseuuid}/access`
              }
            >
              <div
                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'access'
                  ? 'border-b-4'
                  : 'opacity-50'
                  } cursor-pointer`}
              >
                <div className="flex items-center space-x-2.5 mx-2">
                  <UserRoundCog size={16} />
                  <div>Access</div>
                </div>
              </div>
            </Link>
            <Link
              href={
                getUriWithOrg(params.orgslug, '') +
                `/dash/courses/course/${params.courseuuid}/content`
              }
            >
              <div
                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'content'
                  ? 'border-b-4'
                  : 'opacity-50'
                  } cursor-pointer`}
              >
                <div className="flex items-center space-x-2.5 mx-2">
                  <GalleryVerticalEnd size={16} />
                  <div>Content</div>
                </div>
              </div>
            </Link>
          </div>

        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
          className="h-full overflow-y-auto"
        >
          {params.subpage == 'content' ? (<EditCourseStructure orgslug={params.orgslug} />) : ('')}
          {params.subpage == 'general' ? (<EditCourseGeneral orgslug={params.orgslug} />) : ('')}
          {params.subpage == 'access' ? (<EditCourseAccess orgslug={params.orgslug} />) : ('')}
        </motion.div>
      </CourseProvider>
    </div>
  )
}

export default CourseOverviewPage
