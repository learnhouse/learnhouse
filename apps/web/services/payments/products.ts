'use server';
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

export async function getProducts(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function createProduct(orgId: number, data: any, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function updateProduct(orgId: number, productId: string, data: any, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products/${encodeURIComponent(productId)}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function archiveProduct(orgId: number, productId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products/${encodeURIComponent(productId)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function getProductDetails(orgId: number, productId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products/${encodeURIComponent(productId)}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function linkCourseToProduct(orgId: number, productId: string, courseId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products/${encodeURIComponent(productId)}/courses/${encodeURIComponent(courseId)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function unlinkCourseFromProduct(orgId: number, productId: string, courseId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products/${encodeURIComponent(productId)}/courses/${encodeURIComponent(courseId)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function getCoursesLinkedToProduct(orgId: number, productId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/products/${encodeURIComponent(productId)}/courses`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function getProductsByCourse(orgId: number, courseId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/courses/${encodeURIComponent(courseId)}/products`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

export async function getStripeProductCheckoutSession(orgId: number, productId: number, redirect_uri: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/stripe/checkout/product/${encodeURIComponent(String(productId))}?redirect_uri=${encodeURIComponent(redirect_uri)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  const res = await getResponseMetadata(result);
  return res;
}

