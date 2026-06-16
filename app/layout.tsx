import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
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
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: "var(--font-manrope), system-ui, sans-serif",
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
