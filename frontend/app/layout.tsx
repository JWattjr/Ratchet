import type { Metadata } from "next";
import "@fontsource-variable/nunito-sans";
import "@fontsource/ibm-plex-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ratchet — release calibration bench",
  description: "A declaration-to-replay inspection bench for protocol releases on GenLayer Studio Next.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
