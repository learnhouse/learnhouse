import React, { useState } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { SiStripe } from '@icons-pack/react-simple-icons'
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getPaymentConfigs, createPaymentConfig, updatePaymentConfig } from '@services/payments/payments';
import FormLayout, { ButtonBlack, Input, Textarea, FormField, FormLabelAndMessage, Flex } from '@components/StyledElements/Form/Form';
import { Check, Edit } from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr';
import Modal from '@components/StyledElements/Modal/Modal';

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
                <div className="flex flex-col py-4 px-6  rounded-lg light-shadow">
                    {stripeConfig ? (
                        <div className="flex items-center justify-between bg-white ">
                            <div className="flex items-center space-x-3">
                                <Check className="text-green-500" size={24} />
                                <span className="text-lg font-semibold">Stripe is enabled</span>
                            </div>
                            <ButtonBlack onClick={editConfig} className="flex items-center space-x-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition duration-300">
                                <Edit size={16} />
                                <span>Edit Configuration</span>
                            </ButtonBlack>
                        </div>
                    ) : (
                        <ButtonBlack onClick={enableStripe} className="flex items-center space-x-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition duration-300">
                            <SiStripe size={16} />
                            <span>Enable Stripe</span>
                        </ButtonBlack>
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
    const [stripeKey, setStripeKey] = useState('');
    const [stripeSecretKey, setStripeSecretKey] = useState('');
    const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');

    const handleSubmit = async () => {
        try {
            const stripe_config = {
                stripe_key: stripeKey,
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
                        <FormLabelAndMessage label="Stripe Key" />
                        <Input type="password" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} />
                    </FormField>
                    <FormField name="stripe-secret-key">
                        <FormLabelAndMessage label="Stripe Secret Key" />
                        <Input type="password" value={stripeSecretKey} onChange={(e) => setStripeSecretKey(e.target.value)} />
                    </FormField>
                    <FormField name="stripe-webhook-secret">
                        <FormLabelAndMessage label="Stripe Webhook Secret" />
                        <Input type="password" value={stripeWebhookSecret} onChange={(e) => setStripeWebhookSecret(e.target.value)} />
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
