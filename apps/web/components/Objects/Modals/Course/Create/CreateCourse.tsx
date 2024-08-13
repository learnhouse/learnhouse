'use client'
import FormLayout, {
  ButtonBlack,
  Flex,
  FormField,
  FormLabel,
  Input,
  Textarea,
} from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { FormMessage } from '@radix-ui/react-form'
import { createNewCourse } from '@services/courses/courses'
import { getOrganizationContextInfoWithoutCredentials } from '@services/organizations/orgs'
import React, { useState } from 'react'
import { BarLoader } from 'react-spinners'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import toast from 'react-hot-toast'

function CreateCourseModal({ closeModal, orgslug }: any) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const session = useLHSession() as any;
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [learnings, setLearnings] = React.useState('')
  const [visibility, setVisibility] = React.useState(true)
  const [tags, setTags] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [thumbnail, setThumbnail] = React.useState(null) as any
  const router = useRouter()

  const [orgId, setOrgId] = React.useState(null) as any
  const [org, setOrg] = React.useState(null) as any

  const getOrgMetadata = async () => {
    const org = await getOrganizationContextInfoWithoutCredentials(orgslug, {
      revalidate: 360,
      tags: ['organizations'],
    })

    setOrgId(org.id)
  }

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value)
  }

  const handleDescriptionChange = (event: React.ChangeEvent<any>) => {
    setDescription(event.target.value)
  }

  const handleLearningsChange = (event: React.ChangeEvent<any>) => {
    setLearnings(event.target.value)
  }

  const handleVisibilityChange = (event: React.ChangeEvent<any>) => {
    setVisibility(event.target.value)
  }

  const handleTagsChange = (event: React.ChangeEvent<any>) => {
    setTags(event.target.value)
  }

  const handleThumbnailChange = (event: React.ChangeEvent<any>) => {
    setThumbnail(event.target.files[0])
  }

  const handleSubmit = async (e: any) => {
    e.preventDefault()
    setIsSubmitting(true)

    let res = await createNewCourse(
      orgId,
      { name, description, tags, visibility },
      thumbnail,
      session.data?.tokens?.access_token
    )
    const toast_loading = toast.loading('Creating course...')
    if (res.success) {
      await revalidateTags(['courses'], orgslug)
      setIsSubmitting(false)
      toast.dismiss(toast_loading)
      toast.success('Course created successfully')

      if (res.data.org_id == orgId) {
        closeModal()
        router.refresh()
        await revalidateTags(['courses'], orgslug)
      }

    }
    else {
      setIsSubmitting(false)
      toast.error(res.data.detail)
    }
  }

  React.useEffect(() => {
    if (orgslug) {
      getOrgMetadata()
    }
  }, [isLoading, orgslug])

  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="course-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Course name</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a course name
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="course-desc">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Course description</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a course description
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Textarea onChange={handleDescriptionChange} required />
        </Form.Control>
      </FormField>
      <FormField name="course-thumbnail">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Course thumbnail</FormLabel>
          <FormMessage match="valueMissing">
            Please provide a thumbnail for your course
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleThumbnailChange} type="file" />
        </Form.Control>
      </FormField>
      <FormField name="course-tags">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Course Learnings (separated by comma)</FormLabel>
          <FormMessage match="valueMissing">
            Please provide learning elements, separated by comma (,)
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <Textarea onChange={handleTagsChange} />
        </Form.Control>
      </FormField>
      <FormField name="course-visibility">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Course Visibility</FormLabel>
          <FormMessage match="valueMissing">
            Please choose course visibility
          </FormMessage>
        </Flex>
        <Form.Control asChild>
          <select
            onChange={handleVisibilityChange}
            className="border border-gray-300 rounded-md p-2"
            required
          >
            <option value="true">
              Public (Available to see on the internet){' '}
            </option>
            <option value="false">Private (Private to users) </option>
          </select>
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
              'Create Course'
            )}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  )
}

export default CreateCourseModal
