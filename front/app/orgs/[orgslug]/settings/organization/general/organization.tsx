"use client";
import React from 'react'
import { Field, Form, Formik } from 'formik';
import { updateOrganization } from '@services/settings/org';


interface OrganizationValues {
    name: string;
    description: string;
    slug: string;
    email: string;
}


function OrganizationClient(props: any) {
    const org = props.org;
    let orgValues: OrganizationValues = {
        name: org.name,
        description: org.description,
        slug: org.slug,
        email: org.email
    }

    const updateOrg = async (values: OrganizationValues) => {
        let org_id = org.org_id;
        await updateOrganization(org_id, values);
    }

    return (
        <div>
            <h1 className='text-3xl font-bold'>Organization Settings</h1>
            <br /><br />


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
                        <label className="block mb-2 font-bold" htmlFor="name">
                            Name
                        </label>
                        <Field
                            className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            type="text"
                            name="name"
                        />

                        <label className="block mb-2 font-bold" htmlFor="description">
                            Description
                        </label>
                        <Field
                            className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            type="text"
                            name="description"
                        />

                        <label className="block mb-2 font-bold" htmlFor="slug">
                            Slug
                        </label>
                        <Field
                            className="w-full px-4 py-2 mb-4 border rounded-lg bg-gray-200 cursor-not-allowed"
                            disabled
                            type="text"
                            name="slug"
                        />

                        <label className="block mb-2 font-bold" htmlFor="email">
                            Email
                        </label>
                        <Field
                            className="w-full px-4 py-2 mb-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            type="email"
                            name="email"
                        />

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-6 py-3 text-white bg-black rounded-lg shadow-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-black"
                        >
                            Submit
                        </button>
                    </Form>

                )}
            </Formik>


        </div>
    )
}

export default OrganizationClient