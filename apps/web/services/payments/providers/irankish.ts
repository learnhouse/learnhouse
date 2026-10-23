'use server';
// IranKish (Shaparak) IPG payment provider service.
// Each payment provider gets its own file here. The generic payment config and
// offer services live in payments.ts / offers.ts.
//
// Backend routes live under /api/v1/payments/irankish/... (see
// apps/api/src/routers/payments/irankish.py).
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, errorHandling, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

/**
 * Whether this LearnHouse instance has the IranKish gateway configured.
 * Public probe; does not reveal any credentials.
 */
export async function getIranKishStatus(access_token?: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/irankish/status`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || '')
  );
  return getResponseMetadata(result);
}

/**
 * Admin: set (or clear, with price_irr = null) the IRR price a course sells for.
 */
export async function setCourseIranKishPrice(
  orgId: number,
  courseId: number,
  priceIrr: number | null,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/irankish/${encodeURIComponent(String(orgId))}/courses/${encodeURIComponent(String(courseId))}/price`,
    RequestBodyWithAuthHeader('POST', { price_irr: priceIrr }, null, access_token)
  );
  return getResponseMetadata(result);
}

/**
 * Buyer: start a purchase. Returns { payment_uuid, payment_url, form_fields, amount }.
 * The caller must then POST form_fields to payment_url (as
 * application/x-www-form-urlencoded) to send the cardholder to the gateway.
 */
export async function startIranKishCheckout(
  orgId: number,
  courseId: number,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/irankish/${encodeURIComponent(String(orgId))}/courses/${encodeURIComponent(String(courseId))}/checkout`,
    RequestBodyWithAuthHeader('POST', { course_id: courseId }, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Read a payment's status (buyer who owns it, or an org admin).
 */
export async function getIranKishPayment(
  orgId: number,
  paymentUuid: string,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/irankish/${encodeURIComponent(String(orgId))}/payments/${encodeURIComponent(paymentUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}
