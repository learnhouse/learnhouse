import React from 'react'
import CourseClient from './course'
import { cookies } from 'next/headers';
import { getCourseMetadataWithAuthHeader } from '@services/courses/courses';
import { getOrganizationContextInfo } from '@services/organizations/orgs';
import { Metadata } from 'next';
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from '@services/auth/auth';

type MetadataProps = {
    params: { orgslug: string, courseid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)

    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
    const course_meta = await getCourseMetadataWithAuthHeader(params.courseid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
    

    // SEO
    return {
        title: course_meta.name + ` — ${org.name}`,
        description: course_meta.description,
        keywords: course_meta.learnings,
        robots: {
            index: true,
            follow: true,
            nocache: true,
            googleBot: {
                index: true,
                follow: true,
                "max-image-preview": "large",
            }
        },
        openGraph: {
            title: course_meta.name + ` — ${org.name}`,
            description: course_meta.description,
            type: 'article',
            publishedTime: course_meta.creation_date,
            tags: course_meta.learnings,
        },
    };
}


const CoursePage = async (params: any) => {
    const cookieStore = cookies();
    const courseid = params.params.courseid
    const orgslug = params.params.orgslug;
    const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
    const course_meta = await getCourseMetadataWithAuthHeader(courseid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)

    return (
        <div>
            <CourseClient courseid={courseid} orgslug={orgslug} course={course_meta} />
        </div>
    )
}

export default CoursePage