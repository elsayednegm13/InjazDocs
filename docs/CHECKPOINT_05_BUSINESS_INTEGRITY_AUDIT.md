# سلامة السجلات — Checkpoint 05

المصدر: قراءة [تدقيق اللقطة والفاتورة](da8377a2-9a73-4599-a9b5-5e8d98e59277) ثم مطابقة الدوال.

## اللقطة

`createCase` هو موضع الإدراج الوحيد في `export_case_customer_snapshots`. `updateCustomer` يحدّث `customers` فقط. لا `UPDATE` على جدول اللقطة في `server/`.

## الفاتورة بعد الإكمال

`createInvoice` و`updateInvoice` يفحصان الصلاحية و`assertCaseAccess` والإصدار، ولا يفحصان `COMPLETED`. إعادة الفتح `COMPLETED → ACTIVE` موجودة وتتطلب `export_cases.reopen`. لم يُضف قفل؛ المالك لم يوافق. الخيارات في `CHECKPOINT_05_OWNER_BUSINESS_DECISIONS.md`.

## التتبع العام

`publicTracking` يقرأ `invoice_total_minor` ولا يعيده. لا مفاتيح ملفات ولا أرقام حساب. حالة مسار البنك قد تظهر كمرحلة مستندات لا كبيانات مصرفية.

## وصول عبر عملية أخرى

`authorizeObjectKey` يعيد 404 عند رفض العملية. اختبار A2. تذكيرات عملية غير معيّنة: A6.
