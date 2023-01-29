"use client"; //todo: use server components
import Link from "next/link";
import React from "react";
import Layout from "../../components/UI/Layout";
import { Title } from "../../components/UI/Elements/Styles/Title";
import { deleteOrganizationFromBackend } from "@services/orgs";
import useSWR, { mutate } from "swr";
import { swrFetcher } from "@services/utils/requests";
import { getAPIUrl } from "@services/config";

const Organizations = () => {
  const { data : organizations , error } = useSWR(`${getAPIUrl()}orgs/user/page/1/limit/10`, swrFetcher)

  async function deleteOrganization(org_id: any) {
    const response = await deleteOrganizationFromBackend(org_id);
    response && mutate(`${getAPIUrl()}orgs/user/page/1/limit/10`, organizations.filter((org: any) => org.org_id !== org_id)); 
  }

  return (
    <>
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
              <Link href={`/org/${org.slug}`}>
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
