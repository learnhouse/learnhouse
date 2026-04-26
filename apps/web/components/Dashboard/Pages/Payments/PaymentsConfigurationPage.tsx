'use client';
import React, { useState, useEffect } from 'react';
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import {
  getPaymentConfigs,
  initializePaymentConfig,
  deletePaymentConfig,
} from '@services/payments/payments';
import { getStripeOnboardingLink } from '@services/payments/providers/stripe';
import {
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Trash2,
  UnplugIcon,
  XCircle,
  AlertTriangle,
  CreditCard,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR, { mutate } from 'swr';
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal';
import { Button } from '@components/ui/button';
import { getMainDomainUri } from '@services/config/config';
import { SiStripe } from '@icons-pack/react-simple-icons';
import MoyasarKeysModal from './MoyasarKeysModal';

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
interface PaymentProviderDef {
  id: string;
  name: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  tagline: string;
  docsUrl: string;
  // 'oauth' providers redirect the browser to a hosted authorize page.
  // 'keys'  providers collect API keys directly via an in-app modal.
  connectMode: 'oauth' | 'keys';
  // Only used when connectMode === 'oauth'
  callbackPath?: string;
  getConnectUrl?: (orgId: number, accessToken: string, redirectUri: string) => Promise<string>;
}

const PAYMENT_PROVIDERS: PaymentProviderDef[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    Icon: SiStripe,
    tagline: 'Accept one-time payments and subscriptions via Stripe Connect.',
    docsUrl: 'https://stripe.com/docs',
    connectMode: 'oauth',
    callbackPath: '/payments/stripe/connect/oauth',
    async getConnectUrl(orgId, accessToken, redirectUri) {
      const { connect_url } = await getStripeOnboardingLink(orgId, accessToken, redirectUri);
      return connect_url;
    },
  },
  {
    id: 'moyasar',
    name: 'Moyasar',
    Icon: CreditCard,
    tagline: 'Accept payments from Saudi cards, mada, Apple Pay, STC Pay, and SADAD.',
    docsUrl: 'https://docs.moyasar.com',
    connectMode: 'keys',
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const PaymentsConfigurationPage: React.FC = () => {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  const { data: paymentConfigs, error, isLoading } = useSWR(
    () => (org && access_token ? [`/payments/${org.id}/config`, access_token] : null),
    ([, token]) => getPaymentConfigs(org.id, token),
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'payment_provider_connected') {
        mutate([`/payments/${org?.id}/config`, access_token]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [org?.id, access_token]);

  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading...</div>;
  if (error) return <div className="p-6 text-sm text-red-500">Error loading payment configuration</div>;

  const configs: any[] = Array.isArray(paymentConfigs) ? paymentConfigs : [];

  return (
    <div className="ml-10 mr-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
      <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 rounded-md mb-4">
        <h1 className="font-bold text-xl text-gray-800">Payments Configuration</h1>
        <h2 className="text-gray-500 text-sm">
          Connect a payment provider to accept payments from your learners.
        </h2>
      </div>

      <div className="space-y-3">
        {PAYMENT_PROVIDERS.map((provider) => {
          const config = configs.find((c: any) => c.provider === provider.id);
          return (
            <ProviderCard
              key={provider.id}
              provider={provider}
              config={config}
              orgId={org.id}
              accessToken={access_token}
            />
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ProviderCard
// ---------------------------------------------------------------------------
interface ProviderCardProps {
  provider: PaymentProviderDef;
  config: any | undefined;
  orgId: number;
  accessToken: string;
}

const ProviderCard: React.FC<ProviderCardProps> = ({ provider, config, orgId, accessToken }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<{ count: number } | null>(null);
  const [keysModalOpen, setKeysModalOpen] = useState(false);
  // OAuth providers report connection via a persisted provider_specific_id (e.g. Stripe acct_...).
  // Key-based providers (Moyasar) have no such ID; connectedness is simply config.active.
  const isConnected =
    provider.connectMode === 'keys'
      ? !!config?.active
      : !!(config?.provider_specific_id && config?.active);

  const handleConnect = async () => {
    if (provider.connectMode === 'keys') {
      setKeysModalOpen(true);
      return;
    }
    try {
      setIsConnecting(true);
      if (!config) {
        await initializePaymentConfig(orgId, { provider: provider.id, enabled: true }, provider.id, accessToken);
        await mutate([`/payments/${orgId}/config`, accessToken]);
      }
      const redirectUri = getMainDomainUri(provider.callbackPath ?? '/');
      const url = await provider.getConnectUrl!(orgId, accessToken, redirectUri);
      window.open(url, '_blank');
    } catch {
      toast.error(`Failed to connect ${provider.name}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDelete = async () => {
    setDisconnectError(null);
    try {
      await deletePaymentConfig(orgId, config.id, accessToken);
      toast.success(`${provider.name} connection removed`);
      mutate([`/payments/${orgId}/config`, accessToken]);
    } catch (err: any) {
      if (err?.status === 409 || err?.response?.status === 409) {
        let detail: any = err?.detail ?? err?.response?.data?.detail;
        try { detail = JSON.parse(detail); } catch {}
        if (detail?.code === 'ACTIVE_SUBSCRIPTIONS_EXIST') {
          setDisconnectError({ count: detail.count });
          return;
        }
      }
      toast.error(`Failed to remove ${provider.name} connection`);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Main row */}
      <div className="flex items-center justify-between px-5 py-4 bg-white">
        <div className="flex items-center space-x-4">
          <div className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-lg shrink-0">
            <provider.Icon size={22} className="text-gray-700" />
          </div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
              <span className="font-semibold text-gray-900">{provider.name}</span>
              {config ? (
                isConnected ? (
                  <span className="inline-flex items-center space-x-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                    <CheckCircle2 size={10} />
                    <span>Connected</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    <XCircle size={10} />
                    <span>Authorization required</span>
                  </span>
                )
              ) : (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  Not configured
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{provider.tagline}</p>
            {isConnected && (
              <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-xs">
                {config.provider_specific_id}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2 shrink-0">
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 transition p-1"
            title={`${provider.name} docs`}
          >
            <ExternalLink size={15} />
          </a>

          {isConnected ? (
            <>
              <Button
                onClick={handleConnect}
                disabled={isConnecting}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                {isConnecting ? (
                  <Loader2 size={12} className="animate-spin mr-1" />
                ) : (
                  <UnplugIcon size={12} className="mr-1" />
                )}
                Reconnect
              </Button>
              <ConfirmationModal
                confirmationButtonText="Remove"
                confirmationMessage={`Remove the ${provider.name} connection? This will disable payments for this organization.`}
                dialogTitle={`Remove ${provider.name} Connection`}
                dialogTrigger={
                  <Button variant="destructive" size="sm" className="text-xs">
                    <Trash2 size={12} className="mr-1" />
                    Remove
                  </Button>
                }
                functionToExecute={handleDelete}
                status="warning"
              />
            </>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              size="sm"
              className="text-xs bg-gray-900 text-white hover:bg-gray-800"
            >
              {isConnecting ? (
                <Loader2 size={12} className="animate-spin mr-1" />
              ) : (
                <UnplugIcon size={12} className="mr-1" />
              )}
              {config ? 'Complete Setup' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {/* Active subscription disconnect error */}
      {disconnectError && (
        <div className="bg-red-50 border-t border-red-100 px-5 py-3 text-sm text-red-700">
          <div className="flex items-start space-x-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <p>
              You have <strong>{disconnectError.count} active subscriber{disconnectError.count !== 1 ? 's' : ''}</strong>.
              Cancel all subscriptions first via your {provider.name} dashboard before removing.
            </p>
          </div>
        </div>
      )}

      {/* Warning strip when OAuth config exists but authorization not completed.
          Skipped for 'keys' providers (Moyasar) — their verify step either fully succeeds or fully fails. */}
      {provider.connectMode === 'oauth' && config && !isConnected && !disconnectError && (
        <div className="bg-amber-50 border-t border-amber-100 px-5 py-2 text-xs text-amber-700 flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <Info size={12} className="shrink-0" />
            <span>
              Configuration started but OAuth authorization is not complete. Click{' '}
              <strong>Complete Setup</strong> to finish connecting.
            </span>
          </div>
          <ConfirmationModal
            confirmationButtonText="Start Over"
            confirmationMessage={`This will delete the current ${provider.name} configuration so you can start fresh.`}
            dialogTitle="Start Over?"
            dialogTrigger={
              <button className="ml-4 shrink-0 underline hover:text-amber-900 transition-colors cursor-pointer">
                Start over
              </button>
            }
            functionToExecute={handleDelete}
            status="warning"
          />
        </div>
      )}

      {keysModalOpen && provider.id === 'moyasar' && (
        <MoyasarKeysModal
          orgId={orgId}
          accessToken={accessToken}
          onClose={() => setKeysModalOpen(false)}
          onSuccess={() => {
            setKeysModalOpen(false);
            mutate([`/payments/${orgId}/config`, accessToken]);
          }}
        />
      )}
    </div>
  );
};

export default PaymentsConfigurationPage;
