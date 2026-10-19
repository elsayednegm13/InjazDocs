# مطابقة سير العمل — Checkpoint 06.1

| القصة | الواجهة | الواجهة البرمجية | الحالة |
| --- | --- | --- | --- |
| لوحة العمل التالي | `DashboardPage` | `GET /dashboard` | VERIFIED بالكود؛ اللقطات بعد التشغيل |
| عملية وفاتورة | `CasesPages` | `/export-cases` | VERIFIED إن نجح E2E-04 |
| مستندات وبنك/مباشر | `CasesPages` | مسارات المستندات والبريد | VERIFIED إن نجح E2E-08/09 |
| حجز وخانات | `OpsPages` | `/bookings` | VERIFIED إن نجح E2E-10 |
| تذكير وغفوة | `OpsPages` / `reminders.ts` | `/reminders` والكرون | يعتمد على E2E-15 بعد إصلاح الطبقة |
| قاعدة ج | `InvoicePanel` | `PUT` مقفول، `POST /corrections` | VERIFIED باختبار معزول |
| تتبع عام | `TrackPage` | `/public/track` | VERIFIED إن نجح E2E-12 |
| رفع 400 ميبيبايت سحابي | — | — | DEFERRED_APPROVED |
