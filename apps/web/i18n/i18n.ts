import { match } from "@formatjs/intl-localematcher";
import { match as matchLocale } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { NextRequest } from "next/server";

export const i18n = {
  defaultLocale: "en",
  locales: ["en", "de"],
} as const;

export type Locale = (typeof i18n)["locales"][number];

export function getLocale(request: NextRequest): string | undefined {
  // Negotiator expects plain object so we need to transform headers
  const negotiatorHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => (negotiatorHeaders[key] = value));

  let cookie_locale_cookie = request.cookies.get("LEARNHOUSE_LOCALE");
  // Get string from cookie
  let cookie_locale = cookie_locale_cookie?.value.toString();

  // @ts-ignore locales are readonly
  const locales: string[] = i18n.locales;

  // Use negotiator and intl-localematcher to get best locale
  let languages = new Negotiator({ headers: negotiatorHeaders }).languages(locales);

  // Priority to Cookies over Accept-Language
  if (cookie_locale) {
    languages = [cookie_locale, ...languages];
  }

  const locale = matchLocale(languages, locales, cookie_locale ?? i18n.defaultLocale);

  return locale;
}
