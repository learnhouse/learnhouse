import "@styles/globals.css";
import { Menu } from "@components/Objects/Menu/Menu";
import AuthProvider from "@components/Security/AuthProviderDepreceated";

export default function RootLayout({ children, params }: { children: React.ReactNode , params :any}) {
  return (
    <>
      <AuthProvider>
        <Menu orgslug={params?.orgslug}></Menu>
        {children}
      </AuthProvider>
    </>
  );
}
