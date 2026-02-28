'use client';
import React, { useState, useEffect } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import useSWR, { mutate } from 'swr';
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

const editValidationSchema = Yup.object().shape({
  name: Yup.string().required('Name is required'),
  description: Yup.string().required('Description is required'),
  amount: Yup.number().min(0, 'Amount must be positive').required('Amount is required'),
  benefits: Yup.string(),
  currency: Yup.string().required('Currency is required'),
  offer_type: Yup.string().oneOf(['one_time', 'subscription']).required('Offer type is required'),
  price_type: Yup.string().oneOf(['fixed_price', 'customer_choice']).required('Price type is required'),
});

function PaymentsOffersPage() {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [expandedOffers, setExpandedOffers] = useState<{ [key: string]: boolean }>({});
  const [resourcesPanelOffer, setResourcesPanelOffer] = useState<any>(null);
  const { isEnabled, isLoading } = usePaymentsEnabled();

  const { data: offers, error } = useSWR(
    () => org && session ? [`/payments/${org.id}/offers`, session.data?.tokens?.access_token] : null,
    ([, token]) => getOffers(org.id, token)
  );

  const handleArchiveOffer = async (offerId: string) => {
    const res = await archiveOffer(org.id, offerId, session.data?.tokens?.access_token);
    mutate([`/payments/${org.id}/offers`, session.data?.tokens?.access_token]);
    if (res.status === 200) {
      toast.success('Offer archived successfully');
    } else {
      toast.error(res.data?.detail || 'Failed to archive offer');
    }
  };

  const toggleExpansion = (offerId: string) => {
    setExpandedOffers((prev) => ({ ...prev, [offerId]: !prev[offerId] }));
  };

  if (!isEnabled && !isLoading) {
    return <UnconfiguredPaymentsDisclaimer />;
  }

  if (error) return <div>Failed to load offers</div>;
  if (!offers) return <div>Loading…</div>;

  return (
    <div className="h-full w-full bg-[#f8f8f8]">
      <div className="pl-10 pr-10 mx-auto">
        <Modal
          isDialogOpen={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          dialogTitle="Create New Offer"
          dialogDescription="Add a new offer linked to a UserGroup"
          dialogContent={<CreateOfferForm onSuccess={() => setIsCreateModalOpen(false)} />}
        />

        {resourcesPanelOffer && (
          <Modal
            isDialogOpen={!!resourcesPanelOffer}
            onOpenChange={(open) => { if (!open) setResourcesPanelOffer(null); }}
            dialogTitle={`Resources — ${resourcesPanelOffer.name}`}
            dialogDescription="Resources accessible to enrolled users"
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
                          {offer.offer_type === 'subscription' ? 'Subscription' : 'One-time payment'}
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
                        confirmationButtonText="Archive Offer"
                        confirmationMessage="Are you sure you want to archive this offer?"
                        dialogTitle={`Archive ${offer.name}?`}
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
                          <h4 className="font-semibold text-sm">Benefits:</h4>
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
                        <><ChevronUp size={16} /><span>Show less</span></>
                      ) : (
                        <><ChevronDown size={16} /><span>Show more</span></>
                      )}
                    </button>
                  </div>

                  {offer.payments_group_id && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-violet-600">
                      <Layers size={12} />
                      <span>Payment Group #{offer.payments_group_id}</span>
                    </div>
                  )}

                  <div className="mt-2">
                    <button
                      onClick={() => setResourcesPanelOffer(offer)}
                      className="text-sm flex items-center space-x-1 text-indigo-600 hover:text-indigo-800"
                    >
                      <Users size={14} />
                      <span>Manage Resources</span>
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between bg-gray-100 rounded-md p-2">
                    <span className="text-sm text-gray-600">Price:</span>
                    <span className="font-semibold text-lg">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: offer.currency,
                      }).format(offer.amount)}
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
            <p>No offers available. Create a new offer to get started.</p>
          </div>
        )}

        <div className="flex justify-center items-center py-10">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mb-4 flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-linear-to-bl text-white font-medium from-gray-700 to-gray-900 border border-gray-600 shadow-gray-900/20 nice-shadow transition duration-300 hover:from-gray-600 hover:to-gray-800"
          >
            <Plus size={18} />
            <span className="text-sm font-bold">Create New Offer</span>
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
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);

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
  };

  const handleSubmit = async (
    values: typeof initialValues,
    { setSubmitting }: { setSubmitting: (b: boolean) => void }
  ) => {
    try {
      await updateOffer(org.id, offer.id, values, session.data?.tokens?.access_token);
      mutate([`/payments/${org.id}/offers`, session.data?.tokens?.access_token]);
      onSuccess();
      toast.success('Offer updated successfully');
    } catch {
      toast.error('Failed to update offer');
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
                  // subscriptions can't have customer_choice pricing
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
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default PaymentsOffersPage;
