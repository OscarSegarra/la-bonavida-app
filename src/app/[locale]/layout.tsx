import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "La BonaVida",
  description: "Household meal planning and shopping lists",
};

/**
 * The app's root layout. It lives under `[locale]` rather than at
 * `app/` because the `<html lang>` attribute has to reflect the active
 * language, which is only known once the locale segment is resolved.
 * @param children The page being rendered.
 * @param params Route params carrying the locale segment.
 * @returns The HTML document shell, with translations made available to
 * Client Components below it.
 */
export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  // A URL like /xx/login reaches here with an unsupported locale; 404 rather
  // than silently falling back, so a broken link is visible instead of
  // quietly serving Spanish.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
