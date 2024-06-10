'use client'
import FormLayout, {
    ButtonBlack,
    Flex,
    FormField,
    FormLabel,
    FormMessage,
    Input,
} from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'
import { BarLoader } from 'react-spinners'
import { createUserGroup } from '@services/usergroups/usergroups'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'

type AddUserGroupProps = {
    setCreateUserGroupModal: any
}

function AddUserGroup(props: AddUserGroupProps) {
    const org = useOrg() as any;
    const session = useLHSession() as any
    const access_token = session?.data?.tokens?.access_token;
    const [userGroupName, setUserGroupName] = React.useState('')
    const [userGroupDescription, setUserGroupDescription] = React.useState('')
    const [isSubmitting, setIsSubmitting] = React.useState(false)

    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setUserGroupName(event.target.value)
    }

    const handleDescriptionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setUserGroupDescription(event.target.value)
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setIsSubmitting(true)

        const obj = {
            name: userGroupName,
            description: userGroupDescription,
            org_id: org.id
        }
        const res = await createUserGroup(obj, access_token)
        if (res.status == 200) {
            setIsSubmitting(false)
            mutate(`${getAPIUrl()}usergroups/org/${org.id}`)
            props.setCreateUserGroupModal(false)

        } else {
            setIsSubmitting(false)
        }
    }

    return (
        <FormLayout onSubmit={handleSubmit}>
            <FormField name="name">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Name</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a ug name
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleNameChange} type="text" required />
                </Form.Control>
            </FormField>
            <FormField name="description">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Description</FormLabel>
                    <FormMessage match="valueMissing">
                        Please provide a ug description
                    </FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleDescriptionChange} type="text" required />
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
                            'Create UserGroup'
                        )}
                    </ButtonBlack>
                </Form.Submit>
            </Flex>
        </FormLayout>
    )
}

export default AddUserGroup