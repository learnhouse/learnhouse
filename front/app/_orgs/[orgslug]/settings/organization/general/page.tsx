"use client";
import React from 'react'
import useSWR, { mutate } from "swr";
import { swrFetcher } from "@services/utils/requests";
import { getAPIUrl } from '@services/config';
import { Field, Form, Formik } from 'formik';
import { updateOrganization } from '@services/settings/org';

interface OrganizationValues {
  name: string;
  description: string;
  slug: string;
  email: string;
}

function SettingsOrganizationGeneral(params: any) {
  const orgslug = params.params.orgslug;
  const { data: org, error: error } = useSWR(`${getAPIUrl()}orgs/slug/${orgslug}`, swrFetcher);

  if (org) {
    let orgValues: OrganizationValues = {
      name: org.name,
      description: org.description,
      slug: org.slug,
      email: org.email
    }


    const updateOrg = async (values: OrganizationValues) => {
      let org_id = org.org_id;
      await updateOrganization(org_id, values);

      // Sounds good, doesn't work
      // TODO: Fix this
      mutate(`${getAPIUrl()}orgs/slug/${values.slug}`);
    }

    return (
      <div>
        <h1>Oganization Settings</h1>
        <br /><br />
        {error && <p>Failed to load</p>}
        {!org ? (
          <div>Loading...</div>
        ) : (

          <Formik
            initialValues={orgValues}
            onSubmit={(values, { setSubmitting }) => {
              setTimeout(() => {
                alert(JSON.stringify(values, null, 2));
                setSubmitting(false);
                updateOrg(values)
              }, 400);
            }}
          >
            {({ isSubmitting }) => (
              <Form>
                Name  <Field type="text" name="name" /><br />
                Description  <Field type="text" name="description" /><br />
                Slug  <Field disabled type="text" name="slug" /> <br /> 
                Email  <Field type="email" name="email" /><br />
                <button type="submit" disabled={isSubmitting}>
                  Submit
                </button>
              </Form>
            )}
          </Formik>
        )}


      </div>
    )
  }
}

export default SettingsOrganizationGeneral