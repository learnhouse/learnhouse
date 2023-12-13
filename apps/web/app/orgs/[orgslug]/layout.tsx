'use client';
import { OrgProvider } from "@components/Contexts/OrgContext";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/ts/requests";
import "@styles/globals.css";
import useSWR from "swr";

export default function RootLayout({ children, params }: { children: React.ReactNode, params: any }) {

  return (
      <div>
        <OrgProvider orgslug={params.orgslug}>
        {children}
      </OrgProvider>
      </div>
  );
}
