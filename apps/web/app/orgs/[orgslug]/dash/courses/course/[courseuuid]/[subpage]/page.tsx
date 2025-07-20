'use client'
import { getUriWithOrg } from '@services/config/config'
import React, { use } from 'react';
import { CourseProvider } from '../../../../../../../../components/Contexts/CourseContext'
import Link from 'next/link'
import { CourseOverviewTop } from '@components/Dashboard/Misc/CourseOverviewTop'
import { motion } from 'framer-motion'
import { GalleryVerticalEnd, Globe, Info, UserPen, UserRoundCog, Users, Award } from 'lucide-react'
import EditCourseStructure from '@components/Dashboard/Pages/Course/EditCourseStructure/EditCourseStructure'
import EditCourseGeneral from '@components/Dashboard/Pages/Course/EditCourseGeneral/EditCourseGeneral'
import EditCourseAccess from '@components/Dashboard/Pages/Course/EditCourseAccess/EditCourseAccess'
import EditCourseContributors from '@components/Dashboard/Pages/Course/EditCourseContributors/EditCourseContributors'
import EditCourseCertification from '@components/Dashboard/Pages/Course/EditCourseCertification/EditCourseCertification'
export type CourseOverviewParams = {
  orgslug: string
  courseuuid: string
  subpage: string
}

function CourseOverviewPage(props: { params: Promise<CourseOverviewParams> }) {
  const params = use(props.params);
  function getEntireCourseUUID(courseuuid: string) {
    // add course_ to uuid
    return `course_${courseuuid}`
  }

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr]">
      <CourseProvider courseuuid={getEntireCourseUUID(params.courseuuid)} withUnpublishedActivities={true}>
        <div className="pl-10 pr-10 text-sm tracking-tight bg-[#fcfbfc] z-10 nice-shadow">
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
                  <Globe size={16} />
                  <div>Access</div>
                </div>
              </div>
            </Link>
            <Link
              href={
                getUriWithOrg(params.orgslug, '') +
                `/dash/courses/course/${params.courseuuid}/contributors`
              }
            >
              <div
                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'contributors'
                  ? 'border-b-4'
                  : 'opacity-50'
                  } cursor-pointer`}
              >
                <div className="flex items-center space-x-2.5 mx-2">
                  <UserPen size={16} />
                  <div>Contributors</div>
                </div>
              </div>
            </Link>
            <Link
              href={
                getUriWithOrg(params.orgslug, '') +
                `/dash/courses/course/${params.courseuuid}/certification`
              }
            >
              <div
                className={`flex space-x-4 py-2 w-fit text-center border-black transition-all ease-linear ${params.subpage.toString() === 'certification'
                  ? 'border-b-4'
                  : 'opacity-50'
                  } cursor-pointer`}
              >
                <div className="flex items-center space-x-2.5 mx-2">
                  <Award size={16} />
                  <div>Certification</div>
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
          className="h-full overflow-y-auto relative"
        >
          <div className="absolute inset-0">
            {params.subpage == 'content' ? (<EditCourseStructure orgslug={params.orgslug} />) : ('')}
            {params.subpage == 'general' ? (<EditCourseGeneral orgslug={params.orgslug} />) : ('')}
            {params.subpage == 'access' ? (<EditCourseAccess orgslug={params.orgslug} />) : ('')}
            {params.subpage == 'contributors' ? (<EditCourseContributors orgslug={params.orgslug} />) : ('')}
            {params.subpage == 'certification' ? (<EditCourseCertification orgslug={params.orgslug} />) : ('')}
            
          </div>
        </motion.div>
      </CourseProvider>
    </div>
  )
}

export default CourseOverviewPage
