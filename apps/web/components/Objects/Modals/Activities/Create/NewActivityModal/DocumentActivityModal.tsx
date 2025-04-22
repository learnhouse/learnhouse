import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  FormMessage,
  Input,
} from '@components/Objects/StyledElements/Form/Form'
import React, { useState } from 'react'
import * as Form from '@radix-ui/react-form'
import BarLoader from 'react-spinners/BarLoader'
import { constructAcceptValue } from '@/lib/constants';

const SUPPORTED_FILES = constructAcceptValue(['pdf'])

function DocumentPdfModal({ submitFileActivity, chapterId, course }: any) {
  const [documentpdf, setDocumentPdf] = React.useState(null) as any
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = React.useState('')

  const handleDocumentPdfChange = (event: React.ChangeEvent<any>) => {
    setDocumentPdf(event.target.files[0])
  }

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value)
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)
    let status = await submitFileActivity(
      documentpdf,
      'documentpdf',
      {
        name: name,
        chapter_id: chapterId,
        activity_type: 'TYPE_DOCUMENT',
        activity_sub_type: 'SUBTYPE_DOCUMENT_PDF',
        published_version: 1,
        version: 1,
        course_id: course.id,
      },
      chapterId
    )
    setIsSubmitting(false)
  }

  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="documentpdf-activity-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>PDF Document name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a name for your PDF Document activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="documentpdf-activity-file">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>PDF Document file</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a PDF Document for your activity
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <input accept={SUPPORTED_FILES} type="file" onChange={handleDocumentPdfChange} required />
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

export default DocumentPdfModal
