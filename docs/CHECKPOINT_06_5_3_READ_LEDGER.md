# سجل القراءة — Checkpoint 06.5.3

التاريخ: 2026-10-17. الجذر المؤكد `I:\WORK\InjazDocs`. لا يوجد مستودع Git.

## قُرئ في هذه الجولة

| الملف | النطاق | الثقة |
| --- | --- | --- |
| `server/services/reminders.ts` | `syncRuleInstances`، `processDueReminders`، `updateRule`، `recomputeRemindersForCase` | FULL_READ للمقاطع المعدّلة |
| `server/domain/reminders.ts` | `notificationCycleKey` حوالي 128–148 | TARGETED |
| `server/http/app.ts` | خطأ الفاتورة `EXPORTFLOW_TEST_FAULTS === "1"`، `handleScheduled`، مسار الفحص | TARGETED |
| `worker/index.ts` | `scheduled` يستدعي `waitUntil(handleScheduled)` | FULL_READ |
| `drizzle/migrations/0001_init.sql` | جداول التذكير والإشعارات، لا عمود إصدار للقاعدة | TARGETED |
| `drizzle/migrations/0002_seed.sql` | 11 قاعدة مزروعة، لا `CUSTOM_FOLLOWUP` | TARGETED |
| `vite.config.ts` | الإعداد الحالي ثم تعديل المجمع المحلي | FULL_READ |
| `scripts/e2e-server.mjs` | يمسح `.wrangler-e2e` فقط ويكتب `.dev.vars.e2e` | FULL_READ |
| `scripts/checkpoint-06-4-server.mjs` و`checkpoint-06-4-guard.mjs` | المنفذ 43176 والحارس | FULL_READ |
| `playwright.config.ts` | `retries: 0`، المنفذ 43174 بعد نشر البيئة | FULL_READ |
| `package.json` | السكربتات، لم يُغيّر | FULL_READ |
| Miniflare `dist/src/index.js` | `server.keepAliveTimeout = 0` عند 134094، مجمع undici عند 134689، `dispatchFetch` عند 134928، `options.reset = false` عند 90384 | TARGETED |
| undici `client-h1.js` | `maxRequestsPerClient` يغلق المقبس بعد الطلب | TARGETED |
| تقارير 06.5.2 و06.5.1 و06.5 و06.4 | أدلة سابقة، ليست إثبات هذه الجولة | PRIOR_EVIDENCE |

## لم يُعد فتحه

`server/services/cases.ts` يبقى `RECONSTRUCTED_AND_CONTRACT_VERIFIED`. لم تظهر قراءة جديدة تغيّر هذا الوسم. لم تُقرأ قيم `.dev.vars` ولا `.dev.vars.perf` ولا `accounts.json` في التقرير.

## ما أكّدته هذه الجولة وما لم تؤكده

- أكّدت أن دفعات D1 المحلية حتى 2000 عبارة تُثبَّت، وأن عبارة مسمومة داخل الدفعة تُرجع العداد إلى 0. هذا MEASURED.
- أكّدت أن نبضة المجدول الثانية قبل الإصلاح لم تزد الإشعارات عن 100. MEASURED.
- تقرير 06.5.2 عن 6 و4 أسطر `fetch failed` يبقى PRIOR_EVIDENCE. هذه الجولة قاست نمطاً متناوباً 6/12 ثم صفر أعطال في تشغيلين كاملين.
