import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RTDI Insight | grp6",
  description: "半導體測試事件與 AI 調查工作區。",
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
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
