// hooks/usePaymentsEnabled.ts
import { useOrg } from '@components/Contexts/OrgContext';
import { useLHSession } from '@components/Contexts/LHSessionContext';
import useSWR from 'swr';
import { getPaymentConfigs } from '@services/payments/payments';

export function usePaymentsEnabled() {
  const org = useOrg() as any;
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  const { data: paymentConfigs, error, isLoading } = useSWR(
    org && access_token ? [`/payments/${org.id}/config`, access_token] : null,
    ([url, token]) => getPaymentConfigs(org.id, token)
  );

  const isStripeEnabled = paymentConfigs?.some(
    (config: any) => config.provider === 'stripe' && config.active
  );

  return {
    isEnabled: !!isStripeEnabled,
    isLoading,
    error
  };
}