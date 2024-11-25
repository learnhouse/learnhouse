import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form'
import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'

function DynamicCanvaModal({ submitActivity, chapterId, course }: any) {
  const [activityName, setActivityName] = useState('')
  const [activityDescription, setActivityDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleActivityNameChange = (e: any) => {
    setActivityName(e.target.value)
  }

  const handleActivityDescriptionChange = (e: any) => {
    setActivityDescription(e.target.value)
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)
    await submitActivity({
      name: activityName,
      chapter_id: chapterId,
      activity_type: 'TYPE_DYNAMIC',
      activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
      published_version: 1,
      version: 1,
      course_id: course.id,
    })
    setIsSubmitting(false)
  }
  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="dynamic-activity-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Activity name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a name for your activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleActivityNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="dynamic-activity-desc">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Activity description</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a description for your activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Textarea onChange={handleActivityDescriptionChange}  />
        </Form.Control>
      </FormField>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack type="submit" css={{ marginTop: 10 }}>
            {isSubmitting ? (
              <BarLoader
                cssOverride={{ borderRadius: 60 }}
                width={60}
                color="#ffffff"
              />
            ) : (
              'Create activity'
            )}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  )
}

export default DynamicCanvaModal
