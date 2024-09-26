import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests';

export async function getPaymentConfigs(orgId: number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/config`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

export async function createPaymentConfig(orgId: number, data: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/config`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

export async function updatePaymentConfig(orgId: number, id: string, data: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/config`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

export async function deletePaymentConfig(orgId: number, id: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/config/${id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}
