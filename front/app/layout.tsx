"use client";
import "../styles/globals.css";
import StyledComponentsRegistry from "../components/lib/styled-registry";
import { Menu } from "../components/UI/Elements/Menu";
import { motion } from "framer-motion";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const variants = {
    hidden: { opacity: 0, x: 0, y: 0 },
    enter: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: 0, y: 0 },
  };
  return (
    <html className="" lang="en">
      <head />
      <body>
        <StyledComponentsRegistry>
          <motion.main
            variants={variants} // Pass the variant object into Framer Motion
            initial="hidden" // Set the initial state to variants.hidden
            animate="enter" // Animated state to variants.enter
            exit="exit" // Exit state (used later) to variants.exit
            transition={{ type: "linear" }} // Set the transition to linear
            className=""
          >
            {children}
          </motion.main>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
