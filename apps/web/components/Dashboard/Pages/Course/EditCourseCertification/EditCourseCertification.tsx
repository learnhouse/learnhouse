import {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form';
import { useFormik } from 'formik';
import { AlertTriangle, Award, FileText, Settings } from 'lucide-react';
import CertificatePreview from './CertificatePreview';
import * as Form from '@radix-ui/react-form';
import React, { useEffect, useState } from 'react';
import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { 
  createCertification, 
  updateCertification, 
  deleteCertification 
} from '@services/courses/certifications';
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from "../EditCourseGeneral/CustomSelect";
import useSWR, { mutate } from 'swr';
import { getAPIUrl } from '@services/config/config';
import toast from 'react-hot-toast';

type EditCourseCertificationProps = {
  orgslug: string
  course_uuid?: string
}

const validate = (values: any) => {
  const errors = {} as any;

  if (values.enable_certification && !values.certification_name) {
    errors.certification_name = 'Required when certification is enabled';
  } else if (values.certification_name && values.certification_name.length > 100) {
    errors.certification_name = 'Must be 100 characters or less';
  }

  if (values.enable_certification && !values.certification_description) {
    errors.certification_description = 'Required when certification is enabled';
  } else if (values.certification_description && values.certification_description.length > 500) {
    errors.certification_description = 'Must be 500 characters or less';
  }

  return errors;
};

function EditCourseCertification(props: EditCourseCertificationProps) {
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const course = useCourse();
  const dispatchCourse = useCourseDispatch() as any;
  const { isLoading, courseStructure } = course as any;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  // Fetch existing certifications
  const { data: certifications, error: certificationsError, mutate: mutateCertifications } = useSWR(
    courseStructure?.course_uuid && access_token ? 
    `certifications/course/${courseStructure.course_uuid}` : null,
    async () => {
      if (!courseStructure?.course_uuid || !access_token) return null;
      const result = await fetch(
        `${getAPIUrl()}certifications/course/${courseStructure.course_uuid}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access_token}`,
          },
          credentials: 'include',
        }
      );
      const response = await result.json();
      

      
      if (result.status === 200) {
        return {
          success: true,
          data: response,
          status: result.status,
          HTTPmessage: result.statusText,
        };
      } else {
        return {
          success: false,
          data: response,
          status: result.status,
          HTTPmessage: result.statusText,
        };
      }
    }
  );

  const existingCertification = certifications?.data?.[0]; // Assuming one certification per course
  const hasExistingCertification = !!existingCertification;



  // Create initial values object
  const getInitialValues = () => {
    // Helper function to get instructor name from authors
    const getInstructorName = () => {
      if (courseStructure?.authors && courseStructure.authors.length > 0) {
        const author = courseStructure.authors[0];
        const firstName = author.first_name || '';
        const lastName = author.last_name || '';
        
        // Only return if at least one name exists
        if (firstName || lastName) {
          return `${firstName} ${lastName}`.trim();
        }
      }
      return '';
    };

    // Use existing certification data if available, otherwise fall back to course data
    const config = existingCertification?.config || {};
    
    return {
      enable_certification: hasExistingCertification,
      certification_name: config.certification_name || courseStructure?.name || '',
      certification_description: config.certification_description || courseStructure?.description || '',
      certification_type: config.certification_type || 'completion',
      certificate_pattern: config.certificate_pattern || 'professional',
      certificate_instructor: config.certificate_instructor || getInstructorName(),
    };
  };

  const formik = useFormik({
    initialValues: getInitialValues(),
    validate,
    onSubmit: async values => {
      // This is no longer used - saving is handled by the main Save button
    },
    enableReinitialize: true,
  }) as any;

  // Handle enabling/disabling certification
  const handleCertificationToggle = async (enabled: boolean) => {
    if (enabled && !hasExistingCertification) {
      // Create new certification
      setIsCreating(true);
      try {
        const config = {
          certification_name: formik.values.certification_name || courseStructure?.name || '',
          certification_description: formik.values.certification_description || courseStructure?.description || '',
          certification_type: formik.values.certification_type || 'completion',
          certificate_pattern: formik.values.certificate_pattern || 'professional',
          certificate_instructor: formik.values.certificate_instructor || '',
        };

        const result = await createCertification(
          courseStructure.id,
          config,
          access_token
        );



        // createCertification uses errorHandling which returns JSON directly on success
        if (result) {
          toast.success('Certification created successfully');
          mutateCertifications();
          formik.setFieldValue('enable_certification', true);
        } else {
          throw new Error('Failed to create certification');
        }
      } catch (e) {
        setError('Failed to create certification.');
        toast.error('Failed to create certification');
        formik.setFieldValue('enable_certification', false);
      } finally {
        setIsCreating(false);
      }
    } else if (!enabled && hasExistingCertification) {
      // Delete existing certification
      try {
        const result = await deleteCertification(
          existingCertification.certification_uuid,
          access_token
        );

        // deleteCertification uses errorHandling which returns JSON directly on success
        if (result) {
          toast.success('Certification removed successfully');
          mutateCertifications();
          formik.setFieldValue('enable_certification', false);
        } else {
          throw new Error('Failed to delete certification');
        }
      } catch (e) {
        setError('Failed to remove certification.');
        toast.error('Failed to remove certification');
        formik.setFieldValue('enable_certification', true);
      }
    } else {
      formik.setFieldValue('enable_certification', enabled);
    }
  };

  // Reset form when certifications data changes
  useEffect(() => {
    if (certifications && !isLoading) {
      const newValues = getInitialValues();
      formik.resetForm({ values: newValues });
    }
  }, [certifications, isLoading]);

  // Handle form changes - update course context with certification data
  useEffect(() => {
    if (!isLoading && hasExistingCertification) {
      const formikValues = formik.values as any;
      const initialValues = formik.initialValues as any;
      const valuesChanged = Object.keys(formikValues).some(
        key => formikValues[key] !== initialValues[key]
      );

      if (valuesChanged) {
        dispatchCourse({ type: 'setIsNotSaved' });
        
        // Store certification data in course context so it gets saved with the main save button
        const updatedCourse = {
          ...courseStructure,
          // Store certification data for the main save functionality
          _certificationData: {
            certification_uuid: existingCertification.certification_uuid,
            config: {
              certification_name: formikValues.certification_name,
              certification_description: formikValues.certification_description,
              certification_type: formikValues.certification_type,
              certificate_pattern: formikValues.certificate_pattern,
              certificate_instructor: formikValues.certificate_instructor,
            }
          }
        };
        dispatchCourse({ type: 'setCourseStructure', payload: updatedCourse });
      }
    }
  }, [formik.values, isLoading, hasExistingCertification, existingCertification]);

  if (isLoading || !courseStructure || (courseStructure.course_uuid && access_token && certifications === undefined)) {
    return <div>Loading...</div>;
  }

  if (certificationsError) {
    return <div>Error loading certifications</div>;
  }

  return (
    <div>
      {courseStructure && (
        <div>
          <div className="h-6"></div>
          <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
            {/* Header Section */}
            <div className="flex items-center justify-between bg-gray-50 px-3 sm:px-5 py-3 rounded-md mb-3">
              <div className="flex flex-col -space-y-1">
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">Course Certification</h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                  Enable and configure certificates for students who complete this course
                </h2>
              </div>
              <div className="flex items-center space-x-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formik.values.enable_certification}
                    onChange={(e) => handleCertificationToggle(e.target.checked)}
                    disabled={isCreating}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
                {isCreating && (
                  <div className="animate-spin">
                    <Settings size={16} />
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 mb-6 transition-all shadow-xs">
                <AlertTriangle size={18} />
                <div className="font-bold text-sm">{error}</div>
              </div>
            )}

            {/* Certification Configuration - Only show if enabled and has existing certification */}
            {formik.values.enable_certification && hasExistingCertification && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Form Section */}
                <div className="lg:col-span-3">
                  <Form.Root className="space-y-6">
                    {/* Basic Information Section */}
                    <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                      <h3 className="font-bold text-md text-gray-800 flex items-center gap-2">
                        <FileText size={16} />
                        Basic Information
                      </h3>
                      <p className="text-gray-500 text-xs sm:text-sm">
                        Configure the basic details of your certification
                      </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Certification Name */}
                      <FormField name="certification_name">
                        <FormLabelAndMessage 
                          label="Certification Name" 
                          message={formik.errors.certification_name} 
                        />
                        <Form.Control asChild>
                          <Input
                            style={{ backgroundColor: 'white' }}
                            onChange={formik.handleChange}
                            value={formik.values.certification_name}
                            type="text"
                            placeholder="e.g., Advanced JavaScript Certification"
                            required
                          />
                        </Form.Control>
                      </FormField>

                      {/* Certification Type */}
                      <FormField name="certification_type">
                        <FormLabelAndMessage label="Certification Type" />
                        <Form.Control asChild>
                          <CustomSelect
                            value={formik.values.certification_type}
                            onValueChange={(value) => {
                              if (!value) return;
                              formik.setFieldValue('certification_type', value);
                            }}
                          >
                            <CustomSelectTrigger className="w-full bg-white">
                              <CustomSelectValue>
                                {formik.values.certification_type === 'completion' ? 'Course Completion' :
                                 formik.values.certification_type === 'achievement' ? 'Achievement Based' :
                                 formik.values.certification_type === 'assessment' ? 'Assessment Based' :
                                 formik.values.certification_type === 'participation' ? 'Participation' :
                                 formik.values.certification_type === 'mastery' ? 'Skill Mastery' :
                                 formik.values.certification_type === 'professional' ? 'Professional Development' :
                                 formik.values.certification_type === 'continuing' ? 'Continuing Education' :
                                 formik.values.certification_type === 'workshop' ? 'Workshop Attendance' :
                                 formik.values.certification_type === 'specialization' ? 'Specialization' : 'Course Completion'}
                              </CustomSelectValue>
                            </CustomSelectTrigger>
                            <CustomSelectContent>
                              <CustomSelectItem value="completion">Course Completion</CustomSelectItem>
                              <CustomSelectItem value="achievement">Achievement Based</CustomSelectItem>
                              <CustomSelectItem value="assessment">Assessment Based</CustomSelectItem>
                              <CustomSelectItem value="participation">Participation</CustomSelectItem>
                              <CustomSelectItem value="mastery">Skill Mastery</CustomSelectItem>
                              <CustomSelectItem value="professional">Professional Development</CustomSelectItem>
                              <CustomSelectItem value="continuing">Continuing Education</CustomSelectItem>
                              <CustomSelectItem value="workshop">Workshop Attendance</CustomSelectItem>
                              <CustomSelectItem value="specialization">Specialization</CustomSelectItem>
                            </CustomSelectContent>
                          </CustomSelect>
                        </Form.Control>
                      </FormField>
                    </div>

                    {/* Certification Description */}
                    <FormField name="certification_description">
                      <FormLabelAndMessage 
                        label="Certification Description" 
                        message={formik.errors.certification_description} 
                      />
                      <Form.Control asChild>
                        <Textarea
                          style={{ backgroundColor: 'white', height: '120px', minHeight: '120px' }}
                          onChange={formik.handleChange}
                          value={formik.values.certification_description}
                          placeholder="Describe what this certification represents and its value..."
                          required
                        />
                      </Form.Control>
                    </FormField>

                    {/* Certificate Design Section */}
                    <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                      <h3 className="font-bold text-md text-gray-800 flex items-center gap-2">
                        <Award size={16} />
                        Certificate Design
                      </h3>
                      <p className="text-gray-500 text-xs sm:text-sm">
                        Choose a decorative pattern for your certificate
                      </p>
                    </div>

                    {/* Pattern Selection */}
                    <FormField name="certificate_pattern">
                      <FormLabelAndMessage label="Certificate Pattern" />
                      <Form.Control asChild>
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                          {[
                            { value: 'royal', name: 'Royal', description: 'Ornate with crown motifs' },
                            { value: 'tech', name: 'Tech', description: 'Circuit-inspired patterns' },
                            { value: 'nature', name: 'Nature', description: 'Organic leaf patterns' },
                            { value: 'geometric', name: 'Geometric', description: 'Abstract shapes & lines' },
                            { value: 'vintage', name: 'Vintage', description: 'Art deco styling' },
                            { value: 'waves', name: 'Waves', description: 'Flowing water patterns' },
                            { value: 'minimal', name: 'Minimal', description: 'Clean and simple' },
                            { value: 'professional', name: 'Professional', description: 'Business-ready design' },
                            { value: 'academic', name: 'Academic', description: 'Traditional university style' },
                            { value: 'modern', name: 'Modern', description: 'Contemporary clean lines' }
                          ].map((pattern) => (
                            <div
                              key={pattern.value}
                              className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                                formik.values.certificate_pattern === pattern.value
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                              onClick={() => formik.setFieldValue('certificate_pattern', pattern.value)}
                            >
                              <div className="text-center">
                                <div className="text-sm font-medium text-gray-900">{pattern.name}</div>
                                <div className="text-xs text-gray-500 mt-1">{pattern.description}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Form.Control>
                    </FormField>

                    {/* Custom Instructor */}
                    <FormField name="certificate_instructor">
                      <FormLabelAndMessage label="Instructor Name (Optional)" />
                      <Form.Control asChild>
                        <Input
                          style={{ backgroundColor: 'white' }}
                          onChange={formik.handleChange}
                          value={formik.values.certificate_instructor}
                          type="text"
                          placeholder="e.g., Dr. Jane Smith"
                        />
                      </Form.Control>
                    </FormField>
                  </Form.Root>
                </div>

                {/* Preview Section */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-xl shadow-xs border border-gray-200 sticky top-6 min-h-[320px]">
                    <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-t-xl mb-3">
                      <h3 className="font-bold text-md text-gray-800 flex items-center gap-2">
                        <Award size={16} />
                        Certificate Preview
                      </h3>
                      <p className="text-gray-500 text-xs sm:text-sm">
                        Live preview of your certificate
                      </p>
                    </div>
                    
                    <div className="p-4">
                      <CertificatePreview
                        certificationName={formik.values.certification_name}
                        certificationDescription={formik.values.certification_description}
                        certificationType={formik.values.certification_type}
                        certificatePattern={formik.values.certificate_pattern}
                        certificateInstructor={formik.values.certificate_instructor}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Disabled State */}
            {!formik.values.enable_certification && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <Award className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="font-medium text-gray-700 mb-2">No Certification Configured</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Enable certification to provide students with certificates upon course completion.
                </p>
                <button
                  type="button"
                  onClick={() => handleCertificationToggle(true)}
                  disabled={isCreating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Award size={16} />
                  {isCreating ? 'Creating...' : 'Enable Certification'}
                </button>
              </div>
            )}

            {/* Creating State - when toggle is on but no certification exists yet */}
            {formik.values.enable_certification && !hasExistingCertification && isCreating && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
                <div className="animate-spin mx-auto mb-4">
                  <Settings className="w-16 h-16 text-blue-500" />
                </div>
                <h3 className="font-medium text-blue-700 mb-2">Creating Certification...</h3>
                <p className="text-sm text-blue-600">
                  Please wait while we set up your course certification.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default EditCourseCertification; 