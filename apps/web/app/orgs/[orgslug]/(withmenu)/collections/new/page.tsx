"use client";
import { useRouter } from "next/navigation";
import React from "react";
import { createCollection } from "@services/courses/collections";
import useSWR from "swr";
import { getAPIUrl, getUriWithOrg } from "@services/config/config";
import { revalidateTags, swrFetcher } from "@services/utils/ts/requests";
import { getOrganizationContextInfo } from "@services/organizations/orgs";

function NewCollection(params: any) {
  const orgslug = params.params.orgslug;
  const [name, setName] = React.useState("");
  const [org, setOrg] = React.useState({}) as any;
  const [description, setDescription] = React.useState("");
  const [selectedCourses, setSelectedCourses] = React.useState([]) as any;
  const router = useRouter();

  const { data: courses, error: error } = useSWR(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`, swrFetcher);

  React.useEffect(() => {
    async function getOrg() {
      const org = await getOrganizationContextInfo(orgslug, { revalidate: 1800 });
      setOrg(org);
    }
    getOrg();
  }, []);

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };

  const handleDescriptionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDescription(event.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    
    const collection = {
      name: name,
      description: description,
      courses: selectedCourses,
      public: true,
      org_id: org.id,
    };
    await createCollection(collection);
    await revalidateTags(["collections"], orgslug);
    router.refresh();
    router.prefetch(getUriWithOrg(orgslug, "/collections"));
    router.push(getUriWithOrg(orgslug, "/collections"));
  };


  return (
    <>
      <div className="w-64 m-auto py-20">
      <div className="font-bold text-lg mb-4">Add new</div>

<input
  type="text"
  placeholder="Name"
  value={name}
  onChange={handleNameChange}
  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
/>

{!courses ? (
  <p className="text-gray-500">Loading...</p>
) : (
  <div>
    {courses.map((course: any) => (
      <div key={course.course_uuid} className="flex items-center mb-2">

<input

  type="checkbox"
  id={course.id}
  name={course.name}
  value={course.id}
// id is an integer, not a string

  onChange={(e) => {
    if (e.target.checked) {
      setSelectedCourses([...selectedCourses, course.id]);
    }
    else {
      setSelectedCourses(selectedCourses.filter((course_uuid: any) => course_uuid !== course.course_uuid));
    }
  }
  }
  className="mr-2"
/>

        <label htmlFor={course.course_uuid} className="text-sm">{course.name}</label>
      </div>
    ))}

  </div>
)}

<input
  type="text"
  placeholder="Description"
  value={description}
  onChange={handleDescriptionChange}
  className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
/>

<button
  onClick={handleSubmit}
  className="px-6 py-3 text-white bg-black rounded-lg shadow-md hover:bg-black focus:outline-none focus:ring-2 focus:ring-blue-500"
>
  Submit
</button>
      </div>

    </>
  );
}

export default NewCollection;
