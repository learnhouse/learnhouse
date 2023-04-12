"use client"; //todo: use server components
import Link from "next/link";
import React from "react";
import { Title } from "../../components/UI/Elements/Styles/Title";
import { deleteOrganizationFromBackend } from "@services/organizations/orgs";
import useSWR, { mutate } from "swr";
import { swrFetcher } from "@services/utils/ts/requests";
import { getAPIUrl, getUriWithOrg } from "@services/config/config";
import AuthProvider from "@components/Security/AuthProvider";

const Organizations = () => {
  const { data : organizations , error } = useSWR(`${getAPIUrl()}orgs/user/page/1/limit/10`, swrFetcher)

  async function deleteOrganization(org_id: any) {
    const response = await deleteOrganizationFromBackend(org_id);
    response && mutate(`${getAPIUrl()}orgs/user/page/1/limit/10`, organizations.filter((org: any) => org.org_id !== org_id)); 
  }

  return (
    <>
    <AuthProvider/>
      <Title>
        Your Organizations{" "}
        <Link href={"/organizations/new"}>
          <button>+</button>
        </Link>
      </Title>
      <hr />
      {error && <p>Failed to load</p>}
      {!organizations ? (
        <p>Loading...</p>
      ) : (
        <div>
          {organizations.map((org: any) => (
            <div key={org.org_id}>
              <Link href={getUriWithOrg(org.slug,"/")}>
                <h3>{org.name}</h3>
              </Link>
              <button onClick={() => deleteOrganization(org.org_id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default Organizations;
