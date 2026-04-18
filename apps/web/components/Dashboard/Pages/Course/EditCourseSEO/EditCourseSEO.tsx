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
import React, { useEffect, useRef, useMemo } from 'react';
import { useCourseFieldSync } from '@components/Contexts/CourseContext';
import {
  CustomSelect,
  CustomSelectContent,
  CustomSelectItem,
  CustomSelectTrigger,
  CustomSelectValue,
} from "../EditCourseGeneral/CustomSelect";
import { useTranslation } from 'react-i18next';

type EditCourseSEOProps = {
  orgslug: string
  course_uuid?: string
}

interface SEOValues {
  title: string
  description: string
  keywords: string
  canonical_url: string
  og_title: string
  og_description: string
  og_image: string
  twitter_card: string
  twitter_title: string
  twitter_description: string
  robots_noindex: boolean
  robots_nofollow: boolean
  enable_jsonld: boolean
}

const validate = (values: SEOValues, t: any) => {
  const errors = {} as Partial<SEOValues>;

  if (values.title && values.title.length > 70) {
    errors.title = t('dashboard.courses.seo.validation.title_max_length');
  }

  if (values.description && values.description.length > 160) {
    errors.description = t('dashboard.courses.seo.validation.description_max_length');
  }

  if (values.og_title && values.og_title.length > 70) {
    errors.og_title = t('dashboard.courses.seo.validation.og_title_max_length');
  }

  if (values.og_description && values.og_description.length > 200) {
    errors.og_description = t('dashboard.courses.seo.validation.og_description_max_length');
  }

  if (values.twitter_title && values.twitter_title.length > 70) {
    errors.twitter_title = t('dashboard.courses.seo.validation.twitter_title_max_length');
  }

  if (values.twitter_description && values.twitter_description.length > 200) {
    errors.twitter_description = t('dashboard.courses.seo.validation.twitter_description_max_length');
  }

  if (values.canonical_url && !isValidUrl(values.canonical_url)) {
    errors.canonical_url = t('dashboard.courses.seo.validation.invalid_url');
  }

  if (values.og_image && !isValidUrl(values.og_image)) {
    errors.og_image = t('dashboard.courses.seo.validation.invalid_url');
  }

  return errors;
};

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

