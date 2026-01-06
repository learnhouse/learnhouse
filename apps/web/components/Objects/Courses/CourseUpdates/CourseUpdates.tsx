import { PencilLine, Rss, TentTree } from 'lucide-react'
import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useFormik } from 'formik'
import * as Form from '@radix-ui/react-form'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import { useCourse } from '@components/Contexts/CourseContext'
import useSWR, { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useOrg } from '@components/Contexts/OrgContext'
import { createCourseUpdate, deleteCourseUpdate } from '@services/courses/updates'
import toast from 'react-hot-toast'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

dayjs.extend(relativeTime);

function CourseUpdates() {
  const { t } = useTranslation();
  const course = useCourse() as any;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const { data: updates } = useSWR(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`, (url) => swrFetcher(url, access_token))
  const [isModelOpen, setIsModelOpen] = React.useState(false)

  function handleModelOpen() {
    setIsModelOpen(!isModelOpen)
  }

  // if user clicks outside the model, close the model
  React.useLayoutEffect(() => {
    function handleClickOutside(event: any) {
      if (event.target.closest('.bg-white') || event.target.id === 'delete-update-button') return;
      setIsModelOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  return (
    <div style={{ position: 'relative' }} className='bg-white hover:bg-neutral-50 transition-all ease-linear nice-shadow rounded-full z-20 px-5 py-1'>
      <div onClick={handleModelOpen} className='flex items-center space-x-2 font-normal hover:cursor-pointer text-gray-600'>
        <div><Rss size={16} /> </div>
        <div className='flex space-x-2 items-center'>
          <span>{t('courses.updates')}</span>
          {updates && <span className='text-xs px-2 font-bold py-0.5 rounded-full bg-rose-100 text-rose-900'>{updates.length}</span>}
        </div>
      </div>
      {isModelOpen && <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: 'spring',
          stiffness: 1300,
          damping: 70,
        }}
        style={{ position: 'absolute', top: '130%', right: 0 }}
      >
        <UpdatesSection />
      </motion.div>}
    </div>
  )
}

const UpdatesSection = () => {
  const { t } = useTranslation()
  const [selectedView, setSelectedView] = React.useState('list')
  const adminStatus = useAdminStatus() ;
  return (
    <div className='bg-white/95 backdrop-blur-md nice-shadow rounded-lg w-[700px] overflow-hidden'>
      <div className='bg-gray-50/70 flex justify-between outline outline-1 rounded-lg outline-neutral-200/40'>
        <div className='py-2 px-4 font-bold text-gray-500 flex space-x-2 items-center'>
          <Rss size={16} />
          <span>{t('courses.updates')}</span>

        </div>
        {adminStatus.isAdmin && <div
          onClick={() => setSelectedView('new')}
          className='py-2 px-4 space-x-2 items-center flex cursor-pointer text-xs font-medium hover:bg-gray-200 bg-gray-100 outline outline-1  outline-neutral-200/40'>
          <PencilLine size={14} />
          <span>{t('courses.new_update')}</span>
        </div>}
      </div>
      <div className=''>
        {selectedView === 'list' && <UpdatesListView />}
        {selectedView === 'new' && <NewUpdateForm setSelectedView={setSelectedView} />}
      </div>
    </div>
  )
}

const NewUpdateForm = ({ setSelectedView }: any) => {
  const { t } = useTranslation()
  const org = useOrg() as any;
  const course = useCourse() as any;
  const session = useLHSession() as any;

  const validate = (values: any) => {
    const errors: any = {}

    if (!values.title) {
      errors.title = t('validation.title_required')
    }
    if (!values.content) {
      errors.content = t('validation.content_required')
    }

    return errors
  }
  const formik = useFormik({
    initialValues: {
      title: '',
      content: ''
    },
    validate,
    onSubmit: async (values) => {
      const body = {
        title: values.title,
        content: values.content,
        course_uuid: course.courseStructure.course_uuid,
        org_id: org.id
      }
      const res = await createCourseUpdate(body, session.data?.tokens?.access_token)
      if (res.status === 200) {
        toast.success(t('courses.update_added_success'))
        setSelectedView('list')
        mutate(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`)
      }
      else {
        toast.error(t('courses.failed_add_update'))
      }
    },
    enableReinitialize: true,
  })

  useEffect(() => {

  }
    , [course, org])


  return (
    <div className='bg-white/95 backdrop-blur-md nice-shadow rounded-lg w-[700px] overflow-hidden flex flex-col -space-y-2'>
      <div className='flex flex-col -space-y-2 px-4 pt-4'>
        <div className='text-gray-500 px-3 py-0.5 rounded-full font-semibold text-xs'>{course?.courseStructure.name} </div>
        <div className='text-black px-3 py-0.5 rounded-full text-lg font-bold'>{t('courses.add_new_course_update')}</div>
      </div>
      <div className='px-5 -py-2'>
        <FormLayout onSubmit={formik.handleSubmit}>
          <FormField name="title">
            <FormLabelAndMessage
              label={t('courses.update_title')}
              message={formik.errors.title}
            />
            <Form.Control asChild>
              <Input
                style={{ backgroundColor: 'white' }}
                onChange={formik.handleChange}
                value={formik.values.title}
                type="text"
                required
              />
            </Form.Control>
          </FormField>
          <FormField name="content">
            <FormLabelAndMessage
              label={t('courses.update_content')}
              message={formik.errors.content}
            />
            <Form.Control asChild>
              <Textarea
                style={{ backgroundColor: 'white', height: '100px' }}
                onChange={formik.handleChange}
                value={formik.values.content}
                required
              />
            </Form.Control>
          </FormField>
          <div className='flex justify-end py-2'>
            <button onClick={() => setSelectedView('list')} className='text-gray-500 px-4 py-2 rounded-md text-sm font-bold antialiased'>{t('common.cancel')}</button>
            <button className='bg-black  text-white px-4 py-2 rounded-md text-sm font-bold antialiased'>{t('courses.add_update')}</button>
          </div>
        </FormLayout>
      </div>
    </div>
  )
}

