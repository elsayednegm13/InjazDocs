# تحقق القاعدة ج — Checkpoint 06.1

التحقق من المصدر في `server/services/cases.ts` و`server/http/app.ts` و`drizzle/migrations/0004_invoice_revisions.sql`. لم يُعاد كتابة المنطق في هذه الجولة.

## القفل

`updateInvoice` يطلب `invoices.edit` ثم `assertInvoiceOrdinaryWrite`. إذا كانت حالة العملية `COMPLETED` يُرجَع 409 بالرمز `INVOICE_LOCKED`.

`PUT` لحقول الفاتورة المخصصة يستدعي نفس الدالة قبل الحفظ. مسار التصحيح الاستثنائي منفصل: `POST /api/v1/invoices/:id/corrections`.

## التصحيح

- الصلاحية `invoices.correct_completed` تُفحص في الخادم. امتلاك `invoices.edit` لا يكفي.
- السبب بعد القص أقصر من 3 أو أطول من 500 يُرجع 422 `INVOICE_CORRECTION_REASON`.
- العملية يجب أن تكون مكتملة، وإلا 409 `INVOICE_NOT_LOCKED`.
- الإصدار يجب أن يطابق الصف، وإلا تعارض.
- `db.batch` يدرج `invoice_revisions` ويحدّث الفاتورة بشرط `version`. إذا لم يتغير صف، يُحذف صف المراجعة ويُرجَع تعارض.
- حقول مخصصة تُحفظ بعد الدفعة، لا داخلها. هذا حد متبقٍ موثّق.
- `GET /api/v1/invoices/:id/revisions` يتطلب `invoices.view` ونطاق العملية.

## قاعدة البيانات

استعلام محلي على `.wrangler/state` (قراءة فقط): `invoice_revisions` غير موجود. النتائج `[]`. الهجرة 0004 لم تُطبَّق على قاعدة المطور.

E2E يطبّق 0004 على `.wrangler-e2e` فقط عند إقلاع `scripts/e2e-server.mjs`.

اختبار `e2e/invoice-lock.spec.ts` يبقى جزءًا من المجموعة الكاملة. نجاحه المعزول في Checkpoint 06 لا يُستبدل بنتيجة المجموعة.
