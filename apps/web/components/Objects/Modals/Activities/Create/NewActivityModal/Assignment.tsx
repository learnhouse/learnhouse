import React from 'react'
import FormLayout, {
    ButtonBlack,
    Flex,
    FormField,
    FormLabel,
    FormMessage,
    Input,

} from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { BarLoader } from 'react-spinners'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { mutate } from 'swr'
import { createAssignment } from '@services/courses/assignments'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { createActivity } from '@services/courses/activities'

function NewAssignment({ submitActivity, chapterId, course, closeModal }: any) {
    const org = useOrg() as any;
    const session = useLHSession() as any
    const [activityName, setActivityName] = React.useState('')
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [activityDescription, setActivityDescription] = React.useState('')
    const [dueDate, setDueDate] = React.useState('')
    const [gradingType, setGradingType] = React.useState('ALPHABET')

    const handleNameChange = (e: any) => {
        setActivityName(e.target.value)
    }

    const handleDescriptionChange = (e: any) => {
        setActivityDescription(e.target.value)
    }

    const handleDueDateChange = (e: any) => {
        setDueDate(e.target.value)
    }

    const handleGradingTypeChange = (e: any) => {
        setGradingType(e.target.value)
    }

    const handleSubmit = async (e: any) => {
        e.preventDefault()
        setIsSubmitting(true)
        const activity = {
            name: activityName,
            chapter_id: chapterId,
            activity_type: 'TYPE_ASSIGNMENT',
            activity_sub_type: 'SUBTYPE_ASSIGNMENT_ANY',
            published: false,
            course_id: course?.courseStructure.id,
        }

        const activity_res = await createActivity(activity, chapterId, org?.id, session.data?.tokens?.access_token)
        console.log(course)
        console.log(activity_res)
        await createAssignment({
            title: activityName,
            description: activityDescription,
            due_date: dueDate,
            grading_type: gradingType,
            course_id: course?.courseStructure.id,
            org_id: org?.id,
            chapter_id: chapterId,
            activity_id: activity_res?.id,
        }, session.data?.tokens?.access_token)

        mutate(`${getAPIUrl()}courses/${course.courseStructure.course_uuid}/meta`)
        setIsSubmitting(false)
        closeModal()
    }


    return (
        <FormLayout onSubmit={handleSubmit}>
            <FormField name="assignment-activity-title">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Assignment Title</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a name for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleNameChange} type="text" required />
                </Form.Control>
            </FormField>

            {/* Description  */}
            <FormField name="assignment-activity-description">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Assignment Description</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a description for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleDescriptionChange} type="text" required />
                </Form.Control>
            </FormField>

            {/* Due date  */}
            <FormField name="assignment-activity-due-date">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Due Date</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a due date for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleDueDateChange} type="date" required />
                </Form.Control>
            </FormField>

            {/* Grading type  */}
            <FormField name="assignment-activity-grading-type">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Grading Type</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a grading type for your assignment
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <select className='bg-gray-100/40 rounded-lg px-1 py-2 outline outline-1 outline-gray-100' onChange={handleGradingTypeChange} required>
                        <option value="ALPHABET">Alphabet</option>
                        <option value="NUMERIC">Numeric</option>
                        <option value="PERCENTAGE">Percentage</option>
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
                            'Create activity'
                        )}
                    </ButtonBlack>
                </Form.Submit>
            </Flex>
        </FormLayout>
    )
}

export default NewAssignment