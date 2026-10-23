'use client';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { createOffer } from '@services/payments/offers';
import { getPaymentsGroups } from '@services/payments/groups';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics';
import { meaningfulMessage } from '@lib/errors/classify';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { Label } from '@components/ui/label';
import currencyCodes from 'currency-codes';
import { BookOpen, X, Plus, Layers } from 'lucide-react';
import { getOrgCourses } from '@services/courses/courses';
import { BILLING_INTERVALS, billingIntervalName } from '@lib/payments/billingInterval';

const buildValidationSchema = (t: (key: string) => string) => Yup.object().shape({
  name: Yup.string().required(t('dash.payments.validation_name_required')),
  description: Yup.string().required(t('dash.payments.validation_description_required')),
  amount: Yup.number().min(1, t('dash.payments.validation_amount_min')).required(t('dash.payments.validation_amount_required')),
  benefits: Yup.string(),
  currency: Yup.string().required(t('dash.payments.validation_currency_required')),
  offer_type: Yup.string().oneOf(['one_time', 'subscription']).required(t('dash.payments.validation_offer_type_required')),
  price_type: Yup.string().oneOf(['fixed_price', 'customer_choice']).required(t('dash.payments.validation_price_type_required')),
  billing_interval: Yup.string().oneOf(BILLING_INTERVALS).required(t('dash.payments.validation_billing_period_required')),
});

interface OfferFormValues {
  name: string;
  description: string;
  offer_type: 'one_time' | 'subscription';
  price_type: 'fixed_price' | 'customer_choice';
  billing_interval: 'month' | 'year';
  benefits: string;
  amount: number;
  currency: string;
  payments_group_id: number | '';
  resource_uuids: string[];
}

