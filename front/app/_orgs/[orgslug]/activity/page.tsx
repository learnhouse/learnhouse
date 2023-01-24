"use client";
import { getAPIUrl, getBackendUrl } from "@services/config";
import { getActivities } from "@services/courses/activity";
import { getOrganizationContextInfo } from "@services/orgs";
import { swrFetcher } from "@services/utils/requests";
import React from "react";
import { styled } from "styled-components";
import useSWR from "swr";

function Activity(params: any) {
  let orgslug = params.params.orgslug;
  const { data: activities, error: error } = useSWR(`${getAPIUrl()}activity/org_slug/${orgslug}/activities`, swrFetcher);

  return (
    <ActivityLayout>
      <h1>Activity</h1>
      <br />
      {error && <p>Failed to load</p>}
      {!activities ? (
        <div>Loading...</div>
      ) : (
        <div>
          {activities.map((activity: any) => (
            <ActivityBox key={activity.activity_id}>
              <ActivityMetadata>
                <ActivityThumbnail>
                  <img src={`${getBackendUrl()}content/uploads/img/${activity.course.thumbnail}`}></img>
                </ActivityThumbnail>
                <ActivityInfo>
                  <h2>Course</h2>
                  <h3>{activity.course.name}</h3>
                </ActivityInfo>
              </ActivityMetadata>
              <ActivityProgress progress={activity.progression} />
            </ActivityBox>
          ))}
        </div>
      )}
    </ActivityLayout>
  );
}

export default Activity;

const ActivityLayout = styled.div`
  display: flex;
  margin: 0 auto;
  width: 1300px;
  height: 100%;
  flex-direction: column;
`;

const ActivityMetadata = styled.div`
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
`;
const ActivityBox = styled.div`
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

const ActivityThumbnail = styled.div`
  padding-right: 30px;
  height: 100%;
  border-radius: 7px 0px 0px 7px;

  img {
    width: 60px;
    border-radius: 7px;
  }
`;

const ActivityInfo = styled.div`
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

const ActivityProgress = styled.div`
  margin-top: 10px;
  border-radius: 20px;
  height: 10px;
  width: ${(props: any) => props.progress + "%"};
  background: #06a487;
`;
