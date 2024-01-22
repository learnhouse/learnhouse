'use client';
import { useOrg } from '@components/Contexts/OrgContext';
import FormLayout, { ButtonBlack, Flex, FormField, FormLabel, Input, Textarea } from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { FormMessage } from "@radix-ui/react-form";
import { getAPIUrl } from '@services/config/config';
import { updateUserRole } from '@services/organizations/orgs';
import { swrFetcher } from '@services/utils/ts/requests';
import React, { useEffect } from 'react'
import { BarLoader } from 'react-spinners';
import { mutate } from 'swr';

interface Props {
    user: any
    setRolesModal: any
    alreadyAssignedRole: any
}

function RolesUpdate(props: Props) {
    const org = useOrg() as any;
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [assignedRole, setAssignedRole] = React.useState(props.alreadyAssignedRole);
    const [error, setError] = React.useState(null) as any;

    const handleAssignedRole = (event: React.ChangeEvent<any>) => {
        setError(null);
        setAssignedRole(event.target.value);
    }

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setIsSubmitting(true);
        const res = await updateUserRole(org.id, props.user.user.id, assignedRole);

        if (res.status === 200) {
            await mutate(`${getAPIUrl()}orgs/${org.id}/users`);
            props.setRolesModal(false);
        }
        else {
            setIsSubmitting(false);
            setError('Error ' + res.status + ': ' + res.data.detail);
        }


    };

    useEffect(() => {
    }
        , [assignedRole])

    return (
        <div>
            <FormLayout onSubmit={handleSubmit}>
                <FormField name="course-visibility">
                    {error ? <div className='text-red-500 font-bold text-xs px-3 py-2 bg-red-100 rounded-md'>{error}</div> : ''}
                    <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <FormLabel>Roles</FormLabel>
                        <FormMessage match="valueMissing">Please choose a role for the user</FormMessage>
                    </Flex>
                    <Form.Control asChild>
                        <select onChange={handleAssignedRole} defaultValue={assignedRole} className='border border-gray-300 rounded-md p-2' required>
                            <option value="role_global_admin">Admin </option>
                            <option value="role_global_maintainer">Maintainer</option>
                            <option value="role_global_user">User</option>
                        </select>
                    </Form.Control>
                </FormField>
                <div className='h-full'></div>
                <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
                    <Form.Submit asChild>
                        <ButtonBlack type="submit" css={{ marginTop: 10 }}>
                            {isSubmitting ? <BarLoader cssOverride={{ borderRadius: 60, }} width={60} color="#ffffff" />
                                : "Update user role"}
                        </ButtonBlack>
                    </Form.Submit>
                </Flex>
            </FormLayout>
        </div>
    )
}

export default RolesUpdate