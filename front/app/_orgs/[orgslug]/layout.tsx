import "@styles/globals.css";
import { Menu } from "@components/UI/Elements/Menu";
import AuthProvider from "@components/Security/AuthProvider";

export default function RootLayout({ children, params }: { children: React.ReactNode , params:any}) {
  
  return (
    <>
      <AuthProvider>
        <Menu></Menu>
        {children}
      </AuthProvider>
    </>
  );
}
