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
} from '@components/StyledElements/Form/Form'
import { useCourse } from '@components/Contexts/CourseContext'
import useSWR, { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { useOrg } from '@components/Contexts/OrgContext'
import { createCourseUpdate, deleteCourseUpdate } from '@services/courses/updates'
import toast from 'react-hot-toast'
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal'
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useLHSession } from '@components/Contexts/LHSessionContext'

dayjs.extend(relativeTime);

function CourseUpdates() {
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
          <span>Updates</span>
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
  const [selectedView, setSelectedView] = React.useState('list')
  const adminStatus = useAdminStatus() ;
  return (
    <div className='bg-white/95 backdrop-blur-md nice-shadow rounded-lg w-[700px] overflow-hidden'>
      <div className='bg-gray-50/70 flex justify-between outline outline-1 rounded-lg outline-neutral-200/40'>
        <div className='py-2 px-4 font-bold text-gray-500 flex space-x-2 items-center'>
          <Rss size={16} />
          <span>Updates</span>

        </div>
        {adminStatus.isAdmin && <div
          onClick={() => setSelectedView('new')}
          className='py-2 px-4 space-x-2 items-center flex cursor-pointer text-xs font-medium hover:bg-gray-200 bg-gray-100 outline outline-1  outline-neutral-200/40'>
          <PencilLine size={14} />
          <span>New Update</span>
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
  const org = useOrg() as any;
  const course = useCourse() as any;
  const session = useLHSession() as any;

  const validate = (values: any) => {
    const errors: any = {}

    if (!values.title) {
      errors.title = 'Title is required'
    }
    if (!values.content) {
      errors.content = 'Content is required'
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
        toast.success('Update added successfully')
        setSelectedView('list')
        mutate(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`)
      }
      else {
        toast.error('Failed to add update')
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
        <div className='text-gray-500 px-3 py-0.5 rounded-full font-semibold text-xs'>Test Course </div>
        <div className='text-black px-3 py-0.5 rounded-full text-lg font-bold'>Add new Course Update</div>
      </div>
      <div className='px-5 -py-2'>
        <FormLayout onSubmit={formik.handleSubmit}>
          <FormField name="title">
            <FormLabelAndMessage
              label="Title"
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
              label="Content"
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
            <button onClick={() => setSelectedView('list')} className='text-gray-500 px-4 py-2 rounded-md text-sm font-bold antialiased'>Cancel</button>
            <button className='bg-black  text-white px-4 py-2 rounded-md text-sm font-bold antialiased'>Add Update</button>
          </div>
        </FormLayout>
      </div>
    </div>
  )
}

const UpdatesListView = () => {
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
                title={"Created at " + dayjs(update.creation_date).format('MMMM D, YYYY')}
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
          <p>No updates yet</p>
        </div>
      }
    </div>
  )
}

const DeleteUpdateButton = ({ update }: any) => {
  const session = useLHSession() as any;
  const course = useCourse() as any;
  const org = useOrg() as any;

  const handleDelete = async () => {
    const res = await deleteCourseUpdate(course.courseStructure.course_uuid, update.courseupdate_uuid, session.data?.tokens?.access_token)
    if (res.status === 200) {
      toast.success('Update deleted successfully')
      mutate(`${getAPIUrl()}courses/${course?.courseStructure.course_uuid}/updates`)
    }
    else {
      toast.error('Failed to delete update')
    }
  }

  return (
    <ConfirmationModal
      confirmationButtonText="Delete Update"
      confirmationMessage="Are you sure you want to delete this update?"
      dialogTitle={'Delete Update ?'}
      buttonid='delete-update-button'
      dialogTrigger={
        <div id='delete-update-button' className='text-rose-600 text-xs bg-rose-100 rounded-full px-2 py-0.5 hover:cursor-pointer'>
          Delete
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