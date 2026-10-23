'use client';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { getOffers, updateOffer, archiveOffer } from '@services/payments/offers';
import { Plus, Pencil, Info, RefreshCcw, SquareCheck, ChevronDown, ChevronUp, Archive, Users, Layers } from 'lucide-react';
import currencyCodes from 'currency-codes';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import toast from 'react-hot-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Textarea } from '@components/ui/textarea';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import { Label } from '@components/ui/label';
import { Badge } from '@components/ui/badge';
import { usePaymentsEnabled } from '@hooks/usePaymentsEnabled';
import UnconfiguredPaymentsDisclaimer from '@components/Pages/Payments/UnconfiguredPaymentsDisclaimer';
import CreateOfferForm from './SubComponents/CreateOfferForm';
import OfferResourcesPanel from './SubComponents/OfferResourcesPanel';
import { BILLING_INTERVALS, billingIntervalName, billingIntervalSuffix, normalizeBillingInterval } from '@lib/payments/billingInterval';

const buildEditValidationSchema = (t: (key: string) => string) => Yup.object().shape({
  name: Yup.string().required(t('dash.payments.validation_name_required')),
  description: Yup.string().required(t('dash.payments.validation_description_required')),
  amount: Yup.number().min(0, t('dash.payments.validation_amount_positive')).required(t('dash.payments.validation_amount_required')),
  benefits: Yup.string(),
  currency: Yup.string().required(t('dash.payments.validation_currency_required')),
  offer_type: Yup.string().oneOf(['one_time', 'subscription']).required(t('dash.payments.validation_offer_type_required')),
  price_type: Yup.string().oneOf(['fixed_price', 'customer_choice']).required(t('dash.payments.validation_price_type_required')),
  billing_interval: Yup.string().oneOf(BILLING_INTERVALS).required(t('dash.payments.validation_billing_period_required')),
});

