'use client';
import { OrgProvider } from "@components/Contexts/OrgContext";
import SessionProvider from "@components/Contexts/SessionContext";
import "@styles/globals.css";

export default function RootLayout({ children, params }: { children: React.ReactNode, params: any }) {

  return (
    <div>
      <OrgProvider orgslug={params.orgslug}>
        <SessionProvider>
          {children}
        </SessionProvider>
      </OrgProvider>
    </div>
  );
}