const CreateOfferForm: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const { t } = useTranslation();
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient();
  const { track } = useLHAnalytics('dashboard');
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const validationSchema = buildValidationSchema(t);

  useEffect(() => {
    const allCurrencies = currencyCodes.data.map((c) => ({
      code: c.code,
      name: `${c.code} - ${c.currency}`,
    }));
    setCurrencies(allCurrencies);
  }, []);

  // Payment Groups for the optional group picker
  const { data: groupsResult } = useQuery({
    queryKey: queryKeys.payments.groups(org?.id),
    queryFn: () => getPaymentsGroups(org.id, token),
    enabled: !!(org?.id && token),
    staleTime: 60_000,
  });
  const groups: any[] = Array.isArray(groupsResult?.data) ? groupsResult.data : Array.isArray(groupsResult) ? groupsResult : [];

  // Courses for the direct course picker
  const { data: courses } = useQuery({
    queryKey: queryKeys.courses.list(org?.slug ?? ''),
    queryFn: () => getOrgCourses(org.slug, null, token, true),
    enabled: !!(org?.slug && token),
    staleTime: 60_000,
  });

  const initialValues: OfferFormValues = {
    name: '',
    description: '',
    offer_type: 'one_time',
    price_type: 'fixed_price',
    billing_interval: 'month',
    benefits: '',
    amount: 1,
    currency: 'USD',
    payments_group_id: '',
    resource_uuids: [],
  };

  const handleSubmit = async (values: OfferFormValues, { setSubmitting, resetForm }: any) => {
    try {
      const payload = {
        ...values,
        payments_group_id: values.payments_group_id !== '' ? values.payments_group_id : undefined,
      };
      const res = await createOffer(org.id, payload, token);
      if (res.success) {
        track(AnalyticsEvent.OfferCreated, {
          offer_type: values.offer_type,
          price_type: values.price_type,
          billing_interval: values.offer_type === 'subscription' ? values.billing_interval : undefined,
          amount: values.amount,
        });
        toast.success(t('dash.payments.offer_created'));
        queryClient.invalidateQueries({ queryKey: queryKeys.payments.offers(org.id) });
        resetForm();
        onSuccess();
      } else {
        toast.error(res.data?.detail || t('dash.payments.offer_create_failed'));
      }
    } catch (error) {
      toast.error(meaningfulMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Formik initialValues={initialValues} validationSchema={validationSchema} onSubmit={handleSubmit}>
      {({ isSubmitting, values, setFieldValue }) => (
        <Form className="space-y-4">
          <div className="px-1.5 py-2 flex-col space-y-3">
            <div>
              <Label htmlFor="name">{t('dash.payments.offer_name')}</Label>
              <Field name="name" as={Input} placeholder={t('dash.payments.offer_name')} />
              <ErrorMessage name="name" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="description">{t('dash.payments.description')}</Label>
              <Field name="description" as={Textarea} placeholder={t('dash.payments.offer_description')} />
              <ErrorMessage name="description" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="offer_type">{t('dash.payments.offer_type')}</Label>
              <Select
                value={values.offer_type}
                onValueChange={(value) => {
                  setFieldValue('offer_type', value);
                  if (value === 'subscription') setFieldValue('price_type', 'fixed_price');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('dash.payments.offer_type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">{t('dash.payments.one_time')}</SelectItem>
                  <SelectItem value="subscription">{t('dash.payments.subscription')}</SelectItem>
                </SelectContent>
              </Select>
              <ErrorMessage name="offer_type" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="price_type">{t('dash.payments.price_type')}</Label>
              <Select
                value={values.price_type}
                onValueChange={(value) => setFieldValue('price_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('dash.payments.price_type')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_price">{t('dash.payments.fixed_price')}</SelectItem>
                  {values.offer_type !== 'subscription' && (
                    <SelectItem value="customer_choice">{t('dash.payments.customer_choice')}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <ErrorMessage name="price_type" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            {values.offer_type === 'subscription' && (
              <div>
                <Label htmlFor="billing_interval">{t('dash.payments.billing_period')}</Label>
                <Select
                  value={values.billing_interval}
                  onValueChange={(value) => setFieldValue('billing_interval', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('dash.payments.billing_period')} />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_INTERVALS.map((interval) => (
                      <SelectItem key={interval} value={interval}>
                        {billingIntervalName(interval)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ErrorMessage name="billing_interval" component="div" className="text-red-500 text-sm mt-1" />
              </div>
            )}

            <div className="flex space-x-2">
              <div className="grow">
                <Label htmlFor="amount">
                  {values.price_type === 'fixed_price' ? t('dash.payments.price') : t('dash.payments.minimum_amount')}
                </Label>
                <Field
                  name="amount"
                  as={Input}
                  type="number"
                  placeholder={values.price_type === 'fixed_price' ? t('dash.payments.price') : t('dash.payments.minimum_amount')}
                />
                <ErrorMessage name="amount" component="div" className="text-red-500 text-sm mt-1" />
              </div>
              <div className="w-1/3">
                <Label htmlFor="currency">{t('dash.payments.currency')}</Label>
                <Select
                  value={values.currency}
                  onValueChange={(value) => setFieldValue('currency', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('dash.payments.currency')} />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ErrorMessage name="currency" component="div" className="text-red-500 text-sm mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="benefits">{t('dash.payments.benefits')}</Label>
              <Field name="benefits" as={Textarea} placeholder={t('dash.payments.benefits_placeholder')} />
              <ErrorMessage name="benefits" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            {/* ── Access ───────────────────────────────────────────────── */}
            <div className="border rounded-md p-3 space-y-3 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{t('dash.payments.access')}</p>
              <p className="text-xs text-gray-500">
                {t('dash.payments.access_description')}
              </p>

              {/* Direct course picker */}
              <div>
                <Label className="text-xs">{t('dash.payments.courses_direct')}</Label>
                {values.resource_uuids.length > 0 && (
                  <ul className="mb-1 space-y-0.5">
                    {values.resource_uuids.map((uuid) => {
                      const course = (courses ?? []).find(
                        (c: any) => `course_${c.course_uuid?.replace('course_', '')}` === uuid
                      );
                      return (
                        <li key={uuid} className="flex items-center justify-between bg-white rounded px-2 py-1 text-xs border">
                          <div className="flex items-center gap-1.5">
                            <BookOpen size={11} className="text-indigo-500" />
                            <span>{course?.name ?? uuid}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setFieldValue(
                                'resource_uuids',
                                values.resource_uuids.filter((u) => u !== uuid)
                              )
                            }
                            className="text-red-400 hover:text-red-600"
                          >
                            <X size={11} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Select
                  value=""
                  onValueChange={(courseUuid) => {
                    if (courseUuid && !values.resource_uuids.includes(courseUuid)) {
                      setFieldValue('resource_uuids', [...values.resource_uuids, courseUuid]);
                    }
                  }}
                >
                  <SelectTrigger className="text-xs h-8">
                    <div className="flex items-center gap-1 text-gray-500">
                      <Plus size={11} />
                      <span>{t('dash.payments.add_a_course')}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {(courses ?? [])
                      .filter((c: any) => {
                        const uuid = `course_${c.course_uuid?.replace('course_', '')}`;
                        return !values.resource_uuids.includes(uuid);
                      })
                      .map((c: any) => {
                        const uuid = `course_${c.course_uuid?.replace('course_', '')}`;
                        return (
                          <SelectItem key={uuid} value={uuid}>
                            {c.name}
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Group picker */}
              <div>
                <Label className="text-xs">
                  {t('dash.payments.payment_group')} <span className="text-gray-400 font-normal">{t('dash.payments.payment_group_hint')}</span>
                </Label>
                <Select
                  value={String(values.payments_group_id)}
                  onValueChange={(value) =>
                    setFieldValue('payments_group_id', value === 'none' ? '' : Number(value))
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder={t('dash.payments.link_to_payment_group')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('dash.payments.none')}</SelectItem>
                    {groups.map((g: any) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        <div className="flex items-center gap-1.5">
                          <Layers size={11} className="text-indigo-500" />
                          {g.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">
                  {t('dash.payments.group_resources_note')}{' '}
                  <strong>{t('dash.payments.payment_groups_tab')}</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('dash.payments.creating') : t('dash.payments.create_offer')}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default CreateOfferForm;
