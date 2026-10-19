# Checkpoint 02.1 Arabic audit

## Mechanism

`src/locales/en.json` and `src/locales/ar.json` are the only message sources. `useCopy().tx(key, english)` returns the English literal whenever the language is not Arabic, so existing Playwright strings stay exact. In Arabic it returns `t(key)` and falls back to that English literal if the key is missing. `tests/i18n.test.ts` asserts the two files have the same nonempty keys.

Preference stays in `localStorage` key `exportflow.lang`. `applyDir` sets `lang` and `dir` on `html`.

## Terms

Arabic copy uses the approved MSA set: ملف عملية التصدير, فاتورة تجارية, ميناء الشحن, ميناء التفريغ, إجمالي قيمة الفاتورة (قيمة مُدخلة), تأجيل التذكير, وصلت إلى الميناء versus سُلّمت إلى العميل, تم التحميل versus تم التسليم. FOB and CFR stay codes. DHL stays the carrier name. The public page says updates are manual.

`stored()` translates known reminder prefixes and the seeded document names (Commercial Invoice, Packing List, Certificate of Origin, Bill of Lading, and the other seeded English names). Customer names, invoice numbers, booking numbers, UCR, and container numbers are not translated. Identifiers are wrapped in `Ltr` (`bdi dir="ltr"`).

## What Arabic mode covers

Navigation, login, dashboard, case list and detail, invoice and document labels, bank versus direct copy, courier, booking, schedule, reminders, notifications, reports, users, settings, and public tracking. Status chips use `status.*` in Arabic (for example `UNDER_REVIEW` displays as بانتظار المراجعة). English chips keep the spaced code (`UNDER REVIEW`) because `tx` ignores the JSON value in English mode. Buttons that the tests click keep the raw code in English (`UNDER_REVIEW`, `Snooze 1d`).

## Checks

`e2e/locale.spec.ts` switches ع → EN → ع, reloads, expects `lang=ar` and `dir=rtl`, the link لوحة المتابعة, the customer label الاسم القانوني, `dir=ltr` on the IBAN field, and no horizontal overflow above 1px at 390 and 768. It then returns to English and expects Legal name and `dir=ltr`.

## Gaps

Audit action codes on the activity page, reminder rule `name_en` in settings, and free-text notes stay as stored. API validation other than `GROSS_LT_NET` is still the server's English or code string. Money formatting stays the browser locale (`en-US` under Playwright) so `$12,500.00` remains stable. Arabic UI does not switch invoice digits to ar-EG.
