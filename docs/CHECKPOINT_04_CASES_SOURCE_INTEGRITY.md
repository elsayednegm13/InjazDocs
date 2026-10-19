# سلامة مصدر cases.ts — Checkpoint 04

## الحكم على الأصل

**RECONSTRUCTED_AND_CONTRACT_VERIFIED**

ليست **VERIFIED_AGAINST_ORIGINAL**. لا يوجد Git، ولا نسخة مصدر سابقة، ولا لقطة مؤرخة لملف `server/services/cases.ts` قبل أن يُبلَّغ أن طوله كان 0 بايت. الحزمة التي استُخدمت في الاستعادة (`dist`) أُعيد بناؤها لاحقًا، فلم يعد بالإمكان مقارنة المصدر الحالي بتلك الحزمة القديمة بايتًا ببايت. الهوية التاريخية للمصدر **غير مُثبتة**.

ما يمكن إثباته: الملف الحالي يُصرَّف، وتستدعيه `server/http/app.ts`، وسلوكه المطابق للعقد مغطى باختبارات وحدة وE2E على حالة معزولة.

## الصادرات

| التصدير | المسار | صلاحية | كتابة | تدقيق |
| --- | --- | --- | --- | --- |
| `listCases` | `GET /export-cases` | `view_all` أو `view_assigned` ثم `caseVisibilitySql` | لا | لا |
| `getCaseOverview` | `GET /export-cases/:id` | `assertCaseAccess` | لا | يقرأ الحقول المخصصة |
| `createCase` | `POST /export-cases` | `export_cases.create` | `export_cases` حالة `DRAFT` + لقطة عميل + قالب مستندات | `case.create` و`CASE_CREATED` ثم إعادة حساب التذكيرات |
| `transitionCase` | `POST /export-cases/:id/status` | وصول للعملية؛ `close` عند الإكمال؛ `reopen` من `COMPLETED` إلى `ACTIVE` | تحديث الحالة والإصدار | `case.status` |
| `createInvoice` | ضمن إنشاء العملية أو `POST /export-cases/:id/invoices` | `invoices.edit` + `assertCaseAccess` | `export_invoices` بوحدات صغرى وغرامات | `invoice.create` |
| `updateInvoice` | `PUT /invoices/:id` | `invoices.edit` + وصول لعملية الفاتورة + تطابق `version` | تحديث الصف | `invoice.update` |

`priceInvoice` خاصة بالملف. ترفض FOB مع شحن مفوتر، وترفض الوزن القائم الأقل من الصافي، ولا تعيد كتابة إجمالي الفاتورة.

## ثوابت طُابقت بالكود والاختبار

| الثابت | الدليل |
| --- | --- |
| المسودة لا تقفز إلى `COMPLETED` | `assertCaseTransition` في `tests/domain.test.ts` |
| مسار البنك يبدأ `PREPARING` والمباشر `NOT_REQUIRED` / `PREPARING` | `initialRouteStatus` في `server/domain/transitions.ts` |
| لقطة العميل تُكتب عند الإنشاء ولا يحدّثها `updateCustomer` | `createCase` يدرج `export_case_customer_snapshots`؛ `customers.ts` يحدّث جدول العميل فقط |
| حقول العملية المطلوبة تُفرض عند مغادرة المسودة لا قبلها | `customFieldsRequiredNow` + E2E الحقول المخصصة |
| وصول حاوية/فاتورة/حجز يمر عبر `case_id` | `assertCaseAccess` |
| تعارض الإصدار يعيد 409 | فحص `version` قبل الكتابة |

## فجوات لم تُصلح لأنها ليست خرقًا مثبتًا للعقد

- تعديل فاتورة بعد `COMPLETED` ما زال مسموحًا لمن يملك `invoices.edit` ووصول العملية. العقد المجمد لا ينص على تجميد الصف بعد الإغلاق. وُثّق ولم يُضف قفل جديد.
- رقم المرجع `EF-السنة-العداد` يعتمد على `COUNT(*)` وليس تسلسلًا معزولًا. سباق نادر ممكن. لم يُغيّر المخطط.
- إنشاء الفاتورة داخل `createCase` ليس معاملة D1 واحدة. فشل الفاتورة قد يترك مسودة بلا فاتورة. السلوك قائم من الاستعادة ولم يُعد هيكلته.

## إصلاحات هذا الملف في Checkpoint 04

لم يُعد هيكلة `cases.ts`. أُضيف تأكيد وحدة يرفض `DRAFT → COMPLETED`. لا ترحيل.
