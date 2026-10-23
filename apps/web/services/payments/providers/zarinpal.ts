'use server';
// ZarinPal payment provider service.
// Each payment provider gets its own file here. The generic payment config and
// offer services live in payments.ts / offers.ts.
//
// Backend routes live under /api/v1/payments/zarinpal/... (see
// apps/api/src/routers/payments/zarinpal.py).
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, errorHandling, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

/**
 * Whether this LearnHouse instance has the ZarinPal gateway configured.
 * Public probe; does not reveal any credentials.
 */
export async function getZarinPalStatus(access_token?: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/zarinpal/status`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || '')
  );
  return getResponseMetadata(result);
}

/**
 * Admin: set (or clear, with price_irr = null) the IRR price a course sells for.
 */
export async function setCourseZarinPalPrice(
  orgId: number,
  courseId: number,
  priceIrr: number | null,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/zarinpal/${encodeURIComponent(String(orgId))}/courses/${encodeURIComponent(String(courseId))}/price`,
    RequestBodyWithAuthHeader('POST', { price_irr: priceIrr }, null, access_token)
  );
  return getResponseMetadata(result);
}

/**
 * Buyer: start a purchase. Returns { payment_uuid, payment_url, authority, amount }.
 * The caller must then redirect the browser to payment_url (ZarinPal's hosted
 * StartPay page) to send the buyer to the gateway.
 */
export async function startZarinPalCheckout(
  orgId: number,
  courseId: number,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/zarinpal/${encodeURIComponent(String(orgId))}/courses/${encodeURIComponent(String(courseId))}/checkout`,
    RequestBodyWithAuthHeader('POST', { course_id: courseId }, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Read a payment's status (buyer who owns it, or an org admin).
 */
export async function getZarinPalPayment(
  orgId: number,
  paymentUuid: string,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/zarinpal/${encodeURIComponent(String(orgId))}/payments/${encodeURIComponent(paymentUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}
