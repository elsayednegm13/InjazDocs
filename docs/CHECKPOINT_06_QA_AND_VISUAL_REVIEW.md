# مراجعة الجودة واللقطات — Checkpoint 06

## الأوامر

| الأمر | الخروج | النتيجة |
| --- | --- | --- |
| `corepack pnpm typecheck` | 0 | نجح |
| `corepack pnpm test` | 0 | 6 ملفات، 27 اختبارًا |
| `corepack pnpm lint` | 0 | تحذير oxlint واحد سابق في `CustomFieldsPanel.tsx` |
| `corepack pnpm build` | 0 | لا `dist/exportflow/.dev.vars`. الحارس: `publishable output is clean`. حزمة الواجهة 530.16 ك.ب |
| `playwright test e2e/invoice-lock.spec.ts` | 0 | 3 نجح (إعدادان + قفل الفاتورة)، 47 ث |
| `playwright test e2e/checkpoint06-shots.spec.ts` قبل التعديل البصري | 0 | 3 نجح. اللقطات في `docs/qa-screenshots/checkpoint-06/before/` |
| `playwright test` الكامل | 1 | **29 نجح، 3 فشل**، 11.8 د |

## الفشل في التشغيل الكامل

1. E2E-15: انتهت المهلة وهو ينتظر `input[name="legalName"]` في إنشاء عميل. ظهر `fetch failed` من Vite في الوقت نفسه.
2. E2E-15b: نفس الانتظار على نموذج العميل.
3. A6: `GET /cdn-cgi/local/scheduled` لم يكن ناجحًا.

A7 وبقية الأمن واللقطات البصرية نجحوا داخل نفس التشغيل. هذا لا يحوّل التشغيل إلى PASS.

## اللقطات

قبل: `docs/qa-screenshots/checkpoint-06/before/` (لوحة إنجليزي/عربي، سطح مكتب و390، تذكيرات وإعدادات عربية).

بعد: `docs/qa-screenshots/checkpoint-06/after/` بنفس الأسماء. راجعت أنها كُتبت أثناء التشغيل. لم تُفتح كل لقطة للمقارنة البصرية اليدوية في هذه الجولة، لذلك لا يُدّعى اعتماد تصميم.

`retries` في Playwright = 0. لا سحابة.
