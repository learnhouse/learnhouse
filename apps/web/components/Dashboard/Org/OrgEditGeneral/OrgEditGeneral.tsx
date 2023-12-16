"use client";
import React, { use, useEffect, useState } from 'react'
import { Field, Form, Formik } from 'formik';
import { updateOrganization, uploadOrganizationLogo } from '@services/settings/org';
import { UploadCloud } from 'lucide-react';
import { revalidateTags } from '@services/utils/ts/requests';
import { useRouter } from 'next/navigation';
import { useOrg } from '@components/Contexts/OrgContext';

interface OrganizationValues {
  name: string;
  description: string;
  slug: string;
  logo: string;
  email: string;
}

function OrgEditGeneral(props: any) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const router = useRouter();
  const org = useOrg() as any;
  // ...

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setSelectedFile(file);
    }
  };

  const uploadLogo = async () => {
    if (selectedFile) {
      let org_id = org.id;
      await uploadOrganizationLogo(org_id, selectedFile);
      setSelectedFile(null); // Reset the selected file
      await revalidateTags(['organizations'], org.slug);
      router.refresh();

    }
  };


  let orgValues: OrganizationValues = {
    name: org?.name,
    description: org?.description,
    slug: org?.slug,
    logo: org?.logo,
    email: org?.email
  }

  const updateOrg = async (values: OrganizationValues) => {
    let org_id = org.id;
    await updateOrganization(org_id, values);

    // Mutate the org
    await revalidateTags(['organizations'], org.slug);
    router.refresh();
  }

  useEffect(() => {

  }
    , [org])

  return (
    <div className='ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5'>
      <Formik
      enableReinitialize
        initialValues={orgValues}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
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
              Logo
            </label>

            <div className="flex items-center justify-center w-full ">
              <input
                className="w-full px-4 py-2 mr-1 border rounded-lg bg-gray-200 cursor-not-allowed"
                type="file"
                name="logo"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={uploadLogo}
                disabled={isSubmitting || selectedFile === null}
                className="px-6 py-3 text-white bg-gray-500 rounded-lg  hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-black"
              >
                <UploadCloud size={24} />
              </button>
            </div>


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

export default OrgEditGeneral