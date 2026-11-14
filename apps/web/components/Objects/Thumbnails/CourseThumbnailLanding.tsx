'use client'
import React from 'react'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'

export { removeCoursePrefix } from '@components/Objects/Thumbnails/CourseThumbnail'

type PropsType = {
  course: any
  orgslug: string
  customLink?: string
}

// Landing pages show the same course card as the catalog; kept as its own
// export so existing landing blocks keep importing it by this name.
const CourseThumbnailLanding: React.FC<PropsType> = ({ course, orgslug, customLink }) => (
  <CourseThumbnail course={course} orgslug={orgslug} customLink={customLink} />
)

export default CourseThumbnailLanding
