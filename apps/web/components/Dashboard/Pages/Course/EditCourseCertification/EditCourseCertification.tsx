import { Medal, Trophy } from '@phosphor-icons/react'
import CertificateDesigner, { type CertificateDesignValues } from '@components/Objects/Certificates/CertificateDesigner';
import { Switch } from '@components/ui/switch';
import React, { useMemo, useState } from 'react';
import { useCourse } from '@components/Contexts/CourseContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useOrg } from '@components/Contexts/OrgContext';
import {
  createCertification,
  deleteCertification,
  getCourseCertifications,
  updateCertification,
} from '@services/courses/certifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, EmptyState, SectionCard } from '@components/Dashboard/Shared/DashKit/DashKit';
import { EditorPage, EditorSkeleton, ErrorNotice } from '../courseEditorUi';
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate';
import CourseCompletionSettings from './CourseCompletionSettings';
import { useDraftDirty, useSectionDraft } from '../courseEditorSave';
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs';

const SECTIONS = ['completion', 'certificate'] as const;
type Section = (typeof SECTIONS)[number];

type EditCourseCertificationProps = {
  orgslug: string
  course_uuid?: string
}

const validate = (values: CertificateDesignValues, t: any) => {
  const errors = {} as Partial<Record<keyof CertificateDesignValues, string>>;

  if (!values.certification_name) {
    errors.certification_name = t('dashboard.courses.certification.form.certification_name_required');
  } else if (values.certification_name.length > 100) {
    errors.certification_name = t('dashboard.courses.certification.form.certification_name_max_length');
  }

  if (!values.certification_description) {
    errors.certification_description = t('dashboard.courses.certification.form.certification_description_required');
  } else if (values.certification_description.length > 500) {
    errors.certification_description = t('dashboard.courses.certification.form.certification_description_max_length');
  }

  return errors;
};

// The tab: the completion screen is open to every plan, only the certificate
// below it needs the certifications feature.
// Two sub-tabs: what learners see when they finish, and the certificate.
// Both are drafts the header Save sends, so switching keeps the edits.
function EditCourseCertification(_props: EditCourseCertificationProps) {
  const { t } = useTranslation()
  const [section, setSection] = useSubTab<Section>('completion', SECTIONS, { rememberAs: 'course-editor:certification' })
  const completionDirty = useDraftDirty('completion')
  const certificateDirty = useDraftDirty('certification')
  return (
    <EditorPage>
      <SubTabs
        ariaLabel={t('dashboard.courses.settings.tabs.certification')}
        value={section}
        onChange={setSection}
        items={[
          {
            key: 'completion',
            label: t('dashboard.courses.completion.title', 'Completion screen'),
            icon: <Trophy size={15} />,
            dirty: completionDirty,
          },
          {
            key: 'certificate',
            label: t('dashboard.subtabs.certificate', 'Certificate'),
            icon: <Medal size={15} />,
            dirty: certificateDirty,
          },
        ]}
      >
        <SubTabPanel tab="completion">
          <CourseCompletionSettings />
        </SubTabPanel>
        <SubTabPanel tab="certificate">
          <FeatureGate feature="certifications">
            <CertificateSettings />
          </FeatureGate>
        </SubTabPanel>
      </SubTabs>
    </EditorPage>
  )
}

