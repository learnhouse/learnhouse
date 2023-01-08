"use client"; //todo: use server components
import Link from "next/link";
import React from "react";
import Layout from "../../components/UI/Layout";
import { Title } from "../../components/UI/Elements/Styles/Title";
import { deleteOrganizationFromBackend, getUserOrganizations } from "../../services/orgs";

const Organizations = () => {
  const [userOrganizations, setUserOrganizations] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(false);

  async function fetchUserOrganizations() {
    const response = await getUserOrganizations();
    setUserOrganizations(response);
    console.log(response);
    setIsLoading(false);
  }

  async function deleteOrganization(org_id:any)  {
    const response = await deleteOrganizationFromBackend(org_id);
    const newOrganizations = userOrganizations.filter((org:any) => org.org_id !== org_id);
    setUserOrganizations(newOrganizations);
  }


  React.useEffect(() => {
    setIsLoading(true);
    fetchUserOrganizations();
    setIsLoading(false);
  }, []);


  return (
    <Layout>
      <Title>
        Your Organizations{" "}
        <Link href={"/organizations/new"}>

          <button>+</button>

        </Link>
      </Title>
      <hr />
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <div>
          {userOrganizations.map((org: any) => (
            <div key={org.org_id}>
              <Link href={`/org/${org.slug}`}>

                <h3>{org.name}</h3>

              </Link>
              <button onClick={() => deleteOrganization(org.org_id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      
    </Layout>
  );
};

export default Organizations;
