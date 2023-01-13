
import "../styles/globals.css";
import StyledComponentsRegistry from "../services/lib/styled-registry";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="" lang="en">
      <head />
      <body>
        <StyledComponentsRegistry>{children}</StyledComponentsRegistry>
      </body>
    </html>
  );
}
