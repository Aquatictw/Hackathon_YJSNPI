import type { Metadata } from "next";
import { cookies } from 'next/headers';
import "./globals.css";
import {AppTheme} from "@/components/theme-controls";
import {LocaleProvider} from '@/components/locale-provider';
import {isLocale, localeStorageKey} from '@/lib/rtdi/locale';

// Existing users may only have localStorage. Hide mismatched server text before
// the first paint until the provider reconciles it, then future requests use the cookie.
const localeBootstrap = `(function(){try{var r=document.documentElement,s=localStorage.getItem('rtdi.locale')??localStorage.getItem('rtdi.response-language');if((s==='en'||s==='zh-TW')&&s!==r.lang){r.setAttribute('data-locale-pending','');document.cookie='rtdi.locale='+s+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');addEventListener('load',function(){setTimeout(function(){r.removeAttribute('data-locale-pending')},5000)},{once:true})}}catch(e){}})()`;

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const savedLocale = (await cookies()).get(localeStorageKey)?.value;
  const initialLocale = isLocale(savedLocale) ? savedLocale : 'en';
  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <head>
        <style>{'html[data-locale-pending] body{visibility:hidden}'}</style>
        <script dangerouslySetInnerHTML={{__html:localeBootstrap}} />
      </head>
      <body className="antialiased"><AppTheme><LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider></AppTheme></body>
    </html>
  );
}
