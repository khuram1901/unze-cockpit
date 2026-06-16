import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
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
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          backgroundColor: "#f8fafc",
          color: "#0f172a",
          margin: 0,
        }}
      >
        {children}
      </body>
    </html>
  );
}
