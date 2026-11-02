import { useFormik } from 'formik';
import { AlertTriangle, Award, Loader2 } from 'lucide-react';
import CertificateDesigner from '@components/Objects/Certificates/CertificateDesigner';
import { Switch } from '@components/ui/switch';
import React, { useEffect, useState, useRef } from 'react';
import { useCourseFieldSync, useCourse } from '@components/Contexts/CourseContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { 
  createCertification, 
  deleteCertification 
} from '@services/courses/certifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getCourseCertifications } from '@services/courses/certifications';
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

function EditCourseCertification(_props: EditCourseCertificationProps) {
  const { t } = useTranslation()
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const _course = useCourse() as any;
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient();

  // Use the new field sync hook
  const {
    syncChanges,
    courseStructure,
    isLoading,
    isSaving,
  } = useCourseFieldSync('editCourseCertification');

  // Track previous values to detect changes
  const previousValuesRef = useRef<any>(null);
  const hasInitializedRef = useRef(false);

  // Fetch existing certifications
  const { data: certifications, error: certificationsError, isPending: isCertificationsPending } = useQuery({
    queryKey: queryKeys.certifications.byCourse(courseStructure?.course_uuid ?? ''),
    queryFn: () =>
      getCourseCertifications(
        courseStructure!.course_uuid,
        org.id,
        null,
        access_token
      ),
    enabled: !!(courseStructure?.course_uuid && access_token && org?.id),
    staleTime: 60_000,
  });

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
    onSubmit: async _values => {
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
          org.id,
          access_token
        );



        // createCertification uses errorHandling which returns JSON directly on success
        if (result) {
          toast.success(t('dashboard.courses.certification.toasts.create_success'));
          queryClient.invalidateQueries({ queryKey: queryKeys.certifications.byCourse(courseStructure.course_uuid) });
          formik.setFieldValue('enable_certification', true);
        } else {
          throw new Error('Failed to create certification');
        }
      } catch (_e) {
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
          org.id,
          access_token
        );

        // deleteCertification uses errorHandling which returns JSON directly on success
        if (result) {
          toast.success(t('dashboard.courses.certification.toasts.remove_success'));
          queryClient.invalidateQueries({ queryKey: queryKeys.certifications.byCourse(courseStructure.course_uuid) });
          formik.setFieldValue('enable_certification', false);
        } else {
          throw new Error('Failed to delete certification');
        }
      } catch (e) {
        // The backend refuses to delete a certification that has already awarded
        // certificates, because deleting it destroys them and breaks the
        // verification links their holders have shared. Show that reason instead
        // of a generic failure; it tells the teacher what to do next.
        const detail = (e as any)?.detail ?? (e as any)?.message;
        setError(
          typeof detail === 'string' && detail
            ? detail
            : t('dashboard.courses.certification.errors.remove_failed')
        );
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
    // Skip if loading, saving, or no existing certification
    if (isLoading || isSaving || !hasExistingCertification) return;

    // Skip initial mount
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      previousValuesRef.current = formik.values;
      return;
    }

    const formikValues = formik.values as any;
    const prevValues = previousValuesRef.current;

    // Check if values actually changed from previous
    if (!prevValues) {
      previousValuesRef.current = formikValues;
      return;
    }

    const hasChanges = Object.keys(formikValues).some(
      key => formikValues[key] !== prevValues[key]
    );

    if (hasChanges) {
      // Store certification data in course context so it gets saved with the main save button
      const certificationData = {
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

      // Sync changes immediately (certification changes are important)
      syncChanges(certificationData, true);
      previousValuesRef.current = { ...formikValues };
    }
  }, [formik.values, isLoading, isSaving, hasExistingCertification, existingCertification, syncChanges]);

  // useCourseFieldSync flushes pending edits on unmount, so no local cleanup.

  if (isLoading || !courseStructure || (courseStructure.course_uuid && access_token && org?.id && isCertificationsPending)) {
    return (
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center justify-between bg-gray-50 px-3 sm:px-5 py-3 rounded-md">
            <div className="flex flex-col space-y-2">
              <div className="h-5 bg-gray-200 rounded w-48" />
              <div className="h-3 bg-gray-100 rounded w-64" />
            </div>
            <div className="w-9 h-5 bg-gray-200 rounded-full" />
          </div>
          <div className="h-64 bg-gray-50 rounded-lg w-full" />
        </div>
      </div>
    );
  }

  if (certificationsError) {
    return <div>{t('dashboard.courses.certification.errors.loading')}</div>;
  }

  return (
    <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
      <div className="flex items-center justify-between gap-4 bg-gray-50 px-3 sm:px-5 py-3 rounded-md mb-4">
        <div className="flex flex-col -space-y-1">
          <h1 className="font-bold text-lg sm:text-xl text-gray-800">{t('dashboard.courses.certification.title')}</h1>
          <h2 className="text-gray-500 text-xs sm:text-sm">{t('dashboard.courses.certification.subtitle')}</h2>
        </div>
        <div className="flex items-center gap-3">
          {isCreating && <Loader2 size={16} className="animate-spin text-gray-400" />}
          <Switch
            checked={formik.values.enable_certification}
            onCheckedChange={handleCertificationToggle}
            disabled={isCreating}
            aria-label={t('dashboard.courses.certification.title')}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-800 ring-1 ring-red-600/15 rounded-lg px-4 py-3 mb-4 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {formik.values.enable_certification && hasExistingCertification && (
        <CertificateDesigner
          values={formik.values}
          errors={formik.errors}
          onChange={(field, value) => formik.setFieldValue(field, value)}
        />
      )}

      {!formik.values.enable_certification && (
        <div className="border border-dashed border-gray-200 rounded-lg px-6 py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
            <Award className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="font-semibold text-gray-800 mb-1">{t('dashboard.courses.certification.states.disabled.title')}</h3>
          <p className="text-sm text-gray-500 mb-5 max-w-md mx-auto">
            {t('dashboard.courses.certification.states.disabled.message')}
          </p>
          <button
            type="button"
            onClick={() => handleCertificationToggle(true)}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50"
          >
            {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Award size={16} />}
            {isCreating ? t('dashboard.courses.certification.states.disabled.creating') : t('dashboard.courses.certification.states.disabled.button')}
          </button>
        </div>
      )}
    </div>
  );
}

export default EditCourseCertification; 