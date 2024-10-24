'use client'
import FormLayout, {
    FormField,
    FormLabelAndMessage,
    Input,
} from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'
import { updateUserGroup } from '@services/usergroups/usergroups'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useFormik } from 'formik'
import toast from 'react-hot-toast'

type EditUserGroupProps = {
    usergroup: {
        id: number,
        name: string,
        description: string,
    }
}

const validate = (values: any) => {
    const errors: any = {}

    if (!values.name) {
        errors.name = 'Name is Required'
    }

    return errors
}

function EditUserGroup(props: EditUserGroupProps) {
    const org = useOrg() as any;
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    const formik = useFormik({
        initialValues: {
            name: props.usergroup.name,
            description: props.usergroup.description,
        },
        validate,
        onSubmit: async (values) => {
            setIsSubmitting(true)
            const res = await updateUserGroup(props.usergroup.id, access_token, values)

            if (res.status == 200) {
                setIsSubmitting(false)
                toast.success(`UserGroup saved successfully`)
                mutate(`${getAPIUrl()}usergroups/org/${org.id}`)
            } else {
                toast.error(`Error saving UserGroup, please retry later.`)
                setIsSubmitting(false)
            }
        },
    })

    console.log(formik.errors.name)

    return (
        <FormLayout onSubmit={formik.handleSubmit}>
            <FormField name="name">
                <FormLabelAndMessage
                    label="Name"
                    message={formik.errors.name}
                />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.name}
                        type="name"
                        required
                    />
                </Form.Control>
            </FormField>
            <FormField name="description">
                <FormLabelAndMessage
                    label="Description"
                    message={formik.errors.description}
                />
                <Form.Control asChild>
                    <Input
                        onChange={formik.handleChange}
                        value={formik.values.description}
                        type="description"
                    />
                </Form.Control>
            </FormField>
            <div className="flex py-4">
                <Form.Submit asChild>
                    <button className="w-full bg-black text-white font-bold text-center p-2 rounded-md shadow-md hover:cursor-pointer">
                        {isSubmitting ? 'Loading...' : 'Save UserGroup'}
                    </button>
                </Form.Submit>
            </div>
        </FormLayout>
    )
}

export default EditUserGroup