// Turning the certificate on or off creates or deletes it right away (it is a
// record, not a field). Its design is a draft that the header Save sends.
function CertificateSettings() {
  const { t } = useTranslation()
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { courseStructure, isLoading } = useCourse() as any;
  const session = useLHSession() as any;
  const org = useOrg() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient();

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

  // One certification per course.
  const existingCertification = Array.isArray(certifications?.data) ? certifications.data[0] : undefined;
  const hasExistingCertification = !!existingCertification;

  const serverValues = useMemo<CertificateDesignValues>(() => {
    const author = Array.isArray(courseStructure?.authors) ? courseStructure.authors[0] : undefined
    const instructor = author ? `${author.first_name || ''} ${author.last_name || ''}`.trim() : ''
    const config = existingCertification?.config || {};
    return {
      certification_name: config.certification_name || courseStructure?.name || '',
      certification_description: config.certification_description || courseStructure?.description || '',
      certification_type: config.certification_type || 'completion',
      certificate_pattern: config.certificate_pattern || 'professional',
      certificate_instructor: config.certificate_instructor || instructor,
    };
  }, [existingCertification, courseStructure?.authors, courseStructure?.name, courseStructure?.description]);

  const certificationUuid: string | undefined = existingCertification?.certification_uuid
  const draft = useSectionDraft<CertificateDesignValues>('certification', {
    label: t('dashboard.courses.settings.tabs.certification'),
    tab: 'certification',
    validate: (value: CertificateDesignValues) => Object.values(validate(value, t))[0] ?? null,
    save: async (value: CertificateDesignValues) => {
      if (!certificationUuid) return
      await updateCertification(certificationUuid, value, org?.id, access_token)
      await queryClient.invalidateQueries({ queryKey: queryKeys.certifications.byCourse(courseStructure.course_uuid) })
    },
  })
  const values = draft.value ?? serverValues
  const errors = validate(values, t)

  const enableCertification = async () => {
    if (hasExistingCertification) return
    setIsCreating(true);
    setError('');
    try {
      const result = await createCertification(courseStructure.id, values, org.id, access_token);
      // createCertification uses errorHandling which returns JSON directly on success
      if (!result) throw new Error('Failed to create certification');
      toast.success(t('dashboard.courses.certification.toasts.create_success'));
      draft.clear();
      await queryClient.invalidateQueries({ queryKey: queryKeys.certifications.byCourse(courseStructure.course_uuid) });
    } catch {
      setError(t('dashboard.courses.certification.errors.create_failed'));
      toast.error(t('dashboard.courses.certification.toasts.create_error'));
    } finally {
      setIsCreating(false);
    }
  };

  const removeCertification = async () => {
    if (!existingCertification) return
    setIsRemoving(true);
    setError('');
    try {
      const result = await deleteCertification(existingCertification.certification_uuid, org.id, access_token);
      if (!result) throw new Error('Failed to delete certification');
      toast.success(t('dashboard.courses.certification.toasts.remove_success'));
      draft.clear();
      await queryClient.invalidateQueries({ queryKey: queryKeys.certifications.byCourse(courseStructure.course_uuid) });
    } catch (e) {
      // The backend refuses to delete a certification that has already awarded
      // certificates, because deleting it destroys them and breaks the
      // verification links their holders have shared. Show that reason instead
      // of a generic failure; it tells the teacher what to do next.
      const detail = (e as any)?.detail ?? (e as any)?.message;
      setError(typeof detail === 'string' && detail ? detail : t('dashboard.courses.certification.errors.remove_failed'));
      toast.error(t('dashboard.courses.certification.toasts.remove_error'));
    } finally {
      setIsRemoving(false);
    }
  };

  if (isLoading || !courseStructure || (courseStructure.course_uuid && access_token && org?.id && isCertificationsPending)) {
    return <EditorSkeleton sections={1} rows={4} />;
  }

  if (certificationsError) {
    return <ErrorNotice>{t('dashboard.courses.certification.errors.loading')}</ErrorNotice>;
  }

  return (
    <>
      {draft.error && <ErrorNotice>{draft.error}</ErrorNotice>}
      <SectionCard
        icon={<Medal size={18} />}
        title={t('dashboard.courses.certification.title')}
        description={t('dashboard.courses.certification.subtitle')}
        bodyClassName={hasExistingCertification ? 'p-5' : 'p-0'}
        actions={
          <Switch
            checked={hasExistingCertification}
            onCheckedChange={(on) => (on ? enableCertification() : setConfirmRemove(true))}
            disabled={isCreating || isRemoving}
            aria-label={t('dashboard.courses.certification.title')}
          />
        }
      >
        {error && (
          <div className={hasExistingCertification ? 'mb-5' : 'px-5 pt-5'}>
            <ErrorNotice>{error}</ErrorNotice>
          </div>
        )}

        {hasExistingCertification ? (
          <CertificateDesigner
            values={values}
            errors={errors}
            onChange={(field, value) => draft.set({ ...values, [field]: value })}
          />
        ) : (
          <EmptyState
            icon={<Medal size={22} />}
            title={t('dashboard.courses.certification.states.disabled.title')}
            description={t('dashboard.courses.certification.states.disabled.message')}
            action={
              <Button variant="primary" loading={isCreating} icon={<Medal size={14} />} onClick={enableCertification}>
                {isCreating
                  ? t('dashboard.courses.certification.states.disabled.creating')
                  : t('dashboard.courses.certification.states.disabled.button')}
              </Button>
            }
          />
        )}
      </SectionCard>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('dashboard.courses.editor.certification.remove_title')}
        message={t('dashboard.courses.editor.certification.remove_message')}
        confirmLabel={t('dashboard.courses.editor.certification.remove_confirm')}
        onConfirm={removeCertification}
      />
    </>
  );
}

export default EditCourseCertification;