const UpdatesListView = () => {
  const { t } = useTranslation()
  const course = useCourse() as any;
  const adminStatus = useAdminStatus() ;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const { data: updates } = useSWR(`${getAPIUrl()}courses/${course?.courseStructure?.course_uuid}/updates`, (url) => swrFetcher(url, access_token))

  return (
    <div className='px-5 bg-white overflow-y-auto' style={{ maxHeight: '400px' }}>
      {updates && !adminStatus.loading && updates.map((update: any) => (
        <div key={update.id} className='py-2 border-b border-neutral-200 antialiased'>
          <div className='font-bold text-gray-500 flex space-x-2 items-center justify-between '>
            <div className='flex space-x-2 items-center'>
              <span> {update.title}</span>
              <span
                title={t('common.created_at') + " " + dayjs(update.creation_date).format('MMMM D, YYYY')}
                className='text-xs font-semibold text-gray-300'>
                {dayjs(update.creation_date).fromNow()}
              </span>
            </div>
            {adminStatus.isAdmin &&  !adminStatus.loading && <DeleteUpdateButton update={update} />}</div>
          <div className='text-gray-600'>{update.content}</div>
        </div>
      ))}
      {(!updates || updates.length === 0) &&
        <div className='text-gray-500 text-center my-10 py-2 flex flex-col space-y-2'>
          <TentTree className='mx-auto' size={40} />
          <p>{t('courses.no_updates_yet')}</p>
        </div>
      }
    </div>
  )
}

const DeleteUpdateButton = ({ update }: any) => {
  const { t } = useTranslation()
  const session = useLHSession() as any;
  const course = useCourse() as any;
  const org = useOrg() as any;

  const handleDelete = async () => {
    const res = await deleteCourseUpdate(course.courseStructure.course_uuid, update.courseupdate_uuid, session.data?.tokens?.access_token)
    const toast_loading = toast.loading(t('courses.deleting_update'))
    if (res.status === 200) {
      toast.dismiss(toast_loading)
      toast.success(t('courses.update_deleted_success'))
      mutate(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`)
    }
    else {
      toast.error(t('courses.failed_delete_update'))
    }
  }

  return (
    <ConfirmationModal
      confirmationButtonText={t('courses.delete_update')}
      confirmationMessage={t('courses.delete_update_confirm')}
      dialogTitle={t('courses.delete_update_title')}
      buttonid='delete-update-button'
      dialogTrigger={
        <div id='delete-update-button' className='text-rose-600 text-xs bg-rose-100 rounded-full px-2 py-0.5 hover:cursor-pointer'>
          {t('common.delete')}
        </div>
      }
      functionToExecute={() => {
        handleDelete()
      }}
      status="warning"
    ></ConfirmationModal>
  )
}


export default CourseUpdates