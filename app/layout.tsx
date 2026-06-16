import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unze Group Cockpit",
  description: "Unze Group operations and finance dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sourceSans.variable} h-full antialiased`}>
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: "var(--font-source-sans), system-ui, sans-serif",
                    backgroundColor: "#eef2f7",
          color: "#0f172a",
          margin: 0,
        }}
      >
        {children}
      </body>
    </html>
  );
}
