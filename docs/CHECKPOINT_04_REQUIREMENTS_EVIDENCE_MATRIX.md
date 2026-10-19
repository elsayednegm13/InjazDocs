# مصفوفة الأدلة — Checkpoint 04

الحالة من الكود والاختبارات المحلية. تقارير الوكلاء السابقين ليست دليلًا وحدها. لا موافقة مالك على التأجيل إلا حيث وُثّق أن السحابة خارج التفويض.

| السلوك | المكان | الدليل | الحالة | التالي |
| --- | --- | --- | --- | --- |
| عميل متعدد جهات الاتصال والعناوين | `customers.ts` / `CustomersPages.tsx` | E2E-03 | VERIFIED | — |
| بنك آخر أربعة أرقام فقط | `last4` في `customers.ts` | E2E-03 لا يظهر الرقم الكامل | VERIFIED | تخزين IBAN الكامل مؤجّل حتى تشفير معتمد |
| لقطة عميل لا تتغير مع تعديل الملف | إدراج اللقطة في `createCase`؛ التحديث لا يمسها | قراءة الكود | VERIFIED على الكود؛ لا اختبار يغيّر الاسم ثم يعيد قراءة اللقطة | اختبار ثبات اللقطة لاحقًا إن طُلب |
| فاتورة: رقم وتاريخ وموانئ وشروط وFOB/CFR وأوزان وإجمالي صريح | `priceInvoice` / `domain/invoice.ts` | T02 T03 E2E-04 E2E-05 | VERIFIED | — |
| حقول مخصصة لخمسة كيانات مع الإحمرار والتاريخ | `custom-fields.ts` | E2E الحقول + وحدة | VERIFIED | `MONEY` DEFERRED |
| قائمة مستندات ديناميكية ونسخ ومراجعة وإعفاء | `documents.ts` | E2E-06 E2E-07 | VERIFIED | — |
| مساران بنك/مباشر وبريد يدوي | `transitions.ts` `bank-courier.ts` | E2E-08 E2E-09 | VERIFIED | لا API لـ DHL |
| حجز بعدد خانات وPDF وUCR وجدول | `bookings.ts` `OpsPages.tsx` | E2E-10 | VERIFIED | — |
| إغلاق بمسارين | `canCompleteCase` | E2E-11 | VERIFIED | — |
| تذكير وغفوة وإلغاء عند زوال الشرط وكرون بلا تكرار داخل الساعة | `reminders.ts` `worker/index.ts` | E2E-15 E2E-15b ووحدة المفتاح | VERIFIED محليًا؛ كرون Cloudflare UNVERIFIED | — |
| رابط عام قابل للإلغاء بلا مبلغ | `publicTracking` | الكود لا يعيد المبلغ؛ E2E-12 | VERIFIED | — |
| مستخدمون بلا تسجيل عام، آخر مدير، نطاق عملية | `users.ts` `actor.ts` | E2E-02 A2 A3 | VERIFIED | — |
| أخطاء عربية/إنجليزية بلا SQL | `errors.ts` `fail.ts` القواميس | T01 ووحدة i18n | VERIFIED | اعتماد الشكل البصري DEFERRED للمالك |
| معاينة CSV لا تكتب إلا عند التأكيد | `csv.ts` `OpsPages.tsx` `previewCustomerImport` | وحدة CSV؛ المعاينة في الواجهة | PARTIAL | الاستيراد المؤكد موجود لمسار العملاء فقط وليس منتج استيراد عام |
| عزل D1/R2 محلي وE2E | `e2e-server.mjs` `wrangler.jsonc` | السكربت يحذف `.wrangler-e2e` فقط | VERIFIED للحدود | — |
| رفع 20/100/250/400 ميبيبايت على R2 حقيقي | `uploads.ts` | المسار الموقّع في الكود | DEFERRED | يحتاج دلو ExportFlow وموافقة |
| بيئة staging | `staging-preflight.mjs` | يرفض ويخرج 2 | BLOCKED | لا إنشاء موارد |
| أسرار خارج مخرجات النشر | `build-artifact-guard.mjs` | بناء نظيف بعد الحذف | VERIFIED محليًا | لا يعني أن النسخ القديمة لم تُرفع؛ لا دليل رفع |

`cases.ts`: RECONSTRUCTED_AND_CONTRACT_VERIFIED. انظر `CHECKPOINT_04_CASES_SOURCE_INTEGRITY.md`.
