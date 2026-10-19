# Checkpoint 06.5.1 — التغيير والتراجع

لا Git. البصمات SHA-256 أول 16 خانة بعد التعديل.

| الملف | البصمة | السلوك | التراجع |
| --- | --- | --- | --- |
| `server/services/reminders.ts` | `bd4917e2dd6ddddc` | حفظ قاعدة المستند غير الجاهز بدفعات؛ بقية القواعد تُعاد لقاعدة واحدة | استرجاع الدالة التسلسلية |
| `server/http/app.ts` | `06fab72059735339` | سطر دخول التتبع واسم `reminder-rules` عند `EXPORTFLOW_TRACE=1` فقط | حذف السطرين |
| `playwright.config.ts` | `edd999ed3dfb58ee` | يجبر منفذ 43174 | حذف مفتاح env |
| `scripts/e2e-server.mjs` | `56042d1a0bc47ba0` | يكتب `EXPORTFLOW_TRACE=1` في ملف E2E فقط إذا طُلب | حذف السطر |
| `tests/dashboard-scope.test.ts` | `dde51f0bb61eee42` | اختبار نطاق اللوحة | حذف الملف |
| `vite.reliability.config.ts` | `e22c71db5d842bf1` | تشخيصي، لا يستخدمه `pnpm dev` | حذف الملف |
| `scripts/reliability-arm-b.mjs` | `5c46a1b5ea4950de` | مشغّل Arm B | حذف الملف |
| `scripts/reliability-burst.mjs` | `338f6d9eef584d9f` | قياس قراءات | حذف الملف |
| `scripts/reliability-post-burst.mjs` | `35c46aad416ba7b1` | قياس POST | حذف الملف |
| `scripts/reliability-rule-timing.mjs` | `c61b4f94f60cdac6` | يقرأ حساب الأداء محليًا ولا يطبعه | حذف الملف |

لم يُلمس `package.json` ولا `pnpm-lock.yaml` (بصمة القفل `2d0f2ff775f2a438` للسجل فقط). `reports.ts` بقي `4506c75cbe5a1b82`.

تجارب أُوقفت: Arm B الأول الذي حمّل `.dev.vars` عبر إعداد dist. لم يُدمج. ملف السر المعزول حُذف بعد الإيقاف.

`pnpm build` يُشغَّل بعد المجموعة الثانية حتى لا يزاحم Vite.
