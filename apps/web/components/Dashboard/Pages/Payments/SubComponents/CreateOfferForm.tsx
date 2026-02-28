'use client';
import React, { useEffect, useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { createOffer } from '@services/payments/offers';
import { getPaymentsGroups } from '@services/payments/groups';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import toast from 'react-hot-toast';
import { mutate } from 'swr';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { Label } from '@components/ui/label';
import currencyCodes from 'currency-codes';
import useSWR from 'swr';
import { BookOpen, X, Plus, Layers } from 'lucide-react';
import { getOrgCourses } from '@services/courses/courses';

const validationSchema = Yup.object().shape({
  name: Yup.string().required('Name is required'),
  description: Yup.string().required('Description is required'),
  amount: Yup.number().min(1, 'Amount must be greater than zero').required('Amount is required'),
  benefits: Yup.string(),
  currency: Yup.string().required('Currency is required'),
  offer_type: Yup.string().oneOf(['one_time', 'subscription']).required('Offer type is required'),
  price_type: Yup.string().oneOf(['fixed_price', 'customer_choice']).required('Price type is required'),
});

interface OfferFormValues {
  name: string;
  description: string;
  offer_type: 'one_time' | 'subscription';
  price_type: 'fixed_price' | 'customer_choice';
  benefits: string;
  amount: number;
  currency: string;
  payments_group_id: number | '';
  resource_uuids: string[];
}

const CreateOfferForm: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const token = session?.data?.tokens?.access_token;
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    const allCurrencies = currencyCodes.data.map((c) => ({
      code: c.code,
      name: `${c.code} - ${c.currency}`,
    }));
    setCurrencies(allCurrencies);
  }, []);

  // Payment Groups for the optional group picker
  const { data: groupsResult } = useSWR(
    org && token ? [`/payments/${org.id}/groups`, token] : null,
    ([, t]: any) => getPaymentsGroups(org.id, t)
  );
  const groups: any[] = Array.isArray(groupsResult?.data) ? groupsResult.data : Array.isArray(groupsResult) ? groupsResult : [];

  // Courses for the direct course picker
  const { data: courses } = useSWR(
    org && token ? [`/courses/org`, org.slug, token] : null,
    ([, slug, t]: any) => getOrgCourses(slug, null, t, true)
  );

  const initialValues: OfferFormValues = {
    name: '',
    description: '',
    offer_type: 'one_time',
    price_type: 'fixed_price',
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
        toast.success('Offer created successfully');
        mutate([`/payments/${org.id}/offers`, token]);
        resetForm();
        onSuccess();
      } else {
        toast.error(res.data?.detail || 'Failed to create offer');
      }
    } catch (error) {
      toast.error('An error occurred while creating the offer');
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
              <Label htmlFor="name">Offer Name</Label>
              <Field name="name" as={Input} placeholder="Offer Name" />
              <ErrorMessage name="name" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Field name="description" as={Textarea} placeholder="Offer Description" />
              <ErrorMessage name="description" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="offer_type">Offer Type</Label>
              <Select
                value={values.offer_type}
                onValueChange={(value) => {
                  setFieldValue('offer_type', value);
                  if (value === 'subscription') setFieldValue('price_type', 'fixed_price');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Offer Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one_time">One Time</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                </SelectContent>
              </Select>
              <ErrorMessage name="offer_type" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div>
              <Label htmlFor="price_type">Price Type</Label>
              <Select
                value={values.price_type}
                onValueChange={(value) => setFieldValue('price_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Price Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_price">Fixed Price</SelectItem>
                  {values.offer_type !== 'subscription' && (
                    <SelectItem value="customer_choice">Customer Choice</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <ErrorMessage name="price_type" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            <div className="flex space-x-2">
              <div className="grow">
                <Label htmlFor="amount">
                  {values.price_type === 'fixed_price' ? 'Price' : 'Minimum Amount'}
                </Label>
                <Field
                  name="amount"
                  as={Input}
                  type="number"
                  placeholder={values.price_type === 'fixed_price' ? 'Price' : 'Minimum Amount'}
                />
                <ErrorMessage name="amount" component="div" className="text-red-500 text-sm mt-1" />
              </div>
              <div className="w-1/3">
                <Label htmlFor="currency">Currency</Label>
                <Select
                  value={values.currency}
                  onValueChange={(value) => setFieldValue('currency', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Currency" />
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
              <Label htmlFor="benefits">Benefits</Label>
              <Field name="benefits" as={Textarea} placeholder="Comma-separated benefits" />
              <ErrorMessage name="benefits" component="div" className="text-red-500 text-sm mt-1" />
            </div>

            {/* ── Access ───────────────────────────────────────────────── */}
            <div className="border rounded-md p-3 space-y-3 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Access</p>
              <p className="text-xs text-gray-500">
                Add individual courses directly, or link to a Payment Group to grant access to a bundle of resources.
                You can use both at the same time.
              </p>

              {/* Direct course picker */}
              <div>
                <Label className="text-xs">Courses (direct)</Label>
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
                      <span>Add a course…</span>
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
                  Payment Group <span className="text-gray-400 font-normal">(optional — for bundles/subscriptions)</span>
                </Label>
                <Select
                  value={String(values.payments_group_id)}
                  onValueChange={(value) =>
                    setFieldValue('payments_group_id', value === 'none' ? '' : Number(value))
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Link to a Payment Group…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
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
                  All resources in the selected Payment Group will be accessible to enrolled users.
                  Manage group resources from the <strong>Payment Groups</strong> tab.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Offer'}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default CreateOfferForm;
