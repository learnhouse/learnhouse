'use client';
import React, { useState, useEffect } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { SiStripe } from '@icons-pack/react-simple-icons'
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getPaymentConfigs, createPaymentConfig, updatePaymentConfig, deletePaymentConfig } from '@services/payments/payments';
import FormLayout, { ButtonBlack, Input, Textarea, FormField, FormLabelAndMessage, Flex } from '@components/StyledElements/Form/Form';
import { Check, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr';
import Modal from '@components/StyledElements/Modal/Modal';
import ConfirmationModal from '@components/StyledElements/ConfirmationModal/ConfirmationModal';
import { Button } from '@components/ui/button';

const PaymentsConfigurationPage: React.FC = () => {
    const org = useOrg() as any;
    const session = useLHSession() as any;
    const access_token = session?.data?.tokens?.access_token;
    const { data: paymentConfigs, error, isLoading } = useSWR(
        () => (org && access_token ? [`/payments/${org.id}/config`, access_token] : null),
        ([url, token]) => getPaymentConfigs(org.id, token)
    );

    const stripeConfig = paymentConfigs?.find((config: any) => config.provider === 'stripe');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const enableStripe = async () => {
        try {
            const newConfig = { provider: 'stripe', enabled: true };
            const config = await createPaymentConfig(org.id, newConfig, access_token);
            toast.success('Stripe enabled successfully');
            mutate([`/payments/${org.id}/config`, access_token]);
        } catch (error) {
            console.error('Error enabling Stripe:', error);
            toast.error('Failed to enable Stripe');
        }
    };

    const editConfig = async () => {
        setIsModalOpen(true);
    };

    const deleteConfig = async () => {
        try {
            await deletePaymentConfig(org.id, stripeConfig.id, access_token);
            toast.success('Stripe configuration deleted successfully');
            mutate([`/payments/${org.id}/config`, access_token]);
        } catch (error) {
            console.error('Error deleting Stripe configuration:', error);
            toast.error('Failed to delete Stripe configuration');
        }
    };

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error loading payment configuration</div>;
    }

    return (
        <div>
            <div className="ml-10 mr-10 mx-auto bg-white rounded-xl shadow-sm px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-3">
                    <h1 className="font-bold text-xl text-gray-800">Payments Configuration</h1>
                    <h2 className="text-gray-500 text-md">Manage your organization payments configuration</h2>
                </div>
                <div className="flex flex-col  rounded-lg light-shadow">
                    {stripeConfig ? (
                        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-500 to-purple-600 p-6 rounded-lg shadow-md">
                            <div className="flex items-center space-x-3">
                                <SiStripe className="text-white" size={32} />
                                <span className="text-xl font-semibold text-white">Stripe is enabled</span>
                            </div>
                            <div className="flex space-x-2">
                                <Button 
                                    onClick={editConfig} 
                                    className="flex items-center space-x-2 px-4 py-2 bg-white text-purple-700 text-sm rounded-full hover:bg-gray-100 transition duration-300"
                                >
                                    <Edit size={16} />
                                    <span>Edit Configuration</span>
                                </Button>
                                <ConfirmationModal
                                    confirmationButtonText="Delete Configuration"
                                    confirmationMessage="Are you sure you want to delete the Stripe configuration? This action cannot be undone."
                                    dialogTitle="Delete Stripe Configuration"
                                    dialogTrigger={
                                        <Button className="flex items-center space-x-2 bg-red-500 text-white text-sm rounded-full hover:bg-red-600 transition duration-300">
                                            <Trash2 size={16} />
                                            <span>Delete Configuration</span>
                                        </Button>
                                    }
                                    functionToExecute={deleteConfig}
                                    status="warning"
                                />
                            </div>
                        </div>
                    ) : (
                        <Button 
                            onClick={enableStripe} 
                            className="flex items-center justify-center space-x-2 bg-gradient-to-r p-3 from-indigo-500 to-purple-600 text-white px-6  rounded-lg hover:from-indigo-600 hover:to-purple-700 transition duration-300 shadow-md"
                        >
                            <SiStripe size={24} />
                            <span className="text-lg font-semibold">Enable Stripe</span>
                        </Button>
                    )}
                </div>
            </div>
            {stripeConfig && (
                <EditStripeConfigModal
                    orgId={org.id}
                    configId={stripeConfig.id}
                    accessToken={access_token}
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                />
            )}
        </div>
    );
};

