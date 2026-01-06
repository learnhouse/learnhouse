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
  deleteCertification 
} from '@services/courses/certifications';
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from "../EditCourseGeneral/CustomSelect";
import useSWR from 'swr';
import { getAPIUrl } from '@services/config/config';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

type EditCourseCertificationProps = {
  orgslug: string
  course_uuid?: string
}

const validate = (values: any, t: any) => {
  const errors = {} as any;

  if (values.enable_certification && !values.certification_name) {
    errors.certification_name = t('dashboard.courses.certification.form.certification_name_required');
  } else if (values.certification_name && values.certification_name.length > 100) {
    errors.certification_name = t('dashboard.courses.certification.form.certification_name_max_length');
  }

  if (values.enable_certification && !values.certification_description) {
    errors.certification_description = t('dashboard.courses.certification.form.certification_description_required');
  } else if (values.certification_description && values.certification_description.length > 500) {
    errors.certification_description = t('dashboard.courses.certification.form.certification_description_max_length');
  }

  return errors;
};

function EditCourseCertification(props: EditCourseCertificationProps) {
  const { t } = useTranslation()
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
    validate: (values) => validate(values, t),
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
          toast.success(t('dashboard.courses.certification.toasts.create_success'));
          mutateCertifications();
          formik.setFieldValue('enable_certification', true);
        } else {
          throw new Error('Failed to create certification');
        }
      } catch (e) {
        setError(t('dashboard.courses.certification.errors.create_failed'));
        toast.error(t('dashboard.courses.certification.toasts.create_error'));
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
          toast.success(t('dashboard.courses.certification.toasts.remove_success'));
          mutateCertifications();
          formik.setFieldValue('enable_certification', false);
        } else {
          throw new Error('Failed to delete certification');
        }
      } catch (e) {
        setError(t('dashboard.courses.certification.errors.remove_failed'));
        toast.error(t('dashboard.courses.certification.toasts.remove_error'));
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
    return <div>{t('dashboard.courses.settings.loading')}</div>;
  }

  if (certificationsError) {
    return <div>{t('dashboard.courses.certification.errors.loading')}</div>;
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
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('dashboard.courses.certification.title')}</h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                  {t('dashboard.courses.certification.subtitle')}
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
                        {t('dashboard.courses.certification.sections.basic_info.title')}
                      </h3>
                      <p className="text-gray-500 text-xs sm:text-sm">
                        {t('dashboard.courses.certification.sections.basic_info.subtitle')}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Certification Name */}
                      <FormField name="certification_name">
                        <FormLabelAndMessage 
                          label={t('dashboard.courses.certification.form.certification_name_label')} 
                          message={formik.errors.certification_name} 
                        />
                        <Form.Control asChild>
                          <Input
                            style={{ backgroundColor: 'white' }}
                            onChange={formik.handleChange}
                            value={formik.values.certification_name}
                            type="text"
                            placeholder={t('dashboard.courses.certification.form.certification_name_placeholder')}
                            required
                          />
                        </Form.Control>
                      </FormField>

                      {/* Certification Type */}
                      <FormField name="certification_type">
                        <FormLabelAndMessage label={t('dashboard.courses.certification.form.certification_type_label')} />
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
                                {t(`dashboard.courses.certification.types.${formik.values.certification_type || 'completion'}`)}
                              </CustomSelectValue>
                            </CustomSelectTrigger>
                            <CustomSelectContent>
                              <CustomSelectItem value="completion">{t('dashboard.courses.certification.types.completion')}</CustomSelectItem>
                              <CustomSelectItem value="achievement">{t('dashboard.courses.certification.types.achievement')}</CustomSelectItem>
                              <CustomSelectItem value="assessment">{t('dashboard.courses.certification.types.assessment')}</CustomSelectItem>
                              <CustomSelectItem value="participation">{t('dashboard.courses.certification.types.participation')}</CustomSelectItem>
                              <CustomSelectItem value="mastery">{t('dashboard.courses.certification.types.mastery')}</CustomSelectItem>
                              <CustomSelectItem value="professional">{t('dashboard.courses.certification.types.professional')}</CustomSelectItem>
                              <CustomSelectItem value="continuing">{t('dashboard.courses.certification.types.continuing')}</CustomSelectItem>
                              <CustomSelectItem value="workshop">{t('dashboard.courses.certification.types.workshop')}</CustomSelectItem>
                              <CustomSelectItem value="specialization">{t('dashboard.courses.certification.types.specialization')}</CustomSelectItem>
                            </CustomSelectContent>
                          </CustomSelect>
                        </Form.Control>
                      </FormField>
                    </div>

                    {/* Certification Description */}
                    <FormField name="certification_description">
                      <FormLabelAndMessage 
                        label={t('dashboard.courses.certification.form.certification_description_label')} 
                        message={formik.errors.certification_description} 
                      />
                      <Form.Control asChild>
                        <Textarea
                          style={{ backgroundColor: 'white', height: '120px', minHeight: '120px' }}
                          onChange={formik.handleChange}
                          value={formik.values.certification_description}
                          placeholder={t('dashboard.courses.certification.form.certification_description_placeholder')}
                          required
                        />
                      </Form.Control>
                    </FormField>

                    {/* Certificate Design Section */}
                    <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                      <h3 className="font-bold text-md text-gray-800 flex items-center gap-2">
                        <Award size={16} />
                        {t('dashboard.courses.certification.sections.certificate_design.title')}
                      </h3>
                      <p className="text-gray-500 text-xs sm:text-sm">
                        {t('dashboard.courses.certification.sections.certificate_design.subtitle')}
                      </p>
                    </div>

                    {/* Pattern Selection */}
                    <FormField name="certificate_pattern">
                      <FormLabelAndMessage label={t('dashboard.courses.certification.form.certificate_pattern_label')} />
                      <Form.Control asChild>
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                          {['royal', 'tech', 'nature', 'geometric', 'vintage', 'waves', 'minimal', 'professional', 'academic', 'modern'].map((patternValue) => (
                            <div
                              key={patternValue}
                              className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                                formik.values.certificate_pattern === patternValue
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                              onClick={() => formik.setFieldValue('certificate_pattern', patternValue)}
                            >
                              <div className="text-center">
                                <div className="text-sm font-medium text-gray-900">{t(`dashboard.courses.certification.patterns.${patternValue}.name`)}</div>
                                <div className="text-xs text-gray-500 mt-1">{t(`dashboard.courses.certification.patterns.${patternValue}.description`)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Form.Control>
                    </FormField>

                    {/* Custom Instructor */}
                    <FormField name="certificate_instructor">
                      <FormLabelAndMessage label={t('dashboard.courses.certification.form.certificate_instructor_label')} />
                      <Form.Control asChild>
                        <Input
                          style={{ backgroundColor: 'white' }}
                          onChange={formik.handleChange}
                          value={formik.values.certificate_instructor}
                          type="text"
                          placeholder={t('dashboard.courses.certification.form.certificate_instructor_placeholder')}
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
                        {t('dashboard.courses.certification.sections.preview.title')}
                      </h3>
                      <p className="text-gray-500 text-xs sm:text-sm">
                        {t('dashboard.courses.certification.sections.preview.subtitle')}
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
                <h3 className="font-medium text-gray-700 mb-2">{t('dashboard.courses.certification.states.disabled.title')}</h3>
                <p className="text-sm text-gray-500 mb-4">
                  {t('dashboard.courses.certification.states.disabled.message')}
                </p>
                <button
                  type="button"
                  onClick={() => handleCertificationToggle(true)}
                  disabled={isCreating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Award size={16} />
                  {isCreating ? t('dashboard.courses.certification.states.disabled.creating') : t('dashboard.courses.certification.states.disabled.button')}
                </button>
              </div>
            )}

            {/* Creating State - when toggle is on but no certification exists yet */}
            {formik.values.enable_certification && !hasExistingCertification && isCreating && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
                <div className="animate-spin mx-auto mb-4">
                  <Settings className="w-16 h-16 text-blue-500" />
                </div>
                <h3 className="font-medium text-blue-700 mb-2">{t('dashboard.courses.certification.states.creating.title')}</h3>
                <p className="text-sm text-blue-600">
                  {t('dashboard.courses.certification.states.creating.message')}
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