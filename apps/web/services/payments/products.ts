import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, getResponseMetadata } from '@services/utils/ts/requests';

export async function getProducts(orgId: number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/products`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function createProduct(orgId: number, data: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/products`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function updateProduct(orgId: number, productId: string, data: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/products/${productId}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function deleteProduct(orgId: number, productId: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/products/${productId}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function getProductDetails(orgId: number, productId: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}payments/${orgId}/products/${productId}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}



