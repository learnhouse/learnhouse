export const runtime = 'edge'; 
import { Menu } from "@components/UI/Elements/Menu";
import { getBackendUrl, getUriWithOrg } from "@services/config/config";
import { getOrgCourses } from "@services/courses/courses";
import CoursesLogo from "public/svg/courses.svg";
import CollectionsLogo from "public/svg/collections.svg";
import Link from "next/link";
import Image from "next/image";
import { log } from "console";
import AuthProvider from "@components/Security/AuthProvider";
import { getOrgCollections } from "@services/courses/collections";

const OrgHomePage = async (params: any) => {
  const orgslug = params.params.orgslug;
  const courses = await getOrgCourses(orgslug);
  const collections = await getOrgCollections();

  // function to remove "course_" from the course_id
  function removeCoursePrefix(course_id: string) {
    return course_id.replace("course_", "");
  }

  return (
    <div>

      <AuthProvider>
        <Menu orgslug={orgslug}></Menu>
      </AuthProvider>
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Collections */}
        <Title title="Collections" type="col" />
        <div className="home_collections flex flex-wrap">
          {collections.map((collection: any) => (
            <div className="pr-8 flex flex-col" key={collection.collection_id}>
              <Link href={getUriWithOrg(orgslug, "/collection/" + removeCoursePrefix(collection.collection_id))}>
                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[180px] bg-cover flex flex-col items-center justify-center bg-indigo-600 font-bold text-zinc-50" >
                  <h1 className="font-bold text-lg py-2 justify-center mb-2">{collection.name}</h1>
                  <div className="flex -space-x-4">
                    {collection.courses.slice(0,3).map((course: any) => (
                      <Link key={course.course_id} href={getUriWithOrg(orgslug, "/course/" + course.course_id.substring(7))}>
                        <img className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg ring-2 ring-white z-50" key={course.course_id} src={`${getBackendUrl()}content/uploads/img/${course.thumbnail}`} alt={course.name} />
                      </Link>
                    ))}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>

        {/* Courses */}
        <Title title="Courses" type="cou" />
        <div className="home_courses flex flex-wrap">
          {courses.map((course: any) => (
            <div className="pr-8" key={course.course_id}>
              <Link href={getUriWithOrg(orgslug, "/course/" + removeCoursePrefix(course.course_id))}>
                <div className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-[249px] h-[131px] bg-cover" style={{ backgroundImage: `url(${getBackendUrl()}content/uploads/img/${course.thumbnail})` }}>
                </div>
              </Link>
              <h2 className="font-bold text-lg w-[250px] py-2">{course.name}</h2>
            </div>
          ))}
        </div>
      </div>
    </div>

  );
};


const Title = (props: any) => {
  return (
    <div className="home_category_title flex my-5">
      <div className="rounded-full ring-1 ring-slate-900/5 shadow-sm p-2 my-auto mr-4">
        <Image className="" src={props.type == "col" ? CollectionsLogo : CoursesLogo} alt="Courses logo" />
      </div>
      <h1 className="font-bold text-lg">{props.title}</h1>
    </div>
  )
}


export default OrgHomePage;
