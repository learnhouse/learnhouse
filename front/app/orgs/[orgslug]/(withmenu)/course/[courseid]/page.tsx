import React from 'react'
import CourseClient from './course'
import { cookies } from 'next/headers';
import { getCourseMetadataWithAuthHeader } from '@services/courses/courses';
import { getOrganizationContextInfo } from '@services/organizations/orgs';
import { Metadata } from 'next';

type MetadataProps = {
    params: { orgslug: string, courseid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');

    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
    const course_meta = await getCourseMetadataWithAuthHeader(params.courseid, { revalidate: 360, tags: ['courses'] }, access_token_cookie.value)

    return {
        title: course_meta.course.name + ` — ${org.name}`,
        description: course_meta.course.mini_description,
    };
}



const CoursePage = async (params: any) => {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');
    const courseid = params.params.courseid
    const orgslug = params.params.orgslug;
    const course_meta = await getCourseMetadataWithAuthHeader(courseid, { revalidate: 360, tags: ['courses'] }, access_token_cookie.value)
    return (
        <div>
            <CourseClient courseid={courseid} orgslug={orgslug} course={course_meta} />
        </div>
    )
}

export default CoursePage