import { getActivityWithAuthHeader } from "@services/courses/activities";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import ActivityClient from "./activity";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";
import { getAccessTokenFromRefreshTokenCookie, getNewAccessTokenUsingRefreshTokenServer } from "@services/auth/auth";


type MetadataProps = {
    params: { orgslug: string, courseid: string, activityid: string };
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
    const activity = await getActivityWithAuthHeader(params.activityid, { revalidate: 0, tags: ['activities'] }, access_token ? access_token : null)

    return {
        title: activity.name + ` — ${course_meta.course.name} Course`,
        description: course_meta.course.mini_description,
    };
}

const ActivityPage = async (params: any) => {
    const cookieStore = cookies();
    const access_token = await getAccessTokenFromRefreshTokenCookie(cookieStore)
    const activityid = params.params.activityid;
    const courseid = params.params.courseid;
    const orgslug = params.params.orgslug;

    const course_meta = await getCourseMetadataWithAuthHeader(courseid, { revalidate: 0, tags: ['courses'] }, access_token ? access_token : null)
    const activity = await getActivityWithAuthHeader(activityid, { revalidate: 0, tags: ['activities'] }, access_token ? access_token : null)
    return (
        <>
            <ActivityClient
                activityid={activityid}
                courseid={courseid}
                orgslug={orgslug}
                activity={activity}
                course={course_meta}
            /></>
    )
}

export default ActivityPage