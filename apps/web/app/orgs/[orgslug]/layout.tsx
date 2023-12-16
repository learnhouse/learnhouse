'use client';
import { OrgProvider } from "@components/Contexts/OrgContext";
import AuthProvider from "@components/Security/AuthContext";
import { getAPIUrl } from "@services/config/config";
import { swrFetcher } from "@services/utils/ts/requests";
import "@styles/globals.css";
import useSWR from "swr";

export default function RootLayout({ children, params }: { children: React.ReactNode, params: any }) {

  return (
    <div>
      <AuthProvider orgslug={params.orgslug}>
        <OrgProvider orgslug={params.orgslug}>
          {children}
        </OrgProvider>
      </AuthProvider>
    </div>
  );
}
