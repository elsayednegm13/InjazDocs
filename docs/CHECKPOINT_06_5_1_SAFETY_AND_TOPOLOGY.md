# Checkpoint 06.5.1 — السلامة والمخطط

| البند | القيمة | الوسم |
| --- | --- | --- |
| الجذر | `I:\WORK\InjazDocs` | OBSERVED |
| الوقت | 2026-10-16، المنطقة UTC+3 | OBSERVED |
| النظام | Windows 10.0.26300 | OBSERVED |
| المعالج / الذاكرة | Intel i7-9750H، 12 خيطًا، 16225 MB | MEASURED |
| Node | v24.19.0 | OBSERVED |
| pnpm | 12.11.2 عبر corepack | OBSERVED من الجلسة السابقة وهذا المسار لم يُعد طباعة الإصدار في هذا السطر |
| Vite | 7.3.7 من سجل التشغيل | OBSERVED |
| Wrangler | 4.149.0 | OBSERVED |
| `@cloudflare/vite-plugin` | 1.63.1 | OBSERVED من مسار pnpm |
| Miniflare | 5.20261006.1-alpha | OBSERVED |
| workerd | 1.20261006.1 | OBSERVED من تبعيات الإضافة |
| undici | 7.29.1 | OBSERVED من مكدس `fetch failed` |

## قاعدة المطور

` .wrangler/state/.../e086a16c2df761e404ed26001d3f081a26268e90033ffbf14d8419a939ea8dbc.sqlite`

- الحجم 638976 بايت
- وقت التعديل `2026-10-14T21:07:38.4798993Z`
- أُعيد قياسه بعد تجارب 06.5.1: UNCHANGED
- لم يُقرأ محتواه

## المنافذ

| المنفذ | الاستخدام | ملاحظة |
| --- | --- | --- |
| 43173 | تطوير المالك | لم يُشغَّل ولم يُقتل |
| 43174 | Playwright / Arm A القانوني | `playwright.config.ts` يجبره |
| 43176 | Arm A للقياس ثم خادم الأداء | أُوقف بأمرنا |
| 43181 / 43182 | Vite التشخيصي / Worker المستقل | أُوقفا |
| 9231 | مفتش Arm B | محلي |

لم تُقتل عمليات أجنبية. العمليات التي أُوقفت هي أبناء الأوامر التي شغّلها هذا الفحص.

## العزل

- `.wrangler-e2e/state` تمسحه `scripts/e2e-server.mjs` فقط.
- `.wrangler-reliability-b/state` أُنشئ للفحص وليس وصلة إلى `.wrangler/state`. الهجرة سجّلت المسار `.wrangler-reliability-b\state\v3\d1`.
- `.wrangler-perf` قاعدة الأداء الاصطناعية القائمة. لم تُنسخ من قاعدة المطور.
- المحاولة الأولى لـ Arm B حمّلت `.dev.vars` لأن Wrangler حوّل الإعداد إلى `dist/exportflow/wrangler.json`. قاعدة المطور لم يتغير وقتها. أُوقفت المحاولة. المحاولة التالية استخدمت `--config` داخل المجلد المعزول وحمّلت `.wrangler-reliability-b\.dev.vars` ثم حُذف ملف السر بعد الإيقاف.
- لا استدعاء Cloudflare بعيد، لا Git، لا تغيير `package.json` أو القفل.

## مخطط Arm A

المتصفح → Vite على 127.0.0.1 → `@cloudflare/vite-plugin` `createRequestHandler` → `miniflare.dispatchFetch` → undici Pool (`keepAliveTimeout` 1000ms، `headersTimeout` 0) → workerd → Hono → D1 المحلي.

## التراجع

الملفات المعدّلة للتطبيق: `server/services/reminders.ts`، `server/http/app.ts`، `playwright.config.ts`، `scripts/e2e-server.mjs`. بقية ملفات `scripts/reliability-*` و`vite.reliability.config.ts` تشخيصية ولا تدخل مسار `pnpm dev` الافتراضي.