function EditCourseSEO(props: EditCourseSEOProps) {
  const { t } = useTranslation()
  const [error, setError] = React.useState('');

  // Use the new field sync hook
  const {
    syncChanges,
    cancelPendingSync,
    courseStructure,
    isLoading,
    isSaving,
  } = useCourseFieldSync('editCourseSEO');

  // Track if we should sync (to avoid syncing on initial load)
  const hasInitializedRef = useRef(false);
  const previousValuesRef = useRef<SEOValues | null>(null);

  // Memoize initial values
  const initialValues = useMemo((): SEOValues => {
    const seo = courseStructure?.seo || {};
    return {
      title: seo.title || '',
      description: seo.description || '',
      keywords: seo.keywords || '',
      canonical_url: seo.canonical_url || '',
      og_title: seo.og_title || '',
      og_description: seo.og_description || '',
      og_image: seo.og_image || '',
      twitter_card: seo.twitter_card || 'summary_large_image',
      twitter_title: seo.twitter_title || '',
      twitter_description: seo.twitter_description || '',
      robots_noindex: seo.robots_noindex || false,
      robots_nofollow: seo.robots_nofollow || false,
      enable_jsonld: seo.enable_jsonld !== false,
    };
  }, [courseStructure?.seo]);

  const formik = useFormik({
    initialValues,
    validate: (values) => validate(values, t),
    onSubmit: async () => {
      // The actual save is handled by SaveState component
    },
    enableReinitialize: true,
  });

  // Sync form changes to context using the new system
  useEffect(() => {
    // Skip if loading or saving
    if (isLoading || isSaving) return;

    // Skip initial mount
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      previousValuesRef.current = formik.values;
      return;
    }

    // Check if values actually changed from previous
    const prevValues = previousValuesRef.current;
    if (!prevValues) {
      previousValuesRef.current = formik.values;
      return;
    }

    // Compare current values with previous
    const hasChanges = Object.keys(formik.values).some(
      key => formik.values[key as keyof SEOValues] !== prevValues[key as keyof SEOValues]
    );

    if (hasChanges) {
      // Build the SEO object with only changed fields tracked
      const seoData = {
        title: formik.values.title || null,
        description: formik.values.description || null,
        keywords: formik.values.keywords || null,
        canonical_url: formik.values.canonical_url || null,
        og_title: formik.values.og_title || null,
        og_description: formik.values.og_description || null,
        og_image: formik.values.og_image || null,
        twitter_card: formik.values.twitter_card || null,
        twitter_title: formik.values.twitter_title || null,
        twitter_description: formik.values.twitter_description || null,
        robots_noindex: formik.values.robots_noindex,
        robots_nofollow: formik.values.robots_nofollow,
        enable_jsonld: formik.values.enable_jsonld,
      };

      // Sync changes with debounce - only update the seo field
      syncChanges({ seo: seoData });

      // Update previous values ref
      previousValuesRef.current = { ...formik.values };
    }
  }, [formik.values, isLoading, isSaving, syncChanges]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPendingSync();
    };
  }, [cancelPendingSync]);

  if (isLoading || !courseStructure) {
    return <div>{t('dashboard.courses.settings.loading')}</div>;
  }

  const CharacterCounter = ({ current, max }: { current: number, max: number }) => (
    <span className={`text-xs ${current > max ? 'text-red-500' : 'text-gray-400'}`}>
      {current}/{max}
    </span>
  );

  return (
    <div>
      <div className="h-6"></div>
      <div className="mx-4 sm:mx-10 bg-white rounded-xl shadow-xs px-4 py-4">
        <FormLayout onSubmit={formik.handleSubmit}>
            {error && (
              <div className="flex justify-center bg-red-200 rounded-md text-red-950 space-x-2 items-center p-4 mb-6 transition-all shadow-xs">
                <AlertTriangle size={18} />
                <div className="font-bold text-sm">{error}</div>
              </div>
            )}

            {/* Basic SEO Section */}
            <div className="mb-8">
              <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">
                  {t('dashboard.courses.seo.sections.basic.title')}
                </h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                  {t('dashboard.courses.seo.sections.basic.subtitle')}
                </h2>
              </div>

              <div className="space-y-4">
                <FormField name="title">
                  <div className="flex justify-between items-center">
                    <FormLabelAndMessage
                      label={t('dashboard.courses.seo.form.title_label')}
                      message={formik.errors.title}
                    />
                    <CharacterCounter current={formik.values.title.length} max={70} />
                  </div>
                  <Form.Control asChild>
                    <Input
                      style={{ backgroundColor: 'white' }}
                      onChange={formik.handleChange}
                      value={formik.values.title}
                      type="text"
                      placeholder={t('dashboard.courses.seo.form.title_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('dashboard.courses.seo.form.title_hint')}
                  </p>
                </FormField>

                <FormField name="description">
                  <div className="flex justify-between items-center">
                    <FormLabelAndMessage
                      label={t('dashboard.courses.seo.form.description_label')}
                      message={formik.errors.description}
                    />
                    <CharacterCounter current={formik.values.description.length} max={160} />
                  </div>
                  <Form.Control asChild>
                    <Textarea
                      style={{ backgroundColor: 'white', height: '80px', minHeight: '80px' }}
                      onChange={formik.handleChange}
                      value={formik.values.description}
                      placeholder={t('dashboard.courses.seo.form.description_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('dashboard.courses.seo.form.description_hint')}
                  </p>
                </FormField>

                <FormField name="keywords">
                  <FormLabelAndMessage
                    label={t('dashboard.courses.seo.form.keywords_label')}
                    message={formik.errors.keywords}
                  />
                  <Form.Control asChild>
                    <Input
                      style={{ backgroundColor: 'white' }}
                      onChange={formik.handleChange}
                      value={formik.values.keywords}
                      type="text"
                      placeholder={t('dashboard.courses.seo.form.keywords_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('dashboard.courses.seo.form.keywords_hint')}
                  </p>
                </FormField>

                <FormField name="canonical_url">
                  <FormLabelAndMessage
                    label={t('dashboard.courses.seo.form.canonical_url_label')}
                    message={formik.errors.canonical_url}
                  />
                  <Form.Control asChild>
                    <Input
                      style={{ backgroundColor: 'white' }}
                      onChange={formik.handleChange}
                      value={formik.values.canonical_url}
                      type="text"
                      placeholder={t('dashboard.courses.seo.form.canonical_url_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('dashboard.courses.seo.form.canonical_url_hint')}
                  </p>
                </FormField>
              </div>
            </div>

            {/* Open Graph Section */}
            <div className="mb-8">
              <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">
                  {t('dashboard.courses.seo.sections.opengraph.title')}
                </h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                  {t('dashboard.courses.seo.sections.opengraph.subtitle')}
                </h2>
              </div>

              <div className="space-y-4">
                <FormField name="og_title">
                  <div className="flex justify-between items-center">
                    <FormLabelAndMessage
                      label={t('dashboard.courses.seo.form.og_title_label')}
                      message={formik.errors.og_title}
                    />
                    <CharacterCounter current={formik.values.og_title.length} max={70} />
                  </div>
                  <Form.Control asChild>
                    <Input
                      style={{ backgroundColor: 'white' }}
                      onChange={formik.handleChange}
                      value={formik.values.og_title}
                      type="text"
                      placeholder={t('dashboard.courses.seo.form.og_title_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                </FormField>

                <FormField name="og_description">
                  <div className="flex justify-between items-center">
                    <FormLabelAndMessage
                      label={t('dashboard.courses.seo.form.og_description_label')}
                      message={formik.errors.og_description}
                    />
                    <CharacterCounter current={formik.values.og_description.length} max={200} />
                  </div>
                  <Form.Control asChild>
                    <Textarea
                      style={{ backgroundColor: 'white', height: '80px', minHeight: '80px' }}
                      onChange={formik.handleChange}
                      value={formik.values.og_description}
                      placeholder={t('dashboard.courses.seo.form.og_description_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                </FormField>

                <FormField name="og_image">
                  <FormLabelAndMessage
                    label={t('dashboard.courses.seo.form.og_image_label')}
                    message={formik.errors.og_image}
                  />
                  <Form.Control asChild>
                    <Input
                      style={{ backgroundColor: 'white' }}
                      onChange={formik.handleChange}
                      value={formik.values.og_image}
                      type="text"
                      placeholder={t('dashboard.courses.seo.form.og_image_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('dashboard.courses.seo.form.og_image_hint')}
                  </p>
                </FormField>
              </div>
            </div>

            {/* Twitter Card Section */}
            <div className="mb-8">
              <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">
                  {t('dashboard.courses.seo.sections.twitter.title')}
                </h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                  {t('dashboard.courses.seo.sections.twitter.subtitle')}
                </h2>
              </div>

              <div className="space-y-4">
                <FormField name="twitter_card">
                  <FormLabelAndMessage
                    label={t('dashboard.courses.seo.form.twitter_card_label')}
                  />
                  <Form.Control asChild>
                    <CustomSelect
                      value={formik.values.twitter_card}
                      onValueChange={(value) => {
                        if (!value) return;
                        formik.setFieldValue('twitter_card', value);
                      }}
                      disabled={isSaving}
                    >
                      <CustomSelectTrigger className="w-full bg-white">
                        <CustomSelectValue>
                          {formik.values.twitter_card === 'summary'
                            ? t('dashboard.courses.seo.form.twitter_card_summary')
                            : t('dashboard.courses.seo.form.twitter_card_summary_large')}
                        </CustomSelectValue>
                      </CustomSelectTrigger>
                      <CustomSelectContent>
                        <CustomSelectItem value="summary">
                          {t('dashboard.courses.seo.form.twitter_card_summary')}
                        </CustomSelectItem>
                        <CustomSelectItem value="summary_large_image">
                          {t('dashboard.courses.seo.form.twitter_card_summary_large')}
                        </CustomSelectItem>
                      </CustomSelectContent>
                    </CustomSelect>
                  </Form.Control>
                </FormField>

                <FormField name="twitter_title">
                  <div className="flex justify-between items-center">
                    <FormLabelAndMessage
                      label={t('dashboard.courses.seo.form.twitter_title_label')}
                      message={formik.errors.twitter_title}
                    />
                    <CharacterCounter current={formik.values.twitter_title.length} max={70} />
                  </div>
                  <Form.Control asChild>
                    <Input
                      style={{ backgroundColor: 'white' }}
                      onChange={formik.handleChange}
                      value={formik.values.twitter_title}
                      type="text"
                      placeholder={t('dashboard.courses.seo.form.twitter_title_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                </FormField>

                <FormField name="twitter_description">
                  <div className="flex justify-between items-center">
                    <FormLabelAndMessage
                      label={t('dashboard.courses.seo.form.twitter_description_label')}
                      message={formik.errors.twitter_description}
                    />
                    <CharacterCounter current={formik.values.twitter_description.length} max={200} />
                  </div>
                  <Form.Control asChild>
                    <Textarea
                      style={{ backgroundColor: 'white', height: '80px', minHeight: '80px' }}
                      onChange={formik.handleChange}
                      value={formik.values.twitter_description}
                      placeholder={t('dashboard.courses.seo.form.twitter_description_placeholder')}
                      disabled={isSaving}
                    />
                  </Form.Control>
                </FormField>
              </div>
            </div>

            {/* Robots & Structured Data Section */}
            <div className="mb-8">
              <div className="flex flex-col bg-gray-50 -space-y-1 px-3 sm:px-5 py-3 rounded-md mb-3">
                <h1 className="font-bold text-lg sm:text-xl text-gray-800">
                  {t('dashboard.courses.seo.sections.robots.title')}
                </h1>
                <h2 className="text-gray-500 text-xs sm:text-sm">
                  {t('dashboard.courses.seo.sections.robots.subtitle')}
                </h2>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="robots_noindex"
                    name="robots_noindex"
                    checked={formik.values.robots_noindex}
                    onChange={formik.handleChange}
                    className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                    disabled={isSaving}
                  />
                  <label htmlFor="robots_noindex" className="text-sm font-medium text-gray-700">
                    {t('dashboard.courses.seo.form.robots_noindex_label')}
                  </label>
                </div>
                <p className="text-xs text-gray-400 ms-7">
                  {t('dashboard.courses.seo.form.robots_noindex_hint')}
                </p>

                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="robots_nofollow"
                    name="robots_nofollow"
                    checked={formik.values.robots_nofollow}
                    onChange={formik.handleChange}
                    className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                    disabled={isSaving}
                  />
                  <label htmlFor="robots_nofollow" className="text-sm font-medium text-gray-700">
                    {t('dashboard.courses.seo.form.robots_nofollow_label')}
                  </label>
                </div>
                <p className="text-xs text-gray-400 ms-7">
                  {t('dashboard.courses.seo.form.robots_nofollow_hint')}
                </p>

                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="enable_jsonld"
                      name="enable_jsonld"
                      checked={formik.values.enable_jsonld}
                      onChange={formik.handleChange}
                      className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                      disabled={isSaving}
                    />
                    <label htmlFor="enable_jsonld" className="text-sm font-medium text-gray-700">
                      {t('dashboard.courses.seo.form.enable_jsonld_label')}
                    </label>
                  </div>
                  <p className="text-xs text-gray-400 ms-7 mt-1">
                    {t('dashboard.courses.seo.form.enable_jsonld_hint')}
                  </p>
                </div>
              </div>
            </div>
          </FormLayout>
      </div>
    </div>
  );
}

export default EditCourseSEO;
