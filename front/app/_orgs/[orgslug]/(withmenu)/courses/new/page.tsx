"use client";
import { useRouter } from "next/navigation";
import React from "react";
import { Header } from "@components/UI/Header";
import Layout from "@components/UI/Layout";
import { Title } from "@components/UI/Elements/Styles/Title";
import { createNewCourse } from "@services/courses/courses";
import { getOrganizationContextInfo } from "@services/orgs";

const NewCoursePage = (params: any) => {
  const router = useRouter();
  const orgslug = params.params.orgslug;
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [thumbnail, setThumbnail] = React.useState(null) as any;
  const [orgId, setOrgId] = React.useState(null) as any;


  const getOrgMetadata = async () => {
    const org = await getOrganizationContextInfo(orgslug);
    setOrgId(org.org_id);
  }

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };

  const handleDescriptionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDescription(event.target.value);
  };

  const handleThumbnailChange = (event: React.ChangeEvent<any>) => {
    setThumbnail(event.target.files[0]);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    let status = await createNewCourse(orgId, { name, description }, thumbnail);

    // TODO : wow this is terrible - fix this
    if (status.org_id == orgId) {
      router.push(`/org/${orgslug}/courses`);
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
    <>
      <Title>New Course </Title>
      <hr />
      Name : <input onChange={handleNameChange} type="text" /> <br />
      Description : <input onChange={handleDescriptionChange} type="text" /> <br />
      Cover Photo : <input onChange={handleThumbnailChange} type="file" /> <br />
      Learnings (empty for now) (separated by ; ) : <textarea id="story" name="story" rows={5} cols={33} /> <br />
      <button onClick={handleSubmit}>Create</button>
    </>
  );
};

export default NewCoursePage;
