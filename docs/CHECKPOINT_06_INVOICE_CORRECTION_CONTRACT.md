# عقد تصحيح الفاتورة — القاعدة ج

عند `export_cases.status = COMPLETED`:

- `PUT /api/v1/invoices/:id` و`PUT /api/v1/invoices/:id/custom-fields` يعيدان 409 `INVOICE_LOCKED`.
- `POST /api/v1/invoices/:id/corrections` يتطلب `invoices.correct_completed` وسببًا من 3 إلى 500 حرفًا بعد القص.
- تُدرج `invoice_revisions` ثم يُحدَّث الصف بشرط `version` داخل `db.batch`. إن لم يتغير الصف تُحذف المراجعة ويُعاد 409.
- الصلاحية تُزرع للمدير فقط في `0004_invoice_revisions.sql`. لا تُمنح لمدير العمليات ولا للموظف.
- الهجرة تُطبَّق على قاعدة E2E عند تشغيل Playwright. لم تُطبَّق على `.wrangler` للمطور.

اختبار `e2e/invoice-lock.spec.ts` أثبت الرفض، ورفض السبب الفارغ بلا مراجعة، ثم مراجعة واحدة، ثم تعارض الإصدار القديم.
