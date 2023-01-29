"use client";
import { useRouter } from "next/navigation";
import React from "react";
import { Title } from "@components/UI/Elements/Styles/Title";
import { createCollection } from "@services/collections";
import useSWR from "swr";
import { getAPIUrl } from "@services/config";
import { swrFetcher } from "@services/utils/requests";
import { getOrganizationContextInfo } from "@services/orgs";

function NewCollection(params : any) {
  const orgslug = params.params.orgslug;
  const [name, setName] = React.useState("");
  const [org, setOrg] = React.useState({}) as any;
  const [description, setDescription] = React.useState("");
  const [selectedCourses, setSelectedCourses] = React.useState([]) as any;
  const router = useRouter();

  const { data: courses, error: error } = useSWR(`${getAPIUrl()}courses/org_slug/${orgslug}/page/1/limit/10`, swrFetcher);

  React.useEffect(() => {
    async function getOrg() {
      const org = await getOrganizationContextInfo(orgslug);
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
    console.log("selectedCourses", selectedCourses);
    const collection = {
      name: name,
      description: description,
      courses: selectedCourses,
      org_id: org.org_id,
    };
    await createCollection(collection);
    router.push("/org/" + orgslug + "/collections");
  };


  return (
    <>
      <Title>Add new</Title>
      <br />
      <input type="text" placeholder="Name" value={name} onChange={handleNameChange} />
      {!courses ? (
        <p>Loading...</p>
      ) : (
        <div>
          {courses.map((course: any) => (
            <div key={course.course_id}>
              <input
                type="checkbox"
                id={course.course_id}
                name={course.course_id}
                value={course.course_id}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedCourses([...selectedCourses, e.target.value]);
                  } else {
                    setSelectedCourses(selectedCourses.filter((item: any) => item !== e.target.value));
                  }
                }}
              />
              <label htmlFor={course.course_id}>{course.name}</label>
            </div>
          ))}
        </div>
      )}

      <br />
      <input type="text" placeholder="Description" value={description} onChange={handleDescriptionChange} />
      <br />
      <button onClick={handleSubmit}>Submit</button>
    </>
  );
}

export default NewCollection;
