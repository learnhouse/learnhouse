import { PencilLine, Rss } from 'lucide-react'
import React from 'react'
import { motion } from 'framer-motion'
import { useFormik } from 'formik'
import * as Form from '@radix-ui/react-form'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/StyledElements/Form/Form'

function CourseUpdates() {
  const [isModelOpen, setIsModelOpen] = React.useState(false)

  function handleModelOpen() {
    setIsModelOpen(!isModelOpen)
  }

  // if user clicks outside the model, close the model
  React.useEffect(() => {
    function handleClickOutside(event: any) {
      if (event.target.closest('.bg-white') === null) {
        setIsModelOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div style={{ position: 'relative' }} className='bg-white hover:bg-neutral-50 transition-all ease-linear nice-shadow rounded-full z-20 px-5 py-1'>
      <div onClick={handleModelOpen} className='flex items-center space-x-2 font-normal hover:cursor-pointer text-gray-600'>
        <div><Rss size={16} /> </div>
        <div className='flex space-x-2 items-center'>
          <span>Updates</span>
          <span className='text-xs px-2 font-bold py-1 rounded-full bg-rose-100 text-rose-900'>5</span>
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
        <UpdatesModel />
      </motion.div>}
    </div>
  )
}

const UpdatesModel = () => {
  return (
    <div className='bg-white/95 backdrop-blur-md nice-shadow rounded-lg w-[700px] overflow-hidden'>
      <div className='bg-gray-50/70 flex justify-between outline outline-1 rounded-lg outline-neutral-200/40'>
        <div className='py-2 px-4 font-bold text-gray-500 flex space-x-2 items-center'>
          <Rss size={16} />
          <span>Updates</span>

        </div>
        <div className='py-2 px-4 space-x-2 items-center flex cursor-pointer text-xs font-medium hover:bg-gray-200 bg-gray-100 outline outline-1  outline-neutral-200/40'>
          <PencilLine size={14} />
          <span>New Update</span>
        </div>
      </div>
      <div className=''>
        <NewUpdateForm />
      </div>
    </div>
  )
}

const NewUpdateForm = () => {

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
    onSubmit: async (values) => { },
    enableReinitialize: true,
  })
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
                style={{ backgroundColor: 'white', height: '100px'}}
                onChange={formik.handleChange}
                value={formik.values.content}
                required
              />
            </Form.Control>
          </FormField>
          <div className='flex justify-end py-2'>
            <button className='bg-black  text-white px-4 py-2 rounded-md text-sm font-bold antialiased'>Add Update</button>
          </div>
        </FormLayout>
      </div>
    </div>
  )
}

const UpdatesListView = () => {
  return (
    <div className='px-5 bg-white overflow-y-auto' style={{ maxHeight: '400px' }}>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
      <div className='py-2 border-b border-neutral-200'>
        <div className='font-bold text-gray-500'>New Update</div>
        <div className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Quos, doloremque.</div>
      </div>
    </div>
  )
}


export default CourseUpdates