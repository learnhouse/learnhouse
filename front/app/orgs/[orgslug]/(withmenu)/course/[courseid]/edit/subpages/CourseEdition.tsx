"use client";
import FormLayout, { ButtonBlack, FormField, FormLabel, FormLabelAndMessage, FormMessage, Input, Textarea } from '@components/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form';
import { useFormik } from 'formik';
import { AlertTriangle } from "lucide-react";
import React from "react";

const validate = (values: any) => {
  const errors: any = {};

  if (!values.name) {
    errors.name = 'Required';
  }

  if (values.name.length > 100) {
    errors.name = 'Must be 80 characters or less';
  }

  if (!values.mini_description) {
    errors.mini_description = 'Required';
  }

  if (values.mini_description.length > 200) {
    errors.mini_description = 'Must be 200 characters or less';
  }

  if (!values.description) {
    errors.description = 'Required';

  }

  if (values.description.length > 1000) {
    errors.description = 'Must be 1000 characters or less';
  }


  if (!values.learnings) {
    errors.learnings = 'Required';
  }

  return errors;
};

function CourseEdition(props: any) {
  const [error, setError] = React.useState('');
  const formik = useFormik({
    initialValues: {
      name: String(props.data.name),
      mini_description: String(props.data.mini_description),
      description: String(props.data.description),
      learnings: String(props.data.learnings),
    },
    validate,
    onSubmit: async values => {
    },
  });


  React.useEffect(() => {
    // This code will run whenever form values are updated
    if (formik.values !== formik.initialValues) {
      props.dispatchSavedContent({ type: 'unsaved_content' });
      const updatedCourse = {
        ...props.data,
        name: formik.values.name,
        mini_description: formik.values.mini_description,
        description: formik.values.description,
        learnings: formik.values.learnings.split(", "),
      };
      props.dispatchCourseMetadata({ type: 'updated_course', payload: updatedCourse });
    }
  }, [formik.values, formik.initialValues]);


  return (
    <div className='max-w-screen-2xl mx-auto px-16 pt-5 tracking-tight'>
      <div className="login-form">
        {error && (
          <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-sm">
            <AlertTriangle size={18} />
            <div className="font-bold text-sm">{error}</div>
          </div>
        )}
        <FormLayout onSubmit={formik.handleSubmit}>
          <FormField name="name">
            <FormLabelAndMessage label='Name' message={formik.errors.name} />
            <Form.Control asChild>
              <Input style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.name} type="text" required />
            </Form.Control>
          </FormField>
          <FormField name="mini_description">
            <FormLabelAndMessage label='Mini description' message={formik.errors.mini_description} />
            <Form.Control asChild>
              <Input style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.mini_description} type="text" required />
            </Form.Control>
          </FormField>
          <FormField name="description">
            <FormLabelAndMessage label='Description' message={formik.errors.description} />
            <Form.Control asChild>
              <Textarea style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.description} required />
            </Form.Control>
          </FormField>
          <FormField name="learnings">
            <FormLabelAndMessage label='Learnings (Separated by , )' message={formik.errors.learnings} />
            <Form.Control asChild>
              <Textarea placeholder='Science, Design, Architecture' style={{ backgroundColor: "white" }} onChange={formik.handleChange} value={formik.values.learnings} required />
            </Form.Control>
          </FormField>
        </FormLayout>
      </div>

    </div>
  )
}

export default CourseEdition