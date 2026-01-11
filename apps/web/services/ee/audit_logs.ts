import { getAPIUrl } from "../config/config";
import { swrFetcher } from "../utils/ts/requests";

export const getAuditLogs = async (orgId: number, accessToken: string, filters: any = {}) => {
  const queryParams = new URLSearchParams();
  queryParams.append("org_id", orgId.toString());
  if (filters.offset) queryParams.append("offset", filters.offset.toString());
  if (filters.limit) queryParams.append("limit", filters.limit.toString());
  if (filters.user_id) queryParams.append("user_id", filters.user_id.toString());
  if (filters.action) queryParams.append("action", filters.action);
  if (filters.resource) queryParams.append("resource", filters.resource);
  if (filters.status_code) queryParams.append("status_code", filters.status_code.toString());
  if (filters.start_date) queryParams.append("start_date", filters.start_date);
  if (filters.end_date) queryParams.append("end_date", filters.end_date);

  const url = `${getAPIUrl()}ee/audit_logs/?${queryParams.toString()}`;
  return swrFetcher(url, accessToken);
};

export const getEEStatus = async (accessToken: string) => {
  const url = `${getAPIUrl()}ee/status`;
  return swrFetcher(url, accessToken);
};

