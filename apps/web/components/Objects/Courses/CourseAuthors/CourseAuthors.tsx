import React, { useState } from 'react'
import UserAvatar from '../../UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useMediaQuery } from 'usehooks-ts'
import { Rss, PencilLine, TentTree } from 'lucide-react'
import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import useSWR, { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useOrg } from '@components/Contexts/OrgContext'
import { createCourseUpdate, deleteCourseUpdate } from '@services/courses/updates'
import toast from 'react-hot-toast'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import * as Form from '@radix-ui/react-form'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import { useFormik } from 'formik'
import { motion } from 'framer-motion'

dayjs.extend(relativeTime)

interface Author {
  user: {
    id: string
    user_uuid: string
    avatar_image: string
    first_name: string
    last_name: string
    username: string
  }
  authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
  authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
}

interface CourseAuthorsProps {
  authors: Author[]
}

const MultipleAuthors = ({ authors, isMobile }: { authors: Author[], isMobile: boolean }) => {
  const displayedAvatars = authors.slice(0, 3)
  const displayedNames = authors.slice(0, 2)
  const remainingCount = Math.max(0, authors.length - 3)
  
  // Consistent sizes for both avatars and badge
  const avatarSize = isMobile ? 72 : 86
  const borderSize = "border-4"

  return (
    <div className="flex flex-col items-center space-y-4 px-2 py-2">
      <div className="text-[12px] text-neutral-400 font-semibold self-start">Authors & Updates </div>
      
      {/* Avatars row */}
      <div className="flex justify-center -space-x-6 relative">
        {displayedAvatars.map((author, index) => (
          <div
            key={author.user.user_uuid}
            className="relative"
            style={{ zIndex: displayedAvatars.length - index }}
          >
            <div className="ring-white">
              <UserAvatar
                border={borderSize}
                rounded='rounded-full'
                avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                width={avatarSize}
                showProfilePopup={true}
                userId={author.user.id}
              />
            </div>
          </div>
        ))}
        {remainingCount > 0 && (
          <div 
            className="relative"
            style={{ zIndex: 0 }}
          >
            <div 
              className="flex items-center justify-center bg-neutral-100 text-neutral-600 font-medium rounded-full border-4 border-white shadow-sm"
              style={{ 
                width: `${avatarSize}px`, 
                height: `${avatarSize}px`,
                fontSize: isMobile ? '14px' : '16px'
              }}
            >
              +{remainingCount}
            </div>
          </div>
        )}
      </div>

      {/* Names row - improved display logic */}
      <div className="text-center mt-2">
        <div className="text-sm font-medium text-neutral-800">
          {authors.length === 1 ? (
            <span>
              {authors[0].user.first_name && authors[0].user.last_name
                ? `${authors[0].user.first_name} ${authors[0].user.last_name}`
                : `@${authors[0].user.username}`}
            </span>
          ) : (
            <>
              {displayedNames.map((author, index) => (
                <span key={author.user.user_uuid}>
                  {author.user.first_name && author.user.last_name
                    ? `${author.user.first_name} ${author.user.last_name}`
                    : `@${author.user.username}`}
                  {index === 0 && authors.length > 1 && index < displayedNames.length - 1 && " & "}
                </span>
              ))}
              {authors.length > 2 && (
                <span className="text-neutral-500 ml-1">
                  & {authors.length - 2} more
                </span>
              )}
            </>
          )}
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">
          {authors.length === 1 ? (
            <span>@{authors[0].user.username}</span>
          ) : (
            <>
              {displayedNames.map((author, index) => (
                <span key={author.user.user_uuid}>
                  @{author.user.username}
                  {index === 0 && authors.length > 1 && index < displayedNames.length - 1 && " & "}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const UpdatesSection = () => {
  const [selectedView, setSelectedView] = React.useState('list')
  const adminStatus = useAdminStatus()
  const course = useCourse() as any
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { data: updates } = useSWR(
    `${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`,
    (url) => swrFetcher(url, access_token)
  )

  return (
    <div className="mt-2 pt-2">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Rss size={14} className="text-neutral-400" />
            <span className="text-sm font-semibold text-neutral-600">Course Updates</span>
          </div>
          {updates && updates.length > 0 && (
            <span className="px-2 py-0.5 text-[11px] font-medium bg-neutral-100 text-neutral-500 rounded-full">
              {updates.length} {updates.length === 1 ? 'update' : 'updates'}
            </span>
          )}
        </div>
        {adminStatus.isAdmin && (
          <button
            onClick={() => setSelectedView(selectedView === 'new' ? 'list' : 'new')}
            className={`
              inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium
              transition-colors duration-150
              ${selectedView === 'new' 
                ? 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300' 
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }
            `}
          >
            <PencilLine size={12} />
            <span>{selectedView === 'new' ? 'Cancel' : 'New Update'}</span>
          </button>
        )}
      </div>
      
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="relative"
      >
        <div className="max-h-[300px] overflow-y-auto pr-1 -mr-1">
          {selectedView === 'list' ? (
            <UpdatesListView />
          ) : (
            <NewUpdateForm setSelectedView={setSelectedView} />
          )}
        </div>
      </motion.div>
    </div>
  )
}

const NewUpdateForm = ({ setSelectedView }: { setSelectedView: (view: string) => void }) => {
  const org = useOrg() as any
  const course = useCourse() as any
  const session = useLHSession() as any

  const formik = useFormik({
    initialValues: {
      title: '',
      content: ''
    },
    validate: (values) => {
      const errors: any = {}
      if (!values.title) errors.title = 'Title is required'
      if (!values.content) errors.content = 'Content is required'
      return errors
    },
    onSubmit: async (values) => {
      const body = {
        title: values.title,
        content: values.content,
        course_uuid: course.courseStructure.course_uuid,
        org_id: org.id
      }
      const res = await createCourseUpdate(body, session.data?.tokens?.access_token)
      if (res.status === 200) {
        toast.success('Update added successfully')
        setSelectedView('list')
        mutate(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`)
      } else {
        toast.error('Failed to add update')
      }
    }
  })

  return (
    <div className="space-y-4">
      <FormLayout onSubmit={formik.handleSubmit} className="space-y-4">
        <FormField name="title">
          <FormLabelAndMessage
            label="Update Title"
            message={formik.errors.title}
          />
          <Form.Control asChild>
            <Input
              onChange={formik.handleChange}
              value={formik.values.title}
              type="text"
              required
              placeholder="What's new in this update?"
              className="bg-white border-neutral-200 focus:border-neutral-300 focus:ring-neutral-200"
            />
          </Form.Control>
        </FormField>
        <FormField name="content">
          <FormLabelAndMessage
            label="Update Content"
            message={formik.errors.content}
          />
          <Form.Control asChild>
            <Textarea
              onChange={formik.handleChange}
              value={formik.values.content}
              required
              placeholder="Share the details of your update..."
              className="bg-white h-[120px] border-neutral-200 focus:border-neutral-300 focus:ring-neutral-200 resize-none"
            />
          </Form.Control>
        </FormField>
        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="submit"
            className="px-4 py-1.5 bg-neutral-900 hover:bg-black text-white text-xs font-medium rounded-full transition-colors duration-150"
          >
            Publish Update
          </button>
        </div>
      </FormLayout>
    </div>
  )
}

const UpdatesListView = () => {
  const course = useCourse() as any
  const adminStatus = useAdminStatus()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { data: updates } = useSWR(
    `${getAPIUrl()}courses/${course?.courseStructure?.course_uuid}/updates`,
    (url) => swrFetcher(url, access_token)
  )

  if (!updates || updates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center bg-neutral-50/50 rounded-lg border border-dashed border-neutral-200">
        <TentTree size={28} className="text-neutral-400 mb-2" />
        <p className="text-sm text-neutral-600 font-medium">No updates yet</p>
        <p className="text-xs text-neutral-400 mt-1">Updates about this course will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {updates.map((update: any) => (
        <motion.div
          key={update.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="group p-3 rounded-lg bg-neutral-50/50 hover:bg-neutral-100/80 transition-colors duration-150"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-baseline space-x-2">
                <h4 className="text-sm font-medium text-neutral-800 truncate">{update.title}</h4>
                <span
                  title={dayjs(update.creation_date).format('MMMM D, YYYY')}
                  className="text-[11px] font-medium text-neutral-400 whitespace-nowrap"
                >
                  {dayjs(update.creation_date).fromNow()}
                </span>
              </div>
              <p className="text-sm text-neutral-600 line-clamp-3">{update.content}</p>
            </div>
            {adminStatus.isAdmin && !adminStatus.loading && (
              <div className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <DeleteUpdateButton update={update} />
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

const DeleteUpdateButton = ({ update }: any) => {
  const session = useLHSession() as any
  const course = useCourse() as any

  const handleDelete = async () => {
    const toast_loading = toast.loading('Deleting update...')
    const res = await deleteCourseUpdate(
      course.courseStructure.course_uuid,
      update.courseupdate_uuid,
      session.data?.tokens?.access_token
    )
    
    if (res.status === 200) {
      toast.dismiss(toast_loading)
      toast.success('Update deleted successfully')
      mutate(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`)
    } else {
      toast.error('Failed to delete update')
    }
  }

  return (
    <ConfirmationModal
      confirmationButtonText="Delete Update"
      confirmationMessage="Are you sure you want to delete this update?"
      dialogTitle="Delete Update?"
      buttonid="delete-update-button"
      dialogTrigger={
        <button
          id="delete-update-button"
          className="p-1.5 text-neutral-400 hover:text-rose-500 rounded-full hover:bg-rose-50 transition-all duration-150"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      }
      functionToExecute={handleDelete}
      status="warning"
    />
  )
}

const CourseAuthors = ({ authors }: CourseAuthorsProps) => {
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Filter active authors and sort by role priority
  const sortedAuthors = [...authors]
    .filter(author => author.authorship_status === 'ACTIVE')
    .sort((a, b) => {
      const rolePriority: Record<string, number> = {
        'CREATOR': 0,
        'MAINTAINER': 1,
        'CONTRIBUTOR': 2,
        'REPORTER': 3
      };
      return rolePriority[a.authorship] - rolePriority[b.authorship];
    });

  return (
    <div className="antialiased">
      <MultipleAuthors authors={sortedAuthors} isMobile={isMobile} />
      <UpdatesSection />
    </div>
  )
}

export default CourseAuthors 