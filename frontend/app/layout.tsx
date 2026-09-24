import type { Metadata } from "next";
import { Patrick_Hand } from "next/font/google";
import "@fontsource-variable/nunito-sans";
import "@fontsource/ibm-plex-mono";
import "./globals.css";

const patrickHand = Patrick_Hand({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-patrick-hand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ratchet — release calibration bench",
  description: "A declaration-to-replay inspection bench for protocol releases on GenLayer Studio Next.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={patrickHand.variable}>
      <body>{children}</body>
    </html>
  );
}
