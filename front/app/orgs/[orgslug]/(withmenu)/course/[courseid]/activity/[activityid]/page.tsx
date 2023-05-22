import { getActivityWithAuthHeader } from "@services/courses/activities";
import { getCourseMetadataWithAuthHeader } from "@services/courses/courses";
import { cookies } from "next/headers";
import ActivityClient from "./activity";
import { getOrganizationContextInfo } from "@services/organizations/orgs";
import { Metadata } from "next";


type MetadataProps = {
    params: { orgslug: string, courseid: string, activityid: string };
    searchParams: { [key: string]: string | string[] | undefined };
};

export async function generateMetadata(
    { params }: MetadataProps,
): Promise<Metadata> {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');

    // Get Org context information 
    const org = await getOrganizationContextInfo(params.orgslug, { revalidate: 1800, tags: ['organizations'] });
    const course_meta = await getCourseMetadataWithAuthHeader(params.courseid, { revalidate: 0, tags: ['courses'] }, access_token_cookie ? access_token_cookie.value : null )
    const activity = await getActivityWithAuthHeader(params.activityid, { revalidate: 0, tags: ['activities'] }, access_token_cookie ? access_token_cookie.value : null)

    return {
        title: activity.name + ` — ${course_meta.course.name} Course`,
        description: course_meta.course.mini_description,
    };
}

const ActivityPage = async (params: any) => {
    const cookieStore = cookies();
    const access_token_cookie: any = cookieStore.get('access_token_cookie');
    const activityid = params.params.activityid;
    const courseid = params.params.courseid;
    const orgslug = params.params.orgslug;

    const course_meta = await getCourseMetadataWithAuthHeader(courseid, { revalidate: 0, tags: ['courses'] }, access_token_cookie ? access_token_cookie.value : null)
    const activity = await getActivityWithAuthHeader(activityid, { revalidate: 0, tags: ['activities'] }, access_token_cookie ? access_token_cookie.value : null)
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