interface EditStripeConfigModalProps {
    orgId: number;
    configId: string;
    accessToken: string;
    isOpen: boolean;
    onClose: () => void;
}

const EditStripeConfigModal: React.FC<EditStripeConfigModalProps> = ({ orgId, configId, accessToken, isOpen, onClose }) => {
    const [stripePublishableKey, setStripePublishableKey] = useState('');
    const [stripeSecretKey, setStripeSecretKey] = useState('');
    const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');

    // Add this useEffect hook to fetch and set the existing configuration
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const config = await getPaymentConfigs(orgId, accessToken);
                const stripeConfig = config.find((c: any) => c.id === configId);
                if (stripeConfig && stripeConfig.provider_config) {
                    setStripePublishableKey(stripeConfig.provider_config.stripe_publishable_key || '');
                    setStripeSecretKey(stripeConfig.provider_config.stripe_secret_key || '');
                    setStripeWebhookSecret(stripeConfig.provider_config.stripe_webhook_secret || '');
                }
            } catch (error) {
                console.error('Error fetching Stripe configuration:', error);
                toast.error('Failed to load existing configuration');
            }
        };

        if (isOpen) {
            fetchConfig();
        }
    }, [isOpen, orgId, configId, accessToken]);

    const handleSubmit = async () => {
        try {
            const stripe_config = {
                stripe_publishable_key: stripePublishableKey,
                stripe_secret_key: stripeSecretKey,
                stripe_webhook_secret: stripeWebhookSecret,
            };
            const updatedConfig = {
                provider_config: stripe_config,
            };
            await updatePaymentConfig(orgId, configId, updatedConfig, accessToken);
            toast.success('Configuration updated successfully');
            mutate([`/payments/${orgId}/config`, accessToken]);
            onClose();
        } catch (error) {
            console.error('Error updating config:', error);
            toast.error('Failed to update configuration');
        }
    };

    return (
        <Modal isDialogOpen={isOpen} dialogTitle="Edit Stripe Configuration" dialogDescription='Edit your stripe configuration' onOpenChange={onClose}
            dialogContent={
                <FormLayout onSubmit={handleSubmit}>
                    <FormField name="stripe-key">
                        <FormLabelAndMessage label="Stripe Publishable Key" />
                        <Input 
                            type="text" 
                            value={stripePublishableKey} 
                            onChange={(e) => setStripePublishableKey(e.target.value)} 
                            placeholder="pk_test_..."
                        />
                    </FormField>
                    <FormField name="stripe-secret-key">
                        <FormLabelAndMessage label="Stripe Secret Key" />
                        <Input 
                            type="password" 
                            value={stripeSecretKey} 
                            onChange={(e) => setStripeSecretKey(e.target.value)} 
                            placeholder="sk_test_..."
                        />
                    </FormField>
                    <FormField name="stripe-webhook-secret">
                        <FormLabelAndMessage label="Stripe Webhook Secret" />
                        <Input 
                            type="password" 
                            value={stripeWebhookSecret} 
                            onChange={(e) => setStripeWebhookSecret(e.target.value)} 
                            placeholder="whsec_..."
                        />
                    </FormField>
                    <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
                        <ButtonBlack type="submit" className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition duration-300">
                            Save
                        </ButtonBlack>
                    </Flex>
                </FormLayout>
            }
        />
    );
};

export default PaymentsConfigurationPage;
