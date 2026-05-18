export type ActivityType =
  | 'TYPE_DYNAMIC'
  | 'TYPE_VIDEO'
  | 'TYPE_DOCUMENT'
  | 'TYPE_ASSIGNMENT'
  | 'TYPE_CUSTOM'
  | 'TYPE_SCORM'

export type ActivitySubType =
  | 'SUBTYPE_DYNAMIC_PAGE'
  | 'SUBTYPE_DYNAMIC_MARKDOWN'
  | 'SUBTYPE_DYNAMIC_EMBED'
  | 'SUBTYPE_VIDEO_YOUTUBE'
  | 'SUBTYPE_VIDEO_HOSTED'
  | 'SUBTYPE_DOCUMENT_PDF'
  | string

export interface Activity {
  id?: number
  activity_uuid?: string
  name: string
  activity_type: ActivityType
  activity_sub_type?: ActivitySubType
  content: any
  details?: any
  published?: boolean
  lock_type?: 'PUBLIC' | 'AUTHENTICATED' | 'RESTRICTED'
  current_version?: number
  detail?: string
  [key: string]: any
}

export interface Chapter {
  id?: number
  chapter_uuid?: string
  name: string
  activities?: Activity[]
  [key: string]: any
}

export interface Course {
  id?: number
  course_uuid: string
  name: string
  description?: string
  thumbnail_image?: string
  public?: boolean
  published?: boolean
  org_id?: number
  [key: string]: any
}

export interface CourseStructure extends Course {
  chapters?: Chapter[]
  detail?: string
}
