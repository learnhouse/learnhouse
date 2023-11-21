import "@styles/globals.css";
import { Menu } from "@components/Objects/Menu/Menu";
import AuthProvider from "@components/Security/AuthProvider";
import { getDictionary } from "i18n/get-dictionary";

export default async function RootLayout({ children, params }: { children: React.ReactNode, params: any }) {

  // i18n 
  const dict = await getDictionary(params.locale)

  return (
    <>
      <AuthProvider>
        <Menu dict={dict} orgslug={params?.orgslug}></Menu>
        {children}
      </AuthProvider>
    </>
  );
}
