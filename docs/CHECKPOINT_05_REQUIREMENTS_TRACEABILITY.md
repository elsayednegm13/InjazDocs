# تتبع المتطلبات — Checkpoint 05

| القاعدة | المصدر | الاختبار | الحالة |
| --- | --- | --- | --- |
| لا إشعار ساعي بلا سياسة تكرار | `notificationCycleKey` | وحدة `notification cadence` | VERIFIED محليًا |
| غفوة حتى الموعد ثم حل عند الاعتماد | `upsertInstance` / `evaluateDue` | E2E-15 | VERIFIED إن نجح التشغيل |
| الرفع لا يلغي مراجعة معلّقة | `recomputeRemindersForCase` | E2E-15b | VERIFIED إن نجح التشغيل |
| جيل التاريخ القديم يُلغى | `cancelOtherGenerations` | A7 | VERIFIED في التشغيل الكامل 29 |
| نطاق التذكير والغفوة | `snoozeReminder` / `listNotifications` | A6 | VERIFIED إن نجح التشغيل |
| ملف أسرار خارج `dist` | `omitCopiedDevVars` + الحارس | بناء بلا `.dev.vars` | VERIFIED |
| لقطة العميل ثابتة | `createCase` فقط | قراءة الكود | VERIFIED على الكود |
| قفل فاتورة بعد الإكمال | — | — | OWNER_DECISION_REQUIRED |
| سحابة / 400 ميبيبايت | — | — | NOT RUN |
