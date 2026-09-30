import { HouseEdgeAnalytics } from "../components/house-edge-analytics";
import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";
export const metadata: Metadata = {
  title: "Shipwreck — Find what sinks before you ship.",
  description:
    "Evidence-backed production readiness. Inspect your repository, understand launch risks, and ship with confidence.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <HouseEdgeAnalytics />
        {children}
      </body>
    </html>
  );
}
