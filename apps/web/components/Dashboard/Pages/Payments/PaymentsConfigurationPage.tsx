'use client';
import React, { useState, useEffect } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { SiStripe } from '@icons-pack/react-simple-icons'
import { useLHSession } from '@components/Contexts/LHSessionContext';
import { getPaymentConfigs, initializePaymentConfig, updatePaymentConfig, deletePaymentConfig, updateStripeAccountID, getStripeOnboardingLink } from '@services/payments/payments';
import FormLayout, { ButtonBlack, Input, Textarea, FormField, FormLabelAndMessage, Flex } from '@components/Objects/StyledElements/Form/Form';
import { AlertTriangle, BarChart2, Check, Coins, CreditCard, Edit, ExternalLink, Info, Loader2, RefreshCcw, Trash2, UnplugIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr';
import Modal from '@components/Objects/StyledElements/Modal/Modal';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import { Button } from '@components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert';
import { useRouter } from 'next/navigation';
import { getUriWithoutOrg } from '@services/config/config';

const PaymentsConfigurationPage: React.FC = () => {
    const org = useOrg() as any;
    const session = useLHSession() as any;
    const router = useRouter();
    const access_token = session?.data?.tokens?.access_token;
    const { data: paymentConfigs, error, isLoading } = useSWR(
        () => (org && access_token ? [`/payments/${org.id}/config`, access_token] : null),
        ([url, token]) => getPaymentConfigs(org.id, token)
    );

    const stripeConfig = paymentConfigs?.find((config: any) => config.provider === 'stripe');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isOnboarding, setIsOnboarding] = useState(false);
    const [isOnboardingLoading, setIsOnboardingLoading] = useState(false);

    const enableStripe = async () => {
        try {
            setIsOnboarding(true);
            const newConfig = { provider: 'stripe', enabled: true };
            const config = await initializePaymentConfig(org.id, newConfig, 'stripe', access_token);
            toast.success('Stripe enabled successfully');
            mutate([`/payments/${org.id}/config`, access_token]);
        } catch (error) {
            console.error('Error enabling Stripe:', error);
            toast.error('Failed to enable Stripe');
        } finally {
            setIsOnboarding(false);
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

    const handleStripeOnboarding = async () => {
        try {
            setIsOnboardingLoading(true);
            const { connect_url } = await getStripeOnboardingLink(org.id, access_token, getUriWithoutOrg('/payments/stripe/connect/oauth'));
            window.open(connect_url, '_blank');
        } catch (error) {
            console.error('Error getting onboarding link:', error);
            toast.error('Failed to start Stripe onboarding');
        } finally {
            setIsOnboardingLoading(false);
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
            <div className="ml-10 mr-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
                <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-3">
                    <h1 className="font-bold text-xl text-gray-800">Payments Configuration</h1>
                    <h2 className="text-gray-500 text-md">Manage your organization payments configuration</h2>
                </div>

                <Alert className="mb-3 p-6 border-2 border-blue-100 bg-blue-50/50">
                   
                    <AlertTitle className="text-lg font-semibold mb-2 flex items-center space-x-2"> <Info className="h-5 w-5 " /> <span>About the Stripe Integration</span></AlertTitle>
                    <AlertDescription className="space-y-5">
                        <div className="pl-2">
                            <ul className="list-disc list-inside space-y-1 text-gray-600 pl-2">
                                <li className="flex items-center space-x-2">
                                    <CreditCard className="h-4 w-4" />
                                    <span>Accept payments for courses and subscriptions</span>
                                </li>
                                <li className="flex items-center space-x-2">
                                    <RefreshCcw className="h-4 w-4" />
                                    <span>Manage recurring billing and subscriptions</span>
                                </li>
                                <li className="flex items-center space-x-2">
                                    <Coins className="h-4 w-4" />
                                    <span>Handle multiple currencies and payment methods</span>
                                </li>
                                <li className="flex items-center space-x-2">
                                    <BarChart2 className="h-4 w-4" />
                                    <span>Access detailed payment analytics</span>
                                </li>
                            </ul>
                        </div>
                        <a 
                            href="https://stripe.com/docs"
                            target="_blank"
                            rel="noopener noreferrer" 
                            className="text-blue-600 hover:text-blue-800 inline-flex items-center font-medium transition-colors duration-200 pl-2"
                        >
                            Learn more about Stripe
                            <ExternalLink className="ml-1.5 h-4 w-4" />
                        </a>
                    </AlertDescription>
                </Alert>

                <div className="flex flex-col rounded-lg light-shadow">
                    {stripeConfig ? (
                        <div className="flex items-center justify-between bg-linear-to-r from-indigo-500 to-purple-600 p-6 rounded-lg shadow-md">
                            <div className="flex items-center space-x-3">
                                <SiStripe className="text-white" size={32} />
                                <div className="flex flex-col">
                                    <div className="flex items-center space-x-2">
                                        <span className="text-xl font-semibold text-white">Stripe</span>
                                        {stripeConfig.provider_specific_id && stripeConfig.active ? (
                                            <div className="flex items-center space-x-1 bg-green-500/20 px-2 py-0.5 rounded-full">
                                                <div className="h-2 w-2 bg-green-500 rounded-full" />
                                                <span className="text-xs text-green-100">Connected</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center space-x-1 bg-red-500/20 px-2 py-0.5 rounded-full">
                                                <div className="h-2 w-2 bg-red-500 rounded-full" />
                                                <span className="text-xs text-red-100">Not Connected</span>
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-white/80 text-sm">
                                        {stripeConfig.provider_specific_id ? 
                                            `Linked Account: ${stripeConfig.provider_specific_id}` : 
                                            'Account ID not configured'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex space-x-2">
                                {(!stripeConfig.provider_specific_id || !stripeConfig.active) && (
                                    <Button
                                        onClick={handleStripeOnboarding}
                                        className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white text-sm rounded-full hover:bg-green-600 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-green-400 shadow-md"
                                        disabled={isOnboardingLoading}
                                    >
                                        {isOnboardingLoading ? (
                                            <Loader2 className="animate-spin h-4 w-4" />
                                        ) : (
                                            <UnplugIcon className="h-3 w-3" />
                                        )}
                                        <span className="font-semibold">Connect with Stripe</span>
                                    </Button>
                                )}
                                <ConfirmationModal
                                    confirmationButtonText="Remove Connection"
                                    confirmationMessage="Are you sure you want to remove the Stripe connection? This action cannot be undone."
                                    dialogTitle="Remove Stripe Connection"
                                    dialogTrigger={
                                        <Button 
                                            className="flex items-center space-x-2 bg-red-500 text-white text-sm rounded-full hover:bg-red-600 transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Trash2 size={16} />
                                            <span>Remove Connection</span>
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
                            className="flex items-center justify-center space-x-2 bg-linear-to-r p-3 from-indigo-500 to-purple-600 text-white px-6 rounded-lg hover:from-indigo-600 hover:to-purple-700 transition duration-300 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isOnboarding}
                        >
                            {isOnboarding ? (
                                <>
                                    <Loader2 className="animate-spin" size={24} />
                                    <span className="text-lg font-semibold">Connecting to Stripe...</span>
                                </>
                            ) : (
                                <>
                                    <SiStripe size={24} />
                                    <span className="text-lg font-semibold">Enable Stripe</span>
                                </>
                            )}
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
    const [stripeAccountId, setStripeAccountId] = useState('');

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const config = await getPaymentConfigs(orgId, accessToken);
                const stripeConfig = config.find((c: any) => c.id === configId);
                if (stripeConfig && stripeConfig.provider_specific_id) {
                    setStripeAccountId(stripeConfig.provider_specific_id || '');
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
                stripe_account_id: stripeAccountId,
            };
            await updateStripeAccountID(orgId, stripe_config, accessToken);
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
                    <FormField name="stripe-account-id">
                        <FormLabelAndMessage label="Stripe Account ID" />
                        <Input 
                            type="text" 
                            value={stripeAccountId} 
                            onChange={(e) => setStripeAccountId(e.target.value)} 
                            placeholder="acct_..."
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
