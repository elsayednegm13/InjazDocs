# مسار الاستدعاء — Checkpoint 06.5.3

## الذراع A، الإضافة الرسمية

المتصفح أو Playwright → Vite على `127.0.0.1` → `@cloudflare/vite-plugin` 1.63.1 `dispatchFetch` في `dist/index.mjs` حوالي 56327 → Miniflare `dispatchFetch` (`index.js` 134947) → `fetch4` → `undici.fetch` مع `DispatchFetchDispatcher` الذي يضبط `idempotent = false` و`reset = false` → `Pool` نحو منفذ workerd.

خيارات المجمع كما هي في Miniflare 5.20261006.1-alpha عند السطر 134689: `keepAliveTimeout: 1000`، `keepAliveMaxTimeout: 1000`، `headersTimeout: 0`، `bodyTimeout: 0`. التعليق في المصدر يقول إن الإغلاق بعد ثانية يسبق مهلة خمول workerd المزعومة 5 ثوانٍ. هذه الجولة لم تجد ثابت 5 ثوانٍ في الإعداد، فالتعليق ليس إثباتاً.

خادم الحلقة الراجعة في Miniflare يضبط `server.keepAliveTimeout = 0` (السطر 134094). `dispatchFetch` لا يستخدم ذلك الخادم للطلبات العادية؛ يستخدم مجمع workerd.

## الذراع B

لم يُشغَّل في هذه الجولة. إعداد 06.5.2 في `vite.reliability.config.ts` يوكّل `/api` إلى workerd منفصل ولا يمر من إضافة Cloudflare. إصلاح هذه الجولة يعيش في `vite.config.ts` فقط.

## التذكير

`PATCH /api/v1/reminder-rules/:id` → `updateRule`. بعد التحقق تُبنى عبارة تحديث التعريف مع عبارات الصفوف المشتقة وعبارة `next_action` في `db.batch` واحد إذا كان العدد ≤ 2000. `CUSTOM_FOLLOWUP` ما زال يعيد `null` من `loadDesiredForRule` فيُثبَّت التعريف وحده ثم تُعاد الحسابات تسلسلياً.

`processDueReminders` يختار حتى 100 صفاً مستحقاً لم يُسلَّم في الدورة الحالية، يعيد حساب زوج الحالة/القاعدة، ثم يدرج الإشعارات في دفعة واحدة.

`worker/index.ts` يعيد من `scheduled` فور استدعاء `waitUntil`. قياس الاكتمال كان من قاعدة البيانات ومن سطر `reminder-cron`، لا من نص HTTP `ok` وحده.
