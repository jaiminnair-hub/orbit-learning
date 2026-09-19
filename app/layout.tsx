import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--orbit-font-sans" });
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--orbit-font-heading",
});

export const metadata: Metadata = {
  title: {
    default: "Orbit Learning",
    template: "%s | Orbit Learning",
  },
  description: "A connected learning workspace for capability, evidence, and growth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${plusJakarta.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div id="main-content" tabIndex={-1}>{children}</div>
      </body>
    </html>
  );
}
