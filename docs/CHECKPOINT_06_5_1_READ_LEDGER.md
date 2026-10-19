# Checkpoint 06.5.1 — سجل القراءة

التاريخ: 2026-10-16. الجذر المؤكد: `I:\WORK\InjazDocs`. لم تُقرأ المستودع بالكامل.

| المسار | العمق | السبب | نتيجة مختصرة |
| --- | --- | --- | --- |
| `package.json` | full | إصدارات الأوامر | Vite 7 / Wrangler 4 / لا سكربت نشر بعيد مفعّل |
| `pnpm-lock.yaml` | hash فقط | تثبيت مثبت | لم يُفتح الملف سطرًا سطرًا |
| `vite.config.ts` | full | مسار Arm A | `dispatch` عبر الإضافة، `hmr.overlay: false`، المنفذ من `EXPORTFLOW_PORT` |
| `playwright.config.ts` | full | منفذ E2E | أُجبر `EXPORTFLOW_PORT=43174` داخل `webServer.env` |
| `scripts/e2e-server.mjs` | full | عزل E2E | يمسح `.wrangler-e2e` فقط ويكتب `.dev.vars.e2e` |
| `wrangler.jsonc` | full | الربط | D1 محلي، R2 محلي، cron كل دقيقة، لا `[env.staging]` |
| `worker/index.ts` | full | المدخل | `fetch` و`scheduled` |
| `server/http/app.ts` | partial: التتبع ومسار PATCH والقواعد العامة | حدود الطلب | التتبع كان بعد انتهاء المعالج؛ أُضيف سطر دخول |
| `server/services/reminders.ts` | full للدوال `recomputeRemindersForCase` و`updateRule` و`upsertInstance` | تعليق PATCH | الحلقة التسلسلية هي كلفة الحفظ |
| `server/services/reports.ts` | full لـ `overview` | عدم التراجع عن إصلاح 06.5 | `caseVisibilitySql` موجود |
| `server/services/actor.ts` | full لـ `caseVisibilitySql` | اختبار النطاق | `view_all` أو `assigned_to/created_by` |
| `server/auth.ts` | full | التكافؤ | HttpOnly، SameSite lax، secure فقط مع https |
| `server/domain/reminders.ts` | partial: `computeDueAt` و`evaluateDue` | صحة الدفعة | الحالة تُحسب من الاستحقاق |
| `e2e/operations.spec.ts` | partial: E2E-15 وE2E-15b | الاختبار المعلق | السطر الأخير PATCH يعيد الإزاحة |
| `e2e/security.spec.ts` | partial حول إعادة المحاولة | لا إضعاف | إعادة GET فقط عند HTML |
| `e2e/invoice-lock.spec.ts` | partial حول التعليق | سياق موجود | سياق جديد بعد reset، لا إعادة تصحيح صامتة |
| `tests/domain.test.ts` | أول 40 سطرًا | نمط الاختبار | Vitest بلا D1 |
| إضافة Cloudflare `dist/index.mjs` حوالي `createRequestHandler` | partial | حدود الخطأ | `ECONNRESET` يصل `next(error)`؛ الإلغاء يسكت |
| Miniflare `index.js` حوالي المجمع | partial | المهلة | `keepAliveTimeout: 1000`، `headersTimeout: 0` |
| `wrangler dev --help` ومسار تحميل `.dev.vars` | partial | Arm B | `--persist-to` الافتراضي خطر؛ `--config` يمنع التحويل إلى `dist` |

مناطق لم تُقرأ كاملة: `cases.ts`، `documents.ts`، `bookings.ts`، معظم ملفات الواجهة، ملفات اللغة، و`node_modules` خارج مواضع التتبع المذكورة. الحكم على تلك المناطق: NOT_TESTED إلا ما أثبته تشغيل Playwright القائم.
