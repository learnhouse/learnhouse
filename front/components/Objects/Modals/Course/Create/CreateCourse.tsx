import FormLayout, { ButtonBlack, Flex, FormField, FormLabel, Input, Textarea } from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { getAPIUrl, getUriWithOrg } from '@services/config/config';
import { FormMessage } from "@radix-ui/react-form";
import { createNewCourse } from '@services/courses/courses';
import { getOrganizationContextInfo } from '@services/organizations/orgs';
import React, { useState } from 'react'
import { BarLoader } from 'react-spinners'
import { mutate } from 'swr';
import { revalidateTags } from '@services/utils/ts/requests';
import { useRouter } from 'next/navigation';

function CreateCourseModal({ closeModal, orgslug }: any) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [name, setName] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [isLoading, setIsLoading] = React.useState(false);
    const [thumbnail, setThumbnail] = React.useState(null) as any;
    const router = useRouter();

    const [orgId, setOrgId] = React.useState(null) as any;


    const getOrgMetadata = async () => {
        const org = await getOrganizationContextInfo(orgslug, { revalidate: 360, tags: ['organizations'] });
        setOrgId(org.org_id);
    }


    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setName(event.target.value);
    };

    const handleDescriptionChange = (event: React.ChangeEvent<any>) => {
        setDescription(event.target.value);
    };

    const handleThumbnailChange = (event: React.ChangeEvent<any>) => {
        setThumbnail(event.target.files[0]);
    };

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setIsSubmitting(true);
        let status = await createNewCourse(orgId, { name, description }, thumbnail);
        revalidateTags(['courses'], orgslug);
        setIsSubmitting(false);

        if (status.org_id == orgId) {
            closeModal();
            router.refresh();

            // refresh page (FIX for Next.js BUG)
            window.location.reload();
        } else {
            alert("Error creating course, please see console logs");
            console.log(status);
        }

    };

    React.useEffect(() => {
        if (orgslug) {
            getOrgMetadata();
        }
    }, [isLoading, orgslug]);

    return (
        <FormLayout onSubmit={handleSubmit}>
            <FormField name="course-name">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Course name</FormLabel>
                    <FormMessage match="valueMissing">Please provide a course name</FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleNameChange} type="text" required />
                </Form.Control>
            </FormField>
            <FormField name="course-desc">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Course description</FormLabel>
                    <FormMessage match="valueMissing">Please provide a course description</FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Textarea onChange={handleDescriptionChange} required />
                </Form.Control>
            </FormField>
            <FormField name="course-thumbnail">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Course thumbnail</FormLabel>
                    <FormMessage match="valueMissing">Please provide a thumbnail for your course</FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Input onChange={handleThumbnailChange} type="file" required />
                </Form.Control>
            </FormField>
            <FormField name="course-learnings">
                <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <FormLabel>Course Learnings</FormLabel>
                    <FormMessage match="valueMissing">Please provide learning elements, separated by comma (,)</FormMessage>
                </Flex>
                <Form.Control asChild>
                    <Textarea required />
                </Form.Control>
            </FormField>

            <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
                <Form.Submit asChild>
                    <ButtonBlack type="submit" css={{ marginTop: 10 }}>
                        {isSubmitting ? <BarLoader cssOverride={{ borderRadius: 60, }} width={60} color="#ffffff" />
                            : "Create Course"}
                    </ButtonBlack>
                </Form.Submit>
            </Flex>
        </FormLayout>
    )
}

export default CreateCourseModal