"use client";
import PageLoading from "@components/Objects/Loaders/PageLoading";
import TypeOfContentTitle from "@components/StyledElements/Titles/TypeOfContentTitle";
import GeneralWrapperStyled from "@components/StyledElements/Wrappers/GeneralWrapper";
import { getAPIUrl, getBackendUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/ts/requests";
import React from "react";
import { styled } from "styled-components";
import useSWR from "swr";

function Trail(params: any) {
  let orgslug = params.params.orgslug;
  const { data: trail, error: error } = useSWR(`${getAPIUrl()}trail/org_slug/${orgslug}/trail`, swrFetcher);
  
  
  return (
    <GeneralWrapperStyled>
      <TypeOfContentTitle title="Trail" type="tra" />
      {!trail ? (
        <PageLoading></PageLoading>
      ) : (
        <div>
          {trail.courses.map((course: any) => (
            <TrailBox key={trail.trail_id}>
              <TrailMetadata>
                <TrailThumbnail>
                  <img src={`${getBackendUrl()}content/uploads/img/${course.course_object.thumbnail}`}></img>
                </TrailThumbnail>
                <TrailInfo>
                  <h2>Course</h2>
                  <h3>{course.course_object.name}</h3>
                </TrailInfo>
              </TrailMetadata>
              <TrailProgress progress={course.progress} />
            </TrailBox>
          ))}
        </div>
      )}
    </GeneralWrapperStyled>
  );
}

export default Trail;



const TrailMetadata = styled.div`
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
`;
const TrailBox = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  margin-top: 20px;
  margin-bottom: 20px;
  padding: 15px;
  border-radius: 7px;
  box-shadow: 0px 13px 33px -13px rgba(0, 0, 0, 0.206);
  background: #ffffff;
`;

const TrailThumbnail = styled.div`
  padding-right: 30px;
  height: 100%;
  border-radius: 7px 0px 0px 7px;

  img {
    width: 60px;
    border-radius: 7px;
  }
`;

const TrailInfo = styled.div`
  width: 100%;
  height: 100%;
  background: #ffffff;
  border-radius: 0px 7px 7px 0px;

  h2 {
    font-size: 12px;
    color: #2b2b2b;
    padding: 0;
    margin: 0;
  }

  h3 {
    font-size: 23px;
    color: #2b2b2b;
    padding: 0;
    margin: 0;
  }
`;

const TrailProgress = styled.div`
  margin-top: 10px;
  border-radius: 20px;
  height: 10px;
  width: ${(props: any) => props.progress + "%"};
  background: #06a487;
`;
