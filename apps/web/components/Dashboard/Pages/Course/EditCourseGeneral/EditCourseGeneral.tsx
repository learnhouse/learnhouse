'use client'
import FormLayout, {
  FormField,
  FormLabelAndMessage,
  Input,
  Textarea,
} from '@components/Objects/StyledElements/Form/Form';
import { useFormik } from 'formik';
import { AlertTriangle } from 'lucide-react';
import * as Form from '@radix-ui/react-form';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import ThumbnailUpdate from './ThumbnailUpdate';
import { useCourseFieldSync } from '@components/Contexts/CourseContext';
import FormTagInput from '@components/Objects/StyledElements/Form/TagInput';
import LearningItemsList from './LearningItemsList';
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from "./CustomSelect";
import { useTranslation } from 'react-i18next';

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

  // Use the new field sync hook
  const {
    syncChanges,
    cancelPendingSync,
    courseStructure,
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

  // Sync form changes to context — compare against formik.initialValues
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPendingSync();
    };
  }, [cancelPendingSync]);

  if (isLoading || !courseStructure) {
    return <div>{t('dashboard.courses.settings.loading')}</div>;
  }

  return (
    <div className="h-full">
      <div className="h-6" />
      <div className="px-10 pb-10">
        <div className="bg-white rounded-xl shadow-xs">
          <FormLayout onSubmit={formik.handleSubmit} className="p-6">
            {error && (
              <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 mb-6 transition-all shadow-xs">
                <AlertTriangle size={18} />
                <div className="font-bold text-sm">{error}</div>
              </div>
            )}

            <div className="space-y-6">
              <FormField name="name">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.name_label')} message={formik.errors.name} />
                <Form.Control asChild>
                  <Input
                    style={{ backgroundColor: 'white' }}
                    onChange={formik.handleChange}
                    value={formik.values.name}
                    type="text"
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormField>

              <FormField name="description">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.description_label')} message={formik.errors.description} />
                <Form.Control asChild>
                  <Input
                    style={{ backgroundColor: 'white' }}
                    onChange={formik.handleChange}
                    value={formik.values.description}
                    type="text"
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormField>

              <FormField name="about">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.about_label')} message={formik.errors.about} />
                <Form.Control asChild>
                  <Textarea
                    style={{ backgroundColor: 'white', height: '200px', minHeight: '200px' }}
                    onChange={formik.handleChange}
                    value={formik.values.about}
                    required
                    disabled={isSaving}
                  />
                </Form.Control>
              </FormField>

              <FormField name="learnings">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.learnings_label')} message={formik.touched.learnings ? formik.errors.learnings : undefined} />
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
              </FormField>

              <FormField name="tags">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.tags_label')} message={formik.errors.tags} />
                <Form.Control asChild>
                  <FormTagInput
                    placeholder={t('dashboard.courses.general.form.tags_placeholder')}
                    onChange={(value) => formik.setFieldValue('tags', value)}
                    value={formik.values.tags}
                  />
                </Form.Control>
              </FormField>

              <FormField name="thumbnail_type">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.thumbnail_type_label')} />
                <Form.Control asChild>
                  <CustomSelect
                    value={formik.values.thumbnail_type}
                    onValueChange={(value) => {
                      if (!value) return;
                      formik.setFieldValue('thumbnail_type', value);
                    }}
                    disabled={isSaving}
                  >
                    <CustomSelectTrigger className="w-full bg-white">
                      <CustomSelectValue>
                        {formik.values.thumbnail_type === 'image' ? t('dashboard.courses.general.form.thumbnail_type_image') :
                         formik.values.thumbnail_type === 'video' ? t('dashboard.courses.general.form.thumbnail_type_video') :
                         formik.values.thumbnail_type === 'both' ? t('dashboard.courses.general.form.thumbnail_type_both') : t('dashboard.courses.general.form.thumbnail_type_image')}
                      </CustomSelectValue>
                    </CustomSelectTrigger>
                    <CustomSelectContent>
                      <CustomSelectItem value="image">{t('dashboard.courses.general.form.thumbnail_type_image')}</CustomSelectItem>
                      <CustomSelectItem value="video">{t('dashboard.courses.general.form.thumbnail_type_video')}</CustomSelectItem>
                      <CustomSelectItem value="both">{t('dashboard.courses.general.form.thumbnail_type_both')}</CustomSelectItem>
                    </CustomSelectContent>
                  </CustomSelect>
                </Form.Control>
              </FormField>

              <FormField name="thumbnail">
                <FormLabelAndMessage label={t('dashboard.courses.general.form.thumbnail_label')} />
                <Form.Control asChild>
                  <ThumbnailUpdate thumbnailType={formik.values.thumbnail_type} />
                </Form.Control>
              </FormField>
            </div>
          </FormLayout>
        </div>
      </div>
    </div>
  );
}

export default EditCourseGeneral;
