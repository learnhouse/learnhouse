"use client";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { createCollection } from "@services/courses/collections";
import useSWR from "swr";
import { getAPIUrl, getUriWithOrg } from "@services/config/config";
import { revalidateTags, swrFetcher } from "@services/utils/ts/requests";
import { useOrg } from "@components/Contexts/OrgContext";

function NewCollection(params: any) {
  const org = useOrg() as any;
  const orgslug = params.params.orgslug;
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selectedCourses, setSelectedCourses] = React.useState([]) as any;
  const router = useRouter();
  const { data: courses, error: error } = useSWR(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`, swrFetcher);
  const [isPublic, setIsPublic] = useState('true');

  const handleVisibilityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setIsPublic(e.target.value);
  };


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
      public: isPublic,
      org_id: org.id,
    };
    await createCollection(collection);
    await revalidateTags(["collections"], org.slug);
    // reload the page
    router.refresh();

    // wait for 2s before reloading the page
    setTimeout(() => {
      router.push(getUriWithOrg(orgslug, "/collections"));
    }
      , 1000);
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

        <select
          onChange={handleVisibilityChange}
          className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          defaultValue={isPublic}
        >
          <option value="false">Private Collection</option>
          <option value="true">Public Collection </option>
        </select>


        {!courses ? (
  <p className="text-gray-500">Loading...</p>
) : (
  <div className="space-y-4 p-3">
    <p>Courses</p>
    {courses.map((course: any) => (
      <div key={course.course_uuid} className="flex items-center space-x-2">

        <input
          type="checkbox"
          id={course.id}
          name={course.name}
          value={course.id}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedCourses([...selectedCourses, course.id]);
            }
            else {
              setSelectedCourses(selectedCourses.filter((course_uuid: any) => course_uuid !== course.course_uuid));
            }
          }}
          className="text-blue-500 rounded  focus:ring-2 focus:ring-blue-500"
        />

        <label htmlFor={course.course_uuid} className="text-sm text-gray-700">{course.name}</label>
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