function PaymentsOffersPage() {
  const { t } = useTranslation();
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [expandedOffers, setExpandedOffers] = useState<{ [key: string]: boolean }>({});
  const [resourcesPanelOffer, setResourcesPanelOffer] = useState<any>(null);
  const { isEnabled, isLoading } = usePaymentsEnabled();

  const { data: offers, error } = useQuery({
    queryKey: queryKeys.payments.offers(org?.id),
    queryFn: () => getOffers(org.id, session.data?.tokens?.access_token),
    enabled: !!(org?.id && session?.data?.tokens?.access_token),
    staleTime: 60_000,
  });

  const handleArchiveOffer = async (offerId: string) => {
    const res = await archiveOffer(org.id, offerId, session.data?.tokens?.access_token);
    queryClient.invalidateQueries({ queryKey: queryKeys.payments.offers(org.id) });
    if (res.status === 200) {
      toast.success(t('dash.payments.offer_archived'));
    } else {
      toast.error(res.data?.detail || t('dash.payments.offer_archive_failed'));
    }
  };

  const toggleExpansion = (offerId: string) => {
    setExpandedOffers((prev) => ({ ...prev, [offerId]: !prev[offerId] }));
  };

  if (!isEnabled && !isLoading) {
    return <UnconfiguredPaymentsDisclaimer />;
  }

  if (error) return <div className="p-8 text-sm text-red-500">{t('dash.payments.offers_load_failed')}</div>;
  if (!offers) return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="ps-10 pe-10 mx-auto animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white p-4 rounded-lg nice-shadow space-y-3">
              <div className="h-5 bg-gray-200 rounded w-1/3" />
              <div className="h-6 bg-gray-200 rounded w-2/3" />
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="h-3 bg-gray-100 rounded w-4/5" />
              <div className="h-10 bg-gray-100 rounded w-full mt-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="ps-10 pe-10 mx-auto">
        <Modal
          isDialogOpen={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          dialogTitle={t('dash.payments.create_new_offer')}
          dialogDescription={t('dash.payments.create_offer_desc')}
          dialogContent={<CreateOfferForm onSuccess={() => setIsCreateModalOpen(false)} />}
        />

        {resourcesPanelOffer && (
          <Modal
            isDialogOpen={!!resourcesPanelOffer}
            onOpenChange={(open) => { if (!open) setResourcesPanelOffer(null); }}
            dialogTitle={t('dash.payments.resources_title', { name: resourcesPanelOffer.name })}
            dialogDescription={t('dash.payments.resources_desc')}
            dialogContent={
              <OfferResourcesPanel
                offerId={resourcesPanelOffer.id}
                offerName={resourcesPanelOffer.name}
              />
            }
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {offers.data.map((offer: any) => (
            <div key={offer.id} className="bg-white p-4 rounded-lg nice-shadow flex flex-col h-full">
              {editingOfferId === String(offer.id) ? (
                <EditOfferForm
                  offer={offer}
                  onSuccess={() => setEditingOfferId(null)}
                  onCancel={() => setEditingOfferId(null)}
                />
              ) : (
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col space-y-1 items-start">
                      <Badge className="w-fit flex items-center space-x-2" variant="outline">
                        {offer.offer_type === 'subscription' ? <RefreshCcw size={12} /> : <SquareCheck size={12} />}
                        <span className="text-sm">
                          {offer.offer_type === 'subscription' ? t('dash.payments.subscription_interval', { interval: billingIntervalName(offer.billing_interval) }) : t('dash.payments.one_time_payment')}
                        </span>
                      </Badge>
                      <h3 className="font-bold text-lg">{offer.name}</h3>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setEditingOfferId(String(offer.id))}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Pencil size={16} />
                      </button>
                      <ConfirmationModal
                        confirmationButtonText={t('dash.payments.archive_offer')}
                        confirmationMessage={t('dash.payments.archive_offer_confirm')}
                        dialogTitle={t('dash.payments.archive_offer_title', { name: offer.name })}
                        dialogTrigger={
                          <button className="text-red-500 hover:text-red-700">
                            <Archive size={16} />
                          </button>
                        }
                        functionToExecute={() => handleArchiveOffer(offer.id)}
                        status="warning"
                      />
                    </div>
                  </div>

                  <div className="grow overflow-hidden">
                    <div
                      className={`transition-all duration-300 ease-in-out ${
                        expandedOffers[offer.id] ? 'max-h-[1000px]' : 'max-h-24'
                      } overflow-hidden`}
                    >
                      <p className="text-gray-600">{offer.description}</p>
                      {offer.benefits && (
                        <div className="mt-2">
                          <h4 className="font-semibold text-sm">{t('dash.payments.benefits_label')}</h4>
                          <p className="text-sm text-gray-600">{offer.benefits}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2">
                    <button
                      onClick={() => toggleExpansion(String(offer.id))}
                      className="text-slate-500 hover:text-slate-700 text-sm flex items-center"
                    >
                      {expandedOffers[offer.id] ? (
                        <><ChevronUp size={16} /><span>{t('dash.payments.show_less')}</span></>
                      ) : (
                        <><ChevronDown size={16} /><span>{t('dash.payments.show_more')}</span></>
                      )}
                    </button>
                  </div>

                  {offer.payments_group_id && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-violet-600">
                      <Layers size={12} />
                      <span>{t('dash.payments.payment_group_number', { id: offer.payments_group_id })}</span>
                    </div>
                  )}

                  <div className="mt-2">
                    <button
                      onClick={() => setResourcesPanelOffer(offer)}
                      className="text-sm flex items-center space-x-1 text-indigo-600 hover:text-indigo-800"
                    >
                      <Users size={14} />
                      <span>{t('dash.payments.manage_resources')}</span>
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between bg-gray-100 rounded-md p-2">
                    <span className="text-sm text-gray-600">{t('dash.payments.price_label')}</span>
                    <span className="font-semibold text-lg">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: offer.currency,
                      }).format(offer.amount)}
                      {offer.offer_type === 'subscription' && (
                        <span className="text-sm font-normal text-gray-500"> {billingIntervalSuffix(offer.billing_interval)}</span>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {offers.data.length === 0 && (
          <div className="flex mx-auto space-x-2 font-semibold mt-3 text-gray-600 items-center">
            <Info size={20} />
            <p>{t('dash.payments.no_offers_available')}</p>
          </div>
        )}

        <div className="flex justify-center items-center py-10">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mb-4 flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-linear-to-bl text-white font-medium from-gray-700 to-gray-900 border border-gray-600 shadow-gray-900/20 nice-shadow transition duration-300 hover:from-gray-600 hover:to-gray-800"
          >
            <Plus size={18} />
            <span className="text-sm font-bold">{t('dash.payments.create_new_offer')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const EditOfferForm = ({
  offer,
  onSuccess,
  onCancel,
}: {
  offer: any;
  onSuccess: () => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation();
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const queryClient = useQueryClient();
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const editValidationSchema = buildEditValidationSchema(t);

  useEffect(() => {
    const allCurrencies = currencyCodes.data.map((c) => ({
      code: c.code,
      name: `${c.code} - ${c.currency}`,
    }));
    setCurrencies(allCurrencies);
  }, []);

  const initialValues = {
    name: offer.name,
    description: offer.description,
    amount: offer.amount,
    benefits: offer.benefits || '',
    currency: offer.currency || 'USD',
    offer_type: offer.offer_type as 'one_time' | 'subscription',
    price_type: (offer.price_type || 'fixed_price') as 'fixed_price' | 'customer_choice',
    billing_interval: normalizeBillingInterval(offer.billing_interval),
  };

  const handleSubmit = async (
    values: typeof initialValues,
    { setSubmitting }: { setSubmitting: (b: boolean) => void }
  ) => {
    try {
      const res = await updateOffer(org.id, offer.id, values, session.data?.tokens?.access_token);
      if (!res?.success) {
        toast.error(res?.data?.detail || t('dash.payments.offer_update_failed'));
        return;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.offers(org.id) });
      onSuccess();
      toast.success(t('dash.payments.offer_updated'));
    } catch {
      toast.error(t('dash.payments.offer_update_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Formik initialValues={initialValues} validationSchema={editValidationSchema} onSubmit={handleSubmit}>
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
                  // subscriptions can't have customer_choice pricing
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
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onCancel}>{t('dash.payments.cancel')}</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('dash.payments.saving') : t('dash.payments.save')}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default PaymentsOffersPage;
