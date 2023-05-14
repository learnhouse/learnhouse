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
  const { data: organizations, error } = useSWR(`${getAPIUrl()}orgs/user/page/1/limit/10`, swrFetcher)

  async function deleteOrganization(org_id: any) {
    const response = await deleteOrganizationFromBackend(org_id);
    response && mutate(`${getAPIUrl()}orgs/user/page/1/limit/10`, organizations.filter((org: any) => org.org_id !== org_id));
  }

  return (
    <>
      <AuthProvider />
      <Title>
        Your Organizations{" "}
        <Link href="/organizations/new">
          <button className="bg-blue-500 text-white px-2 py-1 rounded-md hover:bg-blue-600 focus:outline-none">
            +
          </button>
        </Link>
      </Title>
      <hr />

      {error && <p className="text-red-500">Failed to load</p>}
      {!organizations ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div>
          {organizations.map((org: any) => (
            <div key={org.org_id} className="flex items-center justify-between mb-4">
              <Link href={getUriWithOrg(org.slug, "/")}>
                <h3 className="text-blue-500 cursor-pointer hover:underline">{org.name}</h3>
              </Link>
              <button
                onClick={() => deleteOrganization(org.org_id)}
                className="px-3 py-1 text-white bg-red-500 rounded-md hover:bg-red-600 focus:outline-none"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

    </>
  );
};

export default Organizations;
