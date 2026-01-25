import { useLHSession } from "@components/Contexts/LHSessionContext";
import { getEEStatus } from "@services/ee/audit_logs";
import useSWR from "swr";

export const useEEStatus = () => {
  const session = useLHSession() as any;
  const accessToken = session?.data?.tokens?.access_token;

  const { data, error, isLoading } = useSWR(
    accessToken ? "ee-status" : null,
    () => getEEStatus(accessToken)
  );

  return {
    eeStatus: data,
    isEE: !!data?.enabled,
    isLoading,
    isError: error,
  };
};

