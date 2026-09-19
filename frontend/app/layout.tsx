import type { Metadata } from "next";
import "./globals.css";
import {AppTheme} from "@/components/theme-controls";
import {LocaleProvider} from '@/components/locale-provider';

export const metadata: Metadata = {
  title: "RTDI | Test Analysis",
  description: "Semiconductor test evidence, wafer analysis, predictions and investigation records.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><AppTheme><LocaleProvider>{children}</LocaleProvider></AppTheme></body>
    </html>
  );
}
