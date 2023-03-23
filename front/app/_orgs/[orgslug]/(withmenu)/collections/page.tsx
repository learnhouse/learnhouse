"use client";
import Link from "next/link";
import React from "react";
import styled from "styled-components";
import { Title } from "@components/UI/Elements/Styles/Title";
import { deleteCollection } from "@services/courses/collections";
import { getAPIUrl, getBackendUrl, getUriWithOrg } from "@services/config/config";
import { swrFetcher } from "@services/utils/requests";
import useSWR, { mutate } from "swr";

function Collections(params: any) {
  const orgslug = params.params.orgslug;
  const { data: collections, error: error } = useSWR(`${getAPIUrl()}collections/page/1/limit/10`, swrFetcher);

  async function deleteCollectionAndFetch(collectionId: number) {
    await deleteCollection(collectionId);
    mutate(`${getAPIUrl()}collections/page/1/limit/10`);
  }

  return (
    <>
      <Title>
        {orgslug} Collections :{" "}
        <Link href={getUriWithOrg(orgslug, "/collections/new")}>
          <button>+</button>
        </Link>{" "}
      </Title>
      {error && <p>Failed to load</p>}
      {!collections ? (
        <div>Loading...</div>
      ) : (
        <div>
          {collections.map((collection: any) => (
            <CollectionItem key={collection.collection_id}>
              <Link href={"/org/" + orgslug + "/collections/" + collection.collection_id}>{collection.name}</Link>
              <CourseMiniThumbnail>
                {collection.courses.map((course: any) => (
                  <Link key={course.course_id} href={"/org/" + orgslug + "/course/" + course.course_id.substring(7)}>
                    <img key={course.course_id} src={`${getBackendUrl()}content/uploads/img/${course.thumbnail}`} alt={course.name} />
                  </Link>
                ))}
              </CourseMiniThumbnail>
              <button onClick={() => deleteCollectionAndFetch(collection.collection_id)}>Delete</button>
            </CollectionItem>
          ))}
        </div>
      )}
    </>
  );
}

const CollectionItem = styled.div`
  display: flex;
  flex-direction: row;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 10px;
  border: 1px solid #e5e5e5;
  border-radius: 5px;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.03);
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  &:hover {
    box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.1);
  }
`;

const CourseMiniThumbnail = styled.div`
  display: flex;
  flex-direction: row;
  img {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    margin: 5px;
    transition: all 0.2s ease-in-out;
  }

  &:hover {
    opacity: 0.8;
  }
`;
export default Collections;
