import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form';
import { useFormik } from 'formik';
import { AlertTriangle } from 'lucide-react';
import * as Form from '@radix-ui/react-form';
import React, { useEffect, useState } from 'react';
import ThumbnailUpdate from './ThumbnailUpdate';
import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext';
import FormTagInput from '@components/Objects/StyledElements/Form/TagInput';
import LearningItemsList from './LearningItemsList';

type EditCourseStructureProps = {
  orgslug: string
  course_uuid?: string
}

const validate = (values: any) => {
  const errors = {} as any;

  if (!values.name) {
    errors.name = 'Required';
  } else if (values.name.length > 100) {
    errors.name = 'Must be 100 characters or less';
  }

  if (!values.description) {
    errors.description = 'Required';
  } else if (values.description.length > 1000) {
    errors.description = 'Must be 1000 characters or less';
  }

  if (!values.learnings) {
    errors.learnings = 'Required';
  } else {
    try {
      const learningItems = JSON.parse(values.learnings);
      if (!Array.isArray(learningItems)) {
        errors.learnings = 'Invalid format';
      } else if (learningItems.length === 0) {
        errors.learnings = 'At least one learning item is required';
      } else {
        // Check if any item has empty text
        const hasEmptyText = learningItems.some(item => !item.text || item.text.trim() === '');
        if (hasEmptyText) {
          errors.learnings = 'All learning items must have text';
        }
      }
    } catch (e) {
      errors.learnings = 'Invalid JSON format';
    }
  }

  return errors;
};

function EditCourseGeneral(props: EditCourseStructureProps) {
  const [error, setError] = useState('');
  const course = useCourse();
  const dispatchCourse = useCourseDispatch() as any;
  const { isLoading, courseStructure } = course as any;

  // Initialize learnings as a JSON array if it's not already
  const initializeLearnings = (learnings: any) => {
    if (!learnings) {
      return JSON.stringify([{ id: Date.now().toString(), text: '', emoji: '📝' }]);
    }
    
    try {
      // Check if it's already a valid JSON array
      const parsed = JSON.parse(learnings);
      if (Array.isArray(parsed)) {
        return learnings;
      }
      
      // If it's a string but not a JSON array, convert it to a learning item
      if (typeof learnings === 'string') {
        return JSON.stringify([{ 
          id: Date.now().toString(), 
          text: learnings, 
          emoji: '📝' 
        }]);
      }
      
      // Default empty array
      return JSON.stringify([{ id: Date.now().toString(), text: '', emoji: '📝' }]);
    } catch (e) {
      // If it's not valid JSON, convert the string to a learning item
      if (typeof learnings === 'string') {
        return JSON.stringify([{ 
          id: Date.now().toString(), 
          text: learnings, 
          emoji: '📝' 
        }]);
      }
      
      // Default empty array
      return JSON.stringify([{ id: Date.now().toString(), text: '', emoji: '📝' }]);
    }
  };

  const formik = useFormik({
    initialValues: {
      name: courseStructure?.name || '',
      description: courseStructure?.description || '',
      about: courseStructure?.about || '',
      learnings: initializeLearnings(courseStructure?.learnings || ''),
      tags: courseStructure?.tags || '',
      public: courseStructure?.public || false,
    },
    validate,
    onSubmit: async values => {
      try {
        // Add your submission logic here
        dispatchCourse({ type: 'setIsSaved' });
      } catch (e) {
        setError('Failed to save course structure.');
      }
    },
    enableReinitialize: true,
  }) as any;

  useEffect(() => {
    if (!isLoading) {
      const formikValues = formik.values as any;
      const initialValues = formik.initialValues as any;
      const valuesChanged = Object.keys(formikValues).some(
        key => formikValues[key] !== initialValues[key]
      );

      if (valuesChanged) {
        dispatchCourse({ type: 'setIsNotSaved' });
        const updatedCourse = {
          ...courseStructure,
          ...formikValues,
        };
        dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse });
      }
    }
  }, [formik.values, isLoading]);

  return (
    <div>
      <div className="h-6"></div>
      <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-6 py-5">
        {courseStructure && (
          <div className="editcourse-form">
            {error && (
              <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 transition-all shadow-sm">
                <AlertTriangle size={18} />
                <div className="font-bold text-sm">{error}</div>
              </div>
            )}
            <FormLayout onSubmit={formik.handleSubmit}>
              <FormField name="name">
                <FormLabelAndMessage label="Name" message={formik.errors.name} />
                <Form.Control asChild>
                  <Input
                    style={{ backgroundColor: 'white' }}
                    onChange={formik.handleChange}
                    value={formik.values.name}
                    type="text"
                    required
                  />
                </Form.Control>
              </FormField>

              <FormField name="description">
                <FormLabelAndMessage label="Description" message={formik.errors.description} />
                <Form.Control asChild>
                  <Input
                    style={{ backgroundColor: 'white' }}
                    onChange={formik.handleChange}
                    value={formik.values.description}
                    type="text"
                    required
                  />
                </Form.Control>
              </FormField>

              <FormField name="about">
                <FormLabelAndMessage label="About" message={formik.errors.about} />
                <Form.Control asChild>
                  <Textarea
                    style={{ backgroundColor: 'white' }}
                    onChange={formik.handleChange}
                    value={formik.values.about}
                    required
                  />
                </Form.Control>
              </FormField>

              <FormField name="learnings">
                <FormLabelAndMessage label="Learnings" message={formik.errors.learnings} />
                <Form.Control asChild>
                  <LearningItemsList
                    value={formik.values.learnings}
                    onChange={(value) => formik.setFieldValue('learnings', value)}
                    error={formik.errors.learnings}
                  />
                </Form.Control>
              </FormField>

              <FormField name="tags">
                <FormLabelAndMessage label="Tags" message={formik.errors.tags} />
                <Form.Control asChild>
									<FormTagInput
										placeholder="Enter to add..."
										onChange={(value) => formik.setFieldValue('tags', value)}
										value={formik.values.tags}
									/>
                </Form.Control>
              </FormField>

              <FormField name="thumbnail">
                <FormLabelAndMessage label="Thumbnail" />
                <Form.Control asChild>
                  <ThumbnailUpdate />
                </Form.Control>
              </FormField>
            </FormLayout>
          </div>
        )}
      </div>
    </div>
  );
}

export default EditCourseGeneral;
