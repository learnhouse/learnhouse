import { getActivityWithAuthHeader } from "@services/courses/activities";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import ActivityClient from "./activity";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from "@services/auth/auth";


type MetadataProps = {
    params: { orgslug: string, courseuuid: string, activityid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)

    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
    const course_meta = await getCourseMetadataWithAuthHeader(params.courseuuid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
    const activity = await getActivityWithAuthHeader(params.activityid, { revalidate: 0, tags: ['activities'] }, access_token ? access_token : null)

    // SEO
    return {
        title: activity.name + ` — ${course_meta.name} Course`,
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
            title: activity.name + ` — ${course_meta.name} Course`,
            description: course_meta.description,
            publishedTime: course_meta.creation_date,
            tags: course_meta.learnings,
        },
    };
}

const ActivityPage = async (params: any) => {
    const cookieStore = cookies();
    const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
    const activityid = params.params.activityid;
    const courseuuid = params.params.courseuuid;
    const orgslug = params.params.orgslug;

    const course_meta = await getCourseMetadataWithAuthHeader(courseuuid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
    const activity = await getActivityWithAuthHeader(activityid, { revalidate: 0, tags: ['activities'] }, access_token ? access_token : null)
    return (
        <>
            <ActivityClient
                activityid={activityid}
                courseuuid={courseuuid}
                orgslug={orgslug}
                activity={activity}
                course={course_meta}
            /></>
    )
}

export default ActivityPage