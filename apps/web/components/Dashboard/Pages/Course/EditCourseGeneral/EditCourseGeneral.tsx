'use client'
import FormLayout from '@components/Objects/StyledElements/Form/Form';
import { useFormik } from 'formik';
import * as Form from '@radix-ui/react-form';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import ThumbnailUpdate from './ThumbnailUpdate';
import { useCourseFieldSync } from '@components/Contexts/CourseContext';
import FormTagInput from '@components/Objects/StyledElements/Form/TagInput';
import LearningItemsList from './LearningItemsList';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, ListChecks, TextAa } from '@phosphor-icons/react';
import { INPUT, TEXTAREA, SectionCard, SegmentedControl } from '@components/Dashboard/Shared/DashKit/DashKit';
import { EditorPage, EditorSkeleton, ErrorNotice, FormRow } from '../courseEditorUi';
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs';

const SECTIONS = ['details', 'learnings', 'thumbnail'] as const;
type Section = (typeof SECTIONS)[number];
const DETAIL_FIELDS = ['name', 'description', 'about', 'tags'];

type EditCourseStructureProps = {
  orgslug: string
  course_uuid?: string
}

const validate = (values: any, t: any) => {
  const errors = {} as any;

  if (!values.name) {
    errors.name = t('dashboard.courses.general.form.name_required');
  } else if (values.name.length > 100) {
    errors.name = t('dashboard.courses.general.form.name_max_length');
  }

  if (!values.description) {
    errors.description = t('dashboard.courses.general.form.description_required');
  } else if (values.description.length > 1000) {
    errors.description = t('dashboard.courses.general.form.description_max_length');
  }

  if (!values.learnings) {
    errors.learnings = t('dashboard.courses.general.form.learnings_required');
  } else {
    try {
      const learningItems = JSON.parse(values.learnings);
      if (!Array.isArray(learningItems)) {
        errors.learnings = t('dashboard.courses.general.form.learnings_invalid_format');
      } else if (learningItems.length === 0) {
        errors.learnings = t('dashboard.courses.general.form.learnings_min_items');
      } else {
        // Check if any item has empty text
        const hasEmptyText = learningItems.some(item => !item.text || item.text.trim() === '');
        if (hasEmptyText) {
          errors.learnings = t('dashboard.courses.general.form.learnings_empty_text');
        }
      }
    } catch (e) {
      errors.learnings = t('dashboard.courses.general.form.learnings_invalid_json');
    }
  }

  return errors;
};

