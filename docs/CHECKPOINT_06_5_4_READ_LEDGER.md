# سجل القراءة — Checkpoint 06.5.4

الثقة عالية في الملفات التي فُتحت أدناه. `cases.ts` يبقى `RECONSTRUCTED_AND_CONTRACT_VERIFIED` ولم يُعد قراءته كاملًا في هذه النقطة.

## قُرئ واستُخدم

| الملف | المنطقة | ماذا ثَبَت |
| --- | --- | --- |
| `server/services/reminders.ts` | `updateRule`، `processDueReminders`، `syncRuleInstances`، `loadBookingFamily`، `loadBankReview` | لا عمود إصدار على التعريف. الدفعة الواحدة قائمة. اختيار المجدول ما زال `LIMIT 100` |
| `server/domain/reminders.ts` | `notificationCycleKey`، `conditionStillHolds` | مرة واحدة ثم `null`. شرط تسليم البضاعة يحتاج وصولًا فعليًا |
| `server/domain/dates.ts` | `dateOnlyInZone`، `addOffset` | تاريخ القاهرة من `Intl`. إزاحة الساعات من منتصف ليل UTC |
| `drizzle/migrations/0001_init.sql` | `reminder_rule_definitions` | الأعمدة الحالية بلا `updated_at` وبلا `version` |
| `vite.config.ts` | بوابة 320 مللي ثانية | كل طلب عبر `dispatcher` ينتظر البوابة. الانتظار بعد طلبات الجسم فقط |
| `server/http/app.ts` | مسار القاعدة والمسبار و`handleScheduled` | `waitUntil` في `worker/index.ts`. المجدول يستدعي التذكير ثم انتهاء جلسات الرفع |
| `src/features/admin/AdminPages.tsx` | حفظ القاعدة | كان يرسل PATCH بلا لقطة |
| `src/lib/api.ts` و`src/lib/fail.ts` | أخطاء الشبكة | HTML لا يُعامل نجاحًا |
| `e2e/operations.spec.ts` و`invoice-lock.spec.ts` و`security.spec.ts` | PATCH القواعد | كانت بلا `expected` |
| `scripts/e2e-server.mjs` | العزل | يمسح `.wrangler-e2e` فقط ويكتب `.dev.vars.e2e` |
| `docs/CHECKPOINT_06_5_3_FINAL_REPORT.md` و`summary.json` | تاريخ | أرقام 06.5.3 تبقى `PRIOR_EVIDENCE` |

## لم يُقرأ كاملًا

خدمات الفاتورة والحجز قُرئت عند مواضع الإنشاء والتحديث فقط. لا مراجعة سطرًا بسطر لـ `reports.ts`. لا إعادة قراءة لتقارير 06.4 وما قبلها إلا كعناوين في التسليم.