function EditCourseGeneral(props: EditCourseStructureProps) {
  const { t } = useTranslation()
  const [error, setError] = useState('');
  const [section, setSection] = useSubTab<Section>('details', SECTIONS, { rememberAs: 'course-editor:general' });

  // Use the new field sync hook
  const {
    syncChanges,
    courseStructure,
    pendingChanges,
    unsyncedChanges,
    isLoading,
    isSaving,
  } = useCourseFieldSync('editCourseGeneral');

  const previousValuesRef = useRef<any>(null);

  // Initialize learnings as a JSON array if it's not already
  const initializeLearnings = useCallback((learnings: any) => {
    if (!learnings) {
      return JSON.stringify([{ id: 'default-1', text: '', emoji: '📝' }]);
    }

    try {
      const parsed = JSON.parse(learnings);
      if (Array.isArray(parsed)) {
        return learnings;
      }
      if (typeof learnings === 'string') {
        return JSON.stringify([{
          id: 'default-1',
          text: learnings,
          emoji: '📝'
        }]);
      }
      return JSON.stringify([{ id: 'default-1', text: '', emoji: '📝' }]);
    } catch (e) {
      if (typeof learnings === 'string') {
        return JSON.stringify([{
          id: 'default-1',
          text: learnings,
          emoji: '📝'
        }]);
      }
      return JSON.stringify([{ id: 'default-1', text: '', emoji: '📝' }]);
    }
  }, []);

  // Memoize initial values to prevent unnecessary recalculations
  const initialValues = useMemo(() => {
    const thumbnailType = courseStructure?.thumbnail_type || 'image';
    return {
      name: courseStructure?.name || '',
      description: courseStructure?.description || '',
      about: courseStructure?.about || '',
      learnings: initializeLearnings(courseStructure?.learnings || ''),
      tags: courseStructure?.tags || '',
      public: courseStructure?.public || false,
      thumbnail_type: thumbnailType,
    };
  }, [courseStructure?.name, courseStructure?.description, courseStructure?.about,
      courseStructure?.learnings, courseStructure?.tags, courseStructure?.public,
      courseStructure?.thumbnail_type, initializeLearnings]);

  const formik = useFormik({
    initialValues,
    validate: (values) => validate(values, t),
    onSubmit: async values => {
      // The actual save is handled by SaveState component
      // This is just for form validation purposes
    },
    enableReinitialize: true,
  }) as any;

  // Sync form changes to context; compare against formik.initialValues
  // so that reinitialization from server data is never treated as a user edit
  useEffect(() => {
    if (isLoading || isSaving) return;

    // Compare current values against formik's own initialValues.
    // When enableReinitialize triggers, both update together → no false diff.
    const changes: any = {};
    Object.keys(formik.values).forEach(key => {
      if (formik.values[key] !== formik.initialValues[key]) {
        changes[key] = formik.values[key];
      }
    });

    const hasChanges = Object.keys(changes).length > 0;

    // Only sync when there are actual user changes AND values changed since last sync
    if (hasChanges) {
      const changesStr = JSON.stringify(changes);
      const prevStr = JSON.stringify(previousValuesRef.current);
      if (changesStr !== prevStr) {
        previousValuesRef.current = changes;
        syncChanges(changes);
      }
    } else {
      previousValuesRef.current = null;
    }
  }, [formik.values, formik.initialValues, isLoading, isSaving, syncChanges]);

  // useCourseFieldSync handles the unmount cleanup (flushing pending edits
  // instead of discarding them), so no local cleanup is needed here.

  if (isLoading || !courseStructure) {
    return (
      <EditorPage>
        <EditorSkeleton sections={3} />
      </EditorPage>
    );
  }

  // Edits sync into the course store (and reinitialize the form), so the
  // store's unsaved fields are what marks a sub-tab, as in the main tab bar.
  const unsaved = { ...pendingChanges, ...unsyncedChanges };
  const changed = (key: string) => key in unsaved || formik.values[key] !== formik.initialValues[key];

  return (
    <EditorPage>
      <FormLayout onSubmit={formik.handleSubmit} className="space-y-5">
        {error && <ErrorNotice>{error}</ErrorNotice>}

        <SubTabs
          ariaLabel={t('dashboard.courses.settings.tabs.general')}
          value={section}
          onChange={setSection}
          items={[
            {
              key: 'details',
              label: t('dashboard.subtabs.details', 'Details'),
              icon: <TextAa size={15} />,
              dirty: DETAIL_FIELDS.some(changed),
            },
            {
              key: 'learnings',
              label: t('dashboard.courses.general.form.learnings_label'),
              icon: <ListChecks size={15} />,
              dirty: changed('learnings'),
            },
            {
              key: 'thumbnail',
              label: t('dashboard.courses.general.form.thumbnail_label'),
              icon: <ImageIcon size={15} />,
              dirty: changed('thumbnail_type'),
            },
          ]}
        >
          <SubTabPanel tab="details">
            <SectionCard
              icon={<TextAa size={18} />}
              title={t('dashboard.courses.editor.general.details_title')}
              description={t('dashboard.courses.editor.general.details_description')}
              bodyClassName="p-5 space-y-5"
            >
              <FormRow name="name" label={t('dashboard.courses.general.form.name_label')} error={formik.errors.name}>
                <Form.Control asChild>
                  <input
                    className={INPUT}
                    onChange={formik.handleChange}
                    value={formik.values.name}
                    type="text"
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormRow>

              <FormRow name="description" label={t('dashboard.courses.general.form.description_label')} error={formik.errors.description}>
                <Form.Control asChild>
                  <input
                    className={INPUT}
                    onChange={formik.handleChange}
                    value={formik.values.description}
                    type="text"
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormRow>

              <FormRow name="about" label={t('dashboard.courses.general.form.about_label')} error={formik.errors.about}>
                <Form.Control asChild>
                  <textarea
                    className={`${TEXTAREA} h-[200px] min-h-[200px] resize-y`}
                    onChange={formik.handleChange}
                    value={formik.values.about}
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormRow>

              <FormRow
                name="tags"
                label={t('dashboard.courses.general.form.tags_label')}
                error={formik.errors.tags}
                hint={t('dashboard.courses.editor.general.tags_hint')}
              >
                <Form.Control asChild>
                  <FormTagInput
                    placeholder={t('dashboard.courses.general.form.tags_placeholder')}
                    onChange={(value) => formik.setFieldValue('tags', value)}
                    value={formik.values.tags}
                  />
                </Form.Control>
              </FormRow>
            </SectionCard>
          </SubTabPanel>

          <SubTabPanel tab="learnings">
            <SectionCard
              icon={<ListChecks size={18} />}
              title={t('dashboard.courses.general.form.learnings_label')}
              description={t('dashboard.courses.editor.general.learnings_description')}
            >
              <Form.Field name="learnings">
                <Form.Control asChild>
                  <LearningItemsList
                    value={formik.values.learnings}
                    onChange={(value) => {
                      formik.setFieldTouched('learnings', true, false)
                      formik.setFieldValue('learnings', value)
                    }}
                    error={formik.touched.learnings ? formik.errors.learnings : undefined}
                  />
                </Form.Control>
              </Form.Field>
            </SectionCard>
          </SubTabPanel>

          <SubTabPanel tab="thumbnail">
            <SectionCard
              icon={<ImageIcon size={18} />}
              title={t('dashboard.courses.general.form.thumbnail_label')}
              description={t('dashboard.courses.editor.general.thumbnail_description')}
              actions={
                <SegmentedControl
                  ariaLabel={t('dashboard.courses.general.form.thumbnail_type_label')}
                  value={formik.values.thumbnail_type as 'image' | 'video' | 'both'}
                  options={[
                    { key: 'image', label: t('dashboard.courses.general.form.thumbnail_type_image') },
                    { key: 'video', label: t('dashboard.courses.general.form.thumbnail_type_video') },
                    { key: 'both', label: t('dashboard.courses.general.form.thumbnail_type_both') },
                  ]}
                  onChange={(value) => {
                    if (!value || isSaving) return;
                    formik.setFieldValue('thumbnail_type', value);
                  }}
                />
              }
            >
              <Form.Field name="thumbnail">
                <Form.Control asChild>
                  <ThumbnailUpdate thumbnailType={formik.values.thumbnail_type} />
                </Form.Control>
              </Form.Field>
            </SectionCard>
          </SubTabPanel>
        </SubTabs>
      </FormLayout>
    </EditorPage>
  );
}

export default EditCourseGeneral